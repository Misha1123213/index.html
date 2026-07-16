-- Run this script in Supabase SQL Editor (SQL → New query → Run)
-- It creates tables and RPC functions for the Cognitio venue sync backend.

CREATE TABLE IF NOT EXISTS public.venues (
  code TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  owner_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff (
  id BIGSERIAL PRIMARY KEY,
  venue_code TEXT REFERENCES public.venues(code) ON DELETE CASCADE,
  name TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_venue(p_code TEXT, p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_data JSONB;
BEGIN
  v_token := md5(random()::text || clock_timestamp()::text);
  v_data := p_data || jsonb_build_object('ownerToken', v_token);
  INSERT INTO public.venues (code, data, owner_token)
  VALUES (p_code, v_data, v_token)
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

GRANT USAGE ON SCHEMA public TO anon;
GRANT EXECUTE ON FUNCTION public.create_venue(TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.get_venue_by_code(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_venue(TEXT, TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.register_staff(TEXT, TEXT) TO anon;
