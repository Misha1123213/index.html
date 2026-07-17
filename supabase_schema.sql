-- Run this script in Supabase SQL Editor (SQL → New query → Run)
-- It creates tables and RPC functions for the Cognitio venue sync backend.

CREATE TABLE IF NOT EXISTS public.venues (
  code TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  owner_token TEXT NOT NULL,
  owner_pin TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff (
  id BIGSERIAL PRIMARY KEY,
  venue_code TEXT REFERENCES public.venues(code) ON DELETE CASCADE,
  name TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT now()
);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

-- User accounts for Cognitio (login/password + recovery question)
CREATE TABLE IF NOT EXISTS public.users (
  id BIGSERIAL PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','staff')),
  venue_code TEXT REFERENCES public.venues(code) ON DELETE SET NULL,
  security_question TEXT,
  security_answer TEXT,
  owner_token TEXT,
  profile JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Ensure owner_pin column exists for older venues created before this schema update
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS owner_pin TEXT;

-- Backfill owner_pin for existing venues (defaults to the venue code until changed by owner)
UPDATE public.venues SET owner_pin = code WHERE owner_pin IS NULL;

CREATE OR REPLACE FUNCTION public.create_venue(p_code TEXT, p_data JSONB, p_owner_pin TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_pin TEXT;
  v_data JSONB;
BEGIN
  v_token := md5(random()::text || clock_timestamp()::text);
  v_pin := COALESCE(NULLIF(p_owner_pin, ''), p_code);
  v_data := p_data || jsonb_build_object('ownerToken', v_token);
  INSERT INTO public.venues (code, data, owner_token, owner_pin)
  VALUES (p_code, v_data, v_token, v_pin)
  RETURNING data INTO v_data;
  RETURN v_data;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_venue_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT data - 'ownerToken' FROM public.venues WHERE code = p_code;
$$;

CREATE OR REPLACE FUNCTION public.update_venue(p_code TEXT, p_owner_token TEXT, p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data JSONB;
BEGIN
  UPDATE public.venues
  SET data = p_data || jsonb_build_object('ownerToken', p_owner_token)
  WHERE code = p_code AND owner_token = p_owner_token
  RETURNING data INTO v_data;
  RETURN v_data - 'ownerToken';
END;
$$;

CREATE OR REPLACE FUNCTION public.register_staff(p_code TEXT, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.staff (venue_code, name) VALUES (p_code, p_name);
END;
$$;

-- Returns full venue data INCLUDING ownerToken when the owner PIN is correct.
CREATE OR REPLACE FUNCTION public.owner_login(p_code TEXT, p_owner_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data JSONB;
BEGIN
  SELECT data INTO v_data
  FROM public.venues
  WHERE code = p_code AND owner_pin = p_owner_pin;

  IF v_data IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_data;
END;
$$;

-- Change owner PIN. Requires current owner token.
CREATE OR REPLACE FUNCTION public.set_owner_pin(p_code TEXT, p_owner_token TEXT, p_new_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.venues
  SET owner_pin = p_new_pin
  WHERE code = p_code AND owner_token = p_owner_token;
END;
$$;

-- Register a new user. For owners, creates the venue. For staff, joins an existing venue.
CREATE OR REPLACE FUNCTION public.register_user(
  p_login TEXT,
  p_password TEXT,
  p_role TEXT,
  p_security_question TEXT,
  p_security_answer TEXT,
  p_venue_name TEXT DEFAULT NULL,
  p_venue_code TEXT DEFAULT NULL,
  p_venue_pin TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id BIGINT;
  v_code TEXT;
  v_token TEXT;
  v_pin TEXT;
  v_venue_data JSONB;
  v_result JSONB;
BEGIN
  IF p_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'INVALID_ROLE';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE login = p_login) THEN
    RAISE EXCEPTION 'LOGIN_EXISTS';
  END IF;

  IF NULLIF(p_password, '') IS NULL OR NULLIF(p_security_answer, '') IS NULL THEN
    RAISE EXCEPTION 'MISSING_FIELDS';
  END IF;

  IF p_role = 'owner' THEN
    v_code := NULLIF(p_venue_code, '');
    IF v_code IS NULL OR length(v_code) != 6 OR v_code !~ '^[0-9]{6}$' THEN
      v_code := floor(100000 + random()*900000)::int::text;
    END IF;

    IF EXISTS (SELECT 1 FROM public.venues WHERE code = v_code) THEN
      -- Attach to an existing venue if the owner PIN matches
      SELECT owner_token, owner_pin, data INTO v_token, v_pin, v_venue_data
      FROM public.venues
      WHERE code = v_code;

      IF v_pin IS DISTINCT FROM COALESCE(NULLIF(p_venue_pin, ''), v_code) THEN
        RAISE EXCEPTION 'INVALID_PIN';
      END IF;
    ELSE
      -- Create a new venue
      IF NULLIF(p_venue_name, '') IS NULL THEN
        RAISE EXCEPTION 'MISSING_VENUE_NAME';
      END IF;

      v_token := md5(random()::text || clock_timestamp()::text);
      v_pin := COALESCE(NULLIF(p_venue_pin, ''), v_code);
      v_venue_data := jsonb_build_object(
        'id', gen_random_uuid()::text,
        'name', p_venue_name,
        'code', v_code,
        'style', 'modern',
        'sections', '[]'::jsonb,
        'staff', '[]'::jsonb,
        'createdAt', extract(epoch from now())*1000
      );

      INSERT INTO public.venues (code, data, owner_token, owner_pin)
      VALUES (v_code, v_venue_data, v_token, v_pin);
    END IF;

    INSERT INTO public.users (login, password_hash, role, venue_code, security_question, security_answer, owner_token)
    VALUES (
      p_login,
      crypt(p_password, gen_salt('bf')),
      p_role,
      v_code,
      p_security_question,
      crypt(p_security_answer, gen_salt('bf')),
      v_token
    ) RETURNING id INTO v_user_id;

    v_venue_data := (v_venue_data - 'ownerToken') || jsonb_build_object('ownerToken', v_token);
    v_result := jsonb_build_object(
      'user', jsonb_build_object('id', v_user_id, 'login', p_login, 'role', p_role, 'venue_code', v_code),
      'venue', v_venue_data
    );

  ELSIF p_role = 'staff' THEN
    IF NULLIF(p_venue_code, '') IS NULL THEN
      RAISE EXCEPTION 'MISSING_VENUE_CODE';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.venues WHERE code = p_venue_code) THEN
      RAISE EXCEPTION 'VENUE_NOT_FOUND';
    END IF;

    INSERT INTO public.users (login, password_hash, role, venue_code, security_question, security_answer)
    VALUES (
      p_login,
      crypt(p_password, gen_salt('bf')),
      p_role,
      p_venue_code,
      p_security_question,
      crypt(p_security_answer, gen_salt('bf'))
    ) RETURNING id INTO v_user_id;

    INSERT INTO public.staff (venue_code, name) VALUES (p_venue_code, p_login);

    SELECT data - 'ownerToken' INTO v_venue_data FROM public.venues WHERE code = p_venue_code;

    v_result := jsonb_build_object(
      'user', jsonb_build_object('id', v_user_id, 'login', p_login, 'role', p_role, 'venue_code', p_venue_code),
      'venue', v_venue_data
    );
  END IF;

  RETURN v_result;
END;
$$;

-- Authenticate user by login and password. Returns user + venue data (with ownerToken for owners).
CREATE OR REPLACE FUNCTION public.login_user(p_login TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_venue_data JSONB;
BEGIN
  SELECT id, login, role, venue_code, security_question, owner_token, password_hash
  INTO v_user
  FROM public.users
  WHERE login = p_login;

  IF NOT FOUND OR NOT crypt(p_password, v_user.password_hash) = v_user.password_hash THEN
    RETURN NULL;
  END IF;

  IF v_user.venue_code IS NULL THEN
    RETURN jsonb_build_object(
      'user', jsonb_build_object('id', v_user.id, 'login', v_user.login, 'role', v_user.role, 'venue_code', NULL),
      'venue', NULL
    );
  END IF;

  IF v_user.role = 'owner' THEN
    SELECT data || jsonb_build_object('ownerToken', v_user.owner_token) INTO v_venue_data
    FROM public.venues
    WHERE code = v_user.venue_code;
  ELSE
    SELECT data - 'ownerToken' INTO v_venue_data
    FROM public.venues
    WHERE code = v_user.venue_code;
  END IF;

  RETURN jsonb_build_object(
    'user', jsonb_build_object('id', v_user.id, 'login', v_user.login, 'role', v_user.role, 'venue_code', v_user.venue_code),
    'venue', v_venue_data
  );
END;
$$;

-- Return the recovery question for a login (used in forgot-password flow).
CREATE OR REPLACE FUNCTION public.get_recovery_question(p_login TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT security_question FROM public.users WHERE login = p_login;
$$;

-- Reset password after a correct security answer.
CREATE OR REPLACE FUNCTION public.reset_password(
  p_login TEXT,
  p_security_answer TEXT,
  p_new_password TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
BEGIN
  SELECT id, security_answer INTO v_user
  FROM public.users
  WHERE login = p_login;

  IF NOT FOUND OR NOT crypt(p_security_answer, v_user.security_answer) = v_user.security_answer THEN
    RETURN false;
  END IF;

  UPDATE public.users
  SET password_hash = crypt(p_new_password, gen_salt('bf'))
  WHERE id = v_user.id;

  RETURN true;
END;
$$;

GRANT USAGE ON SCHEMA public TO anon;
GRANT EXECUTE ON FUNCTION public.create_venue(TEXT, JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_venue_by_code(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_venue(TEXT, TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.register_staff(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.owner_login(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.set_owner_pin(TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.register_user(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.login_user(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_recovery_question(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.reset_password(TEXT, TEXT, TEXT) TO anon;
