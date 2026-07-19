// ====================== PLATFORM LAYER ======================
// Client-side owner / staff flow, TTK upload, course generation.
// Supabase sync is optional: when configured, venue data is shared by pin-code.
// LocalStorage keeps profile, progress and offline cache.

const VENUE_STYLES = [
  { id: 'modern', label: 'Современный', theme: 'dark', accent: '#58CC02', mood: 'modern minimalist coffee shop interior' },
  { id: 'classic', label: 'Классический', theme: 'light', accent: '#8B5E3C', mood: 'classic cozy european cafe interior' },
  { id: 'rustic', label: 'Лофт / Рустик', theme: 'dark', accent: '#FF9600', mood: 'rustic loft brick wall coffee shop' },
  { id: 'minimal', label: 'Минимализм', theme: 'light', accent: '#1CB0F6', mood: 'clean minimal white coffee shop' },
  { id: 'neon', label: 'Неон', theme: 'dark', accent: '#CE82FF', mood: 'neon cyberpunk bar interior' },
];

const AUTH_QUESTIONS = [
  'Любимое число?',
  'Кличка питомца?',
  'Любимый цвет?',
  'Имя лучшего друга?',
  'Любимое блюдо?',
  'Свой вопрос',
];

let supabaseClient = null;
function initSupabaseClient() {
  if (typeof window !== 'undefined' && window.supabase && typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
    try {
      const { createClient } = window.supabase;
      supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.error('Supabase init error', e);
    }
  }
}
initSupabaseClient();

function isNetworkError(e) {
  if (!e) return false;
  if (e instanceof TypeError) return true;
  const msg = (e.message || String(e)).toLowerCase();
  return ['load failed', 'failed to fetch', 'networkerror', 'network request failed', 'the network connection was lost', 'abort', 'timeout', 'err_connection', 'network'].some(k => msg.includes(k));
}

function networkErrorMessage(e) {
  return 'Не удалось связаться с сервером. Проверьте подключение к интернету, VPN, блокировщики рекламы или обновите страницу.';
}

async function safeRpc(method, params, retries = 2) {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      const { data, error } = await supabaseClient.rpc(method, params);
      if (error) throw error;
      return data;
    } catch (e) {
      lastError = e;
      if (isNetworkError(e) && i < retries) {
        await new Promise(r => setTimeout(r, 600 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

const PENDING_RESULTS_KEY = 'cognitio_pending_results';
function getPendingResults() {
  try { return JSON.parse(localStorage.getItem(PENDING_RESULTS_KEY) || '[]'); } catch { return []; }
}
function addPendingResult(result) {
  const arr = getPendingResults();
  arr.push(result);
  localStorage.setItem(PENDING_RESULTS_KEY, JSON.stringify(arr));
}
async function syncPendingResults() {
  if (!supabaseClient) return;
  const pending = getPendingResults();
  if (!pending.length) return;
  const failed = [];
  for (const r of pending) {
    try {
      const { error } = await supabaseClient.rpc('save_result', r);
      if (error) throw error;
    } catch (e) { failed.push(r); }
  }
  localStorage.setItem(PENDING_RESULTS_KEY, JSON.stringify(failed));
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', syncPendingResults);
}

function generateVenueCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isValidVenueCode(code) {
  return /^\d{6}$/.test(String(code || '').trim());
}

async function createRemoteVenue(venue, ownerPin) {
  if (!supabaseClient) return null;
  const payload = { ...venue };
  delete payload.ownerToken;
  try {
    return await safeRpc('create_venue', { p_code: venue.code, p_data: payload, p_owner_pin: ownerPin || venue.code });
  } catch (e) {
    if (isNetworkError(e)) { showPlatformToast(networkErrorMessage(e)); return null; }
    if (e.message && e.message.includes('create_venue(p_code, p_data)')) {
      try {
        return await safeRpc('create_venue', { p_code: venue.code, p_data: payload });
      } catch (e2) {
        if (isNetworkError(e2)) { showPlatformToast(networkErrorMessage(e2)); return null; }
        showPlatformToast('Ошибка создания заведения на сервере: ' + e2.message);
        return null;
      }
    }
    showPlatformToast('Ошибка создания заведения на сервере: ' + e.message);
    return null;
  }
}

async function fetchRemoteVenue(code) {
  if (!supabaseClient) return null;
  try {
    return await safeRpc('get_venue_by_code', { p_code: code });
  } catch (e) {
    if (isNetworkError(e)) { showPlatformToast(networkErrorMessage(e)); return null; }
    showPlatformToast('Ошибка загрузки заведения: ' + e.message);
    return null;
  }
}

async function syncVenueToRemote(venue, ownerToken) {
  if (!supabaseClient || !venue || !ownerToken) return null;
  const payload = { ...venue };
  delete payload.ownerToken;
  try {
    return await safeRpc('update_venue', { p_code: venue.code, p_owner_token: ownerToken, p_data: payload });
  } catch (e) {
    if (isNetworkError(e)) { showPlatformToast(networkErrorMessage(e)); return null; }
    showPlatformToast('Ошибка синхронизации заведения: ' + e.message);
    return null;
  }
}

function syncVenue() {
  if (!supabaseClient || !state.venue || !state.auth || state.auth.role !== 'owner' || !state.auth.ownerToken) return;
  syncVenueToRemote(state.venue, state.auth.ownerToken)
    .then(data => {
      if (data) {
        state.venue = normalizeVenue(data);
        saveProgress({ venue: state.venue });
      }
    })
    .catch(e => console.error('syncVenue error', e));
}

async function saveTrainingResult(itemName, isCorrect, format, timeTaken) {
  const auth = state.auth || {};
  const venue = state.venue || {};
  if (!auth.login || !venue.code) return;
  const payload = {
    p_venue_code: venue.code,
    p_staff_login: auth.login,
    p_item_name: itemName,
    p_is_correct: isCorrect,
    p_format: format || null,
    p_time_taken: timeTaken || 0
  };
  try {
    if (supabaseClient) {
      const { error } = await supabaseClient.rpc('save_result', payload);
      if (error) throw error;
      syncPendingResults();
    } else {
      addPendingResult(payload);
    }
  } catch (e) {
    addPendingResult(payload);
  }
}

function exportVenueFile() {
  const venue = state.venue;
  if (!venue) return showPlatformToast('Нет заведения для экспорта');
  const data = JSON.stringify(venue, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(venue.name || 'venue').replace(/[^a-zA-Z0-9а-яА-ЯёЁ]/g, '_')}-cognitio.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importVenueFile(file, thenScreen) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const venue = JSON.parse(e.target.result);
      if (!venue || !venue.code || !venue.id || !Array.isArray(venue.sections)) {
        throw new Error('Неверный файл заведения');
      }
      state.venue = normalizeVenue(venue);
      saveProgress({ venue: state.venue });
      syncVenue();
      if (thenScreen) state.screen = thenScreen;
      render();
      showPlatformToast('Заведение импортировано');
    } catch (err) {
      showPlatformToast(err.message || 'Не удалось импортировать файл');
    }
  };
  reader.onerror = () => showPlatformToast('Не удалось прочитать файл');
  reader.readAsText(file);
}

function importVenueBackup(file) {
  importVenueFile(file, 'ownerDashboard');
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showPlatformToast('Скопировано');
  } catch (e) {
    showPlatformToast('Не удалось скопировать');
  }
}

function copyVenueCode() {
  if (!state.venue) return;
  copyToClipboard(state.venue.code);
}

function generateRandomPin(length = 6) {
  let pin = '';
  for (let i = 0; i < length; i++) pin += Math.floor(Math.random() * 10);
  return pin;
}

async function regenerateVenueCode() {
  if (!state.venue || !state.auth || !state.auth.ownerToken) {
    return showPlatformToast('Нет прав для смены кода');
  }
  const newCode = generateRandomPin(6);
  try {
    const updated = await safeRpc('change_venue_code', {
      p_old_code: state.venue.code,
      p_owner_token: state.auth.ownerToken,
      p_new_code: newCode
    });
    if (!updated) throw new Error('Код не обновлен');
    state.venue = normalizeVenue(updated);
    saveProgress({ venue: state.venue });
    syncVenue();
    showPlatformToast('Код заведения обновлен');
    render();
  } catch (e) {
    showPlatformToast('Смена кода недоступна: ' + (e.message || ''));
  }
}

function generateId() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function applyVenueStyle(styleId, imageUrl) {
  const style = VENUE_STYLES.find(s => s.id === styleId) || VENUE_STYLES[0];
  document.documentElement.style.setProperty('--venue-accent', style.accent);
  document.body.classList.remove('style-modern', 'style-classic', 'style-rustic', 'style-minimal', 'style-neon');
  document.body.classList.add('style-' + style.id);
  applyVenueBackground(style, imageUrl);
  if (style.theme) {
    updateSetting('theme', style.theme);
    applyTheme(style.theme);
  }
}

function applyVenueBackground(style, imageUrl) {
  let existing = document.getElementById('venue-bg');
  if (!existing) {
    existing = document.createElement('div');
    existing.id = 'venue-bg';
    existing.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;';
    document.body.prepend(existing);
  }
  const gradients = {
    modern: 'linear-gradient(135deg, rgba(26,26,26,0.95) 0%, rgba(45,58,30,0.92) 50%, rgba(0,0,0,0.95) 100%)',
    classic: 'linear-gradient(135deg, rgba(243,231,215,0.95) 0%, rgba(214,192,166,0.95) 100%)',
    rustic: 'linear-gradient(135deg, rgba(44,30,20,0.95) 0%, rgba(74,50,33,0.92) 50%, rgba(26,18,13,0.95) 100%)',
    minimal: 'linear-gradient(135deg, rgba(248,249,250,0.95) 0%, rgba(233,236,239,0.95) 100%)',
    neon: 'linear-gradient(135deg, rgba(13,2,33,0.95) 0%, rgba(42,10,59,0.92) 50%, rgba(0,0,0,0.95) 100%)',
  };
  if (imageUrl) {
    existing.style.background = `${gradients[style.id] || gradients.modern}, url('${imageUrl}') center/cover no-repeat`;
    existing.style.backgroundBlendMode = 'overlay';
    existing.style.opacity = '0.35';
  } else {
    existing.style.background = gradients[style.id] || gradients.modern;
    existing.style.backgroundBlendMode = 'normal';
    existing.style.opacity = '0.18';
  }
}

function venueMoodImageUrl(style, venueName) {
  const prompt = encodeURIComponent(`${style.mood}, ${venueName || 'cafe'}`);
  return `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;
}

function isPlatformScreen() {
  return ['authOptions', 'login', 'register', 'forgotPassword', 'resetPassword', 'roleSelect', 'ownerOptions', 'ownerLogin', 'ownerRegister', 'ownerSetup', 'courseEditor', 'ownerDashboard', 'ownerStats', 'staffStats', 'sectionPicker', 'staffRegister', 'staffJoin'].includes(state.screen);
}

function venueHasGramData(venue) {
  if (!venue || !venue.sections) return false;
  for (const s of venue.sections) {
    for (const it of (s.items || [])) {
      for (const c of (it.correct || [])) {
        if (typeof c === 'object' && (c.grams > 0 || c.isCount)) return true;
      }
    }
  }
  return false;
}

function normalizeVenue(venue) {
  if (!venue) return null;
  if (!venue.sections) venue.sections = [];
  if (venue.items && !venue.sections.length) {
    venue.sections.push({
      id: generateId(),
      name: 'Основное меню',
      items: venue.items || [],
      createdAt: venue.createdAt || Date.now(),
    });
  }
  const hasGrams = venueHasGramData(venue);
  const defaultFormats = { logical: true, missing: true, color_coded: true, spatial: true };
  const existingFormats = (venue.settings && venue.settings.formats) || {};
  const defaultSettings = {
    showGrams: hasGrams,
    requireGrams: hasGrams,
    speedMode: { enabled: false, timeLimit: 15 },
    formats: defaultFormats
  };
  venue.settings = {
    ...defaultSettings,
    ...(venue.settings || {}),
    formats: { ...defaultSettings.formats, ...existingFormats },
    speedMode: { ...defaultSettings.speedMode, ...((venue.settings && venue.settings.speedMode) || {}) }
  };
  delete venue.items;
  return venue;
}

function getVenueSettings() {
  const defaults = { showGrams: false, requireGrams: false, formats: { logical: true, missing: true, color_coded: true, spatial: true } };
  const s = (state.venue && state.venue.settings) || {};
  return {
    ...defaults,
    ...s,
    formats: { ...defaults.formats, ...(s.formats || {}) }
  };
}

function updateVenueSettings(patch) {
  if (!state.venue) return;
  state.venue.settings = { ...getVenueSettings(), ...patch };
  saveProgress({ venue: state.venue });
  syncVenue();
}

function initPlatform() {
  const p = getProgress();
  state.auth = p.auth || null;
  state.venue = normalizeVenue(p.venue || null);
  state.staff = p.staff || null;

  if (state.venue && state.venue.style) {
    applyVenueStyle(state.venue.style, state.venue.bgImage || null);
  }

  if (state.auth && state.venue) {
    window.renderHome = renderPlatformHome;
    if (state.auth.role === 'owner') {
      state.screen = (state.venue.sections && state.venue.sections.some(s => s.items && s.items.length)) ? 'home' : 'ownerSetup';
    } else {
      state.screen = (state.venue.sections && state.venue.sections.some(s => s.items && s.items.length)) ? 'home' : 'home';
    }
  } else if (p.profile) {
    state.screen = 'home';
  } else {
    state.screen = 'authOptions';
  }

  applyTheme(getSettings().theme);
  applyAnimationPref();
  checkAchievements();
  render();
  loadAvatarConfig().then(() => {
    if (!isPlatformScreen()) render();
  });
}

function getVenueSections() {
  return (state.venue && state.venue.sections) || [];
}

function getVenueSection(sectionId) {
  return getVenueSections().find(s => s.id === sectionId) || getVenueSections()[0] || null;
}

function loadVenueIntoState(sectionId) {
  const sections = getVenueSections();
  if (!sections.length) return;
  const section = sectionId ? (sections.find(s => s.id === sectionId) || sections[0]) : sections[0];
  if (!section) return;
  state.currentSectionId = section.id;
  state.allData = (section.items || []).map(normalizeItem);
  buildLessons();
  state.section = 'venue_' + section.id;
  state.sectionLabel = section.name;
  state.isDrinksChapter = (section.items || []).some(it => it._hasGrams);
}

function selectRole(role) {
  state.platformDraft = { role };
  state.screen = 'register';
  render();
}

function backToRoleSelect() {
  state.platformDraft = null;
  state.screen = 'roleSelect';
  render();
}

function backToAuthOptions() {
  state.platformDraft = null;
  state.screen = 'authOptions';
  render();
}

function updatePlatformDraft(key, value) {
  state.platformDraft = state.platformDraft || {};
  state.platformDraft[key] = value;
}

function validatePlatformButton() {
  const draft = state.platformDraft || {};
  const btn = document.getElementById('platform-primary-btn');
  if (!btn) return;
  let valid = true;
  if (state.screen === 'login') {
    valid = (draft.login || '').trim().length >= 3 && (draft.password || '').length >= 4;
  } else if (state.screen === 'register') {
    const role = draft.role || 'owner';
    const question = draft.securityQuestion === 'custom' ? (draft.customQuestion || '').trim() : (draft.securityQuestion || '').trim();
    const base = (draft.login || '').trim().length >= 3 && (draft.password || '').length >= 4 && (draft.password || '') === (draft.passwordRepeat || '') && question.length > 0 && (draft.securityAnswer || '').trim().length > 0;
    if (role === 'owner') {
      valid = base && (draft.venueName || '').trim().length > 0 && (!(draft.venueCode || '').trim() || isValidVenueCode(draft.venueCode));
    } else {
      valid = base && isValidVenueCode(draft.venueCode);
    }
  } else if (state.screen === 'forgotPassword') {
    valid = (draft.login || '').trim().length >= 3;
  } else if (state.screen === 'resetPassword') {
    valid = (draft.securityAnswer || '').trim().length > 0 && (draft.newPassword || '').length >= 4 && (draft.newPassword || '') === (draft.newPasswordRepeat || '');
  } else if (state.screen === 'ownerRegister') {
    const pin = (draft.pin || '').trim();
    valid = !!(draft.name && draft.name.trim() && draft.venueName && draft.venueName.trim()) && (!pin || isValidVenueCode(pin));
  } else if (state.screen === 'staffRegister') {
    valid = !!(draft.name && draft.name.trim());
  } else if (state.screen === 'staffJoin' || state.screen === 'ownerLogin') {
    valid = (draft.code || '').trim().length === 6 && (state.screen !== 'ownerLogin' || (draft.ownerPin || '').trim().length === 6);
  } else if (state.screen === 'courseEditor') {
    valid = !!(draft.parsedItems && draft.parsedItems.length && draft.sectionName && draft.sectionName.trim());
  }
  btn.classList.toggle('disabled', !valid);
}

function selectVenueStyle(styleId) {
  state.platformDraft = state.platformDraft || {};
  state.platformDraft.style = styleId;
  applyVenueStyle(styleId);
  document.querySelectorAll('.style-card').forEach(el => {
    el.classList.toggle('selected', el.dataset.style === styleId);
  });
  validatePlatformButton();
}

async function registerOwner() {
  const draft = state.platformDraft || {};
  const name = (draft.name || '').trim();
  const venueName = (draft.venueName || '').trim();
  const style = draft.style || 'modern';
  const customPin = (draft.pin || '').trim();
  if (!name || !venueName) return;

  const code = isValidVenueCode(customPin) ? customPin : generateVenueCode();
  const venue = {
    id: generateId(),
    name: venueName,
    style: style,
    code: code,
    sections: [],
    staff: [],
    createdAt: Date.now(),
  };

  let finalVenue = venue;
  let ownerToken = null;
  const ownerPin = isValidVenueCode(customPin) ? customPin : code;
  if (supabaseClient) {
    const remote = await createRemoteVenue(venue, ownerPin);
    if (!remote) return;
    ownerToken = remote.ownerToken;
    finalVenue = { ...remote };
    delete finalVenue.ownerToken;
  }

  const auth = { role: 'owner', name: name, venueId: finalVenue.id, code: code };
  if (ownerToken) auth.ownerToken = ownerToken;
  state.profile = { nickname: name, avatar: cloneAvatar() };
  state.auth = auth;
  state.venue = finalVenue;
  state.platformDraft = null;

  saveProgress({ auth: auth, venue: finalVenue, profile: state.profile });
  applyVenueStyle(style);
  window.renderHome = renderPlatformHome;
  state.screen = 'ownerSetup';
  render();
}

function registerStaff() {
  const draft = state.platformDraft || {};
  const name = (draft.name || '').trim();
  if (!name) return;
  state.platformDraft = { ...draft, step: 'code' };
  state.screen = 'staffJoin';
  render();
}

async function joinStaffVenue() {
  const draft = state.platformDraft || {};
  const code = (draft.code || '').trim();
  const name = (draft.name || '').trim();
  if (!code || !name) return;

  let venue = null;
  if (supabaseClient) {
    venue = await fetchRemoteVenue(code);
    if (venue) venue = normalizeVenue(venue);
  }
  if (!venue) {
    const p = getProgress();
    venue = normalizeVenue(p.venue || null);
  }
  if (!venue || venue.code !== code) {
    showPlatformToast('Код не найден. Проверьте пин-код или дождитесь, пока владелец синхронизирует заведение с сервером.');
    return;
  }

  const staff = { name, joinedAt: Date.now() };
  venue.staff = venue.staff || [];
  venue.staff.push(staff);

  const auth = { role: 'staff', name, venueId: venue.id, code: code };
  state.profile = { nickname: name, avatar: cloneAvatar() };
  state.auth = auth;
  state.venue = venue;
  state.staff = staff;
  state.platformDraft = null;

  saveProgress({ auth: auth, venue: venue, staff: staff, profile: state.profile });
  applyVenueStyle(venue.style, venue.bgImage || null);
  loadVenueIntoState();
  window.renderHome = renderPlatformHome;
  state.screen = 'home';
  render();
  syncPendingResults();
  playSound('correct');
}

function startVenueCourse(sectionId) {
  if (!state.venue || !state.venue.sections.length) return;
  loadVenueIntoState(sectionId);
  state.screen = 'path';
  render();
}

function logoutPlatform() {
  saveProgress({ auth: null, staff: null, profile: null });
  state.auth = null;
  state.staff = null;
  state.profile = null;
  state.screen = 'authOptions';
  render();
}

function ownerDashboard() {
  state.screen = 'ownerDashboard';
  render();
  loadStaffList();
}

function ownerBackToHome() {
  state.screen = 'home';
  render();
}

async function loadStaffList() {
  if (!supabaseClient || !state.venue) return;
  try {
    const { data, error } = await supabaseClient.rpc('get_staff_list', { p_code: state.venue.code });
    if (error) throw error;
    state.staffList = (data || []).map(s => ({ id: s.id, name: s.name, joined_at: s.joined_at }));
  } catch (e) {
    console.error('loadStaffList error', e);
    state.staffList = state.venue.staff || [];
  }
  render();
}

async function removeStaff(name) {
  if (!supabaseClient || !state.venue || !name) return;
  if (!confirm('Удалить сотрудника ' + name + '?')) return;
  try {
    const { error } = await supabaseClient.rpc('remove_staff', { p_code: state.venue.code, p_name: name });
    if (error) throw error;
    showPlatformToast('Сотрудник удалён');
    loadStaffList();
  } catch (e) {
    showPlatformToast('Ошибка удаления: ' + (e.message || e));
  }
}

async function loadTrainingStats() {
  if (!supabaseClient || !state.venue) {
    state.trainingStats = { staff: [], items: [] };
    render();
    return;
  }
  try {
    const { data, error } = await supabaseClient.rpc('get_training_stats', { p_venue_code: state.venue.code });
    if (error) throw error;
    state.trainingStats = data || { staff: [], items: [] };
  } catch (e) {
    console.error('loadTrainingStats error', e);
    state.trainingStats = { staff: [], items: [] };
  }
  render();
}

function showOwnerStats() {
  state.screen = 'ownerStats';
  render();
  loadTrainingStats();
}

function showStaffStats() {
  state.screen = 'staffStats';
  render();
  loadTrainingStats();
}

// ====================== RENDERERS ======================

function renderAuthOptions() {
  app.innerHTML = `
    <div class="platform-screen role-select">
      <div class="platform-mascot"></div>
      <div class="platform-title">Cognitio</div>
      <div class="platform-subtitle">Платформа для изучения составов блюд и напитков</div>
      <div class="role-cards">
        <button class="role-card" onclick="state.screen='login'; state.platformDraft={}; render()">
          <div class="role-icon"></div>
          <div class="role-label">Войти</div>
        </button>
        <button class="role-card" onclick="state.screen='roleSelect'; state.platformDraft={}; render()">
          <div class="role-icon"></div>
          <div class="role-label">Регистрация</div>
        </button>
      </div>
      <button class="link-btn" style="margin-top:20px" onclick="state.screen='forgotPassword'; state.platformDraft={}; render()">Забыли пароль?</button>
    </div>
  `;
}

function renderRoleSelect() {
  app.innerHTML = `
    <div class="platform-screen role-select">
      <div class="platform-header">
        <button class="close-btn" onclick="backToAuthOptions()">← Назад</button>
      </div>
      <div class="platform-title">Регистрация</div>
      <div class="platform-subtitle">Выберите, кто вы</div>
      <div class="role-cards">
        <button class="role-card" onclick="selectRole('owner')">
          <div class="role-icon"></div>
          <div class="role-label">Я владелец</div>
          <div class="role-desc">Создам заведение, загружу ТТК и приглашу сотрудников</div>
        </button>
        <button class="role-card" onclick="selectRole('staff')">
          <div class="role-icon"></div>
          <div class="role-label">Я сотрудник</div>
          <div class="role-desc">У меня есть код от владельца</div>
        </button>
      </div>
    </div>
  `;
}

function renderLogin() {
  const draft = state.platformDraft || {};
  const login = (draft.login || '').replace(/"/g, '&quot;');
  const valid = (draft.login || '').trim().length >= 3 && (draft.password || '').length >= 4;
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="backToAuthOptions()">← Назад</button>
      </div>
      <div class="platform-title">Вход</div>
      <div class="platform-form">
        <label class="platform-label">Логин</label>
        <input class="platform-input" type="text" id="auth-login" value="${login}" placeholder="ivan" maxlength="30" oninput="updatePlatformDraft('login', this.value); validatePlatformButton()">
        <label class="platform-label">Пароль</label>
        <input class="platform-input" type="password" id="auth-password" oninput="updatePlatformDraft('password', this.value); validatePlatformButton()">
        <button id="platform-primary-btn" class="onboarding-btn ${valid ? '' : 'disabled'}" onclick="loginUser()">Войти</button>
        <button class="link-btn" style="margin-top:12px" onclick="state.screen='forgotPassword'; state.platformDraft={login:draft.login||''}; render()">Забыли пароль?</button>
      </div>
    </div>
  `;
}

function renderRegister() {
  const draft = state.platformDraft || {};
  const role = draft.role || 'owner';
  const isOwner = role === 'owner';
  const login = (draft.login || '').replace(/"/g, '&quot;');
  const answer = (draft.securityAnswer || '').replace(/"/g, '&quot;');
  const venueName = (draft.venueName || '').replace(/"/g, '&quot;');
  const venueCode = draft.venueCode || '';
  const venuePin = draft.venuePin || '';
  const customQuestion = (draft.customQuestion || '').replace(/"/g, '&quot;');
  const question = draft.securityQuestion || '';
  const customSelected = question === 'custom' || question === 'Свой вопрос';
  const options = AUTH_QUESTIONS.map(q => {
    const val = q === 'Свой вопрос' ? 'custom' : q;
    const selected = question === val || (customSelected && val === 'custom');
    return `<option value="${val}" ${selected ? 'selected' : ''}>${q}</option>`;
  }).join('');

  const baseValid = (draft.login || '').trim().length >= 3 &&
                    (draft.password || '').length >= 4 &&
                    (draft.password || '') === (draft.passwordRepeat || '') &&
                    question &&
                    (question !== 'custom' || customQuestion.trim()) &&
                    (draft.securityAnswer || '').trim().length > 0;
  let valid = false;
  if (isOwner) {
    const hasExistingCode = isValidVenueCode(draft.venueCode);
    valid = baseValid && ((draft.venueName || '').trim().length > 0 || hasExistingCode) && (!(draft.venueCode || '').trim() || isValidVenueCode(draft.venueCode)) && (!(draft.venuePin || '').trim() || isValidVenueCode(draft.venuePin));
  } else {
    valid = baseValid && isValidVenueCode(draft.venueCode);
  }

  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="backToRoleSelect()">← Назад</button>
      </div>
      <div class="platform-title">Регистрация</div>
      <div class="platform-form">
        <label class="platform-label">Логин</label>
        <input class="platform-input" type="text" id="auth-login" value="${login}" placeholder="ivan" maxlength="30" oninput="updatePlatformDraft('login', this.value); validatePlatformButton()">
        <label class="platform-label">Пароль</label>
        <input class="platform-input" type="password" id="auth-password" oninput="updatePlatformDraft('password', this.value); validatePlatformButton()">
        <label class="platform-label">Повторите пароль</label>
        <input class="platform-input" type="password" id="auth-password-repeat" oninput="updatePlatformDraft('passwordRepeat', this.value); validatePlatformButton()">

        <label class="platform-label">Контрольный вопрос</label>
        <select class="platform-input" id="auth-question" style="margin-bottom:8px" onchange="updatePlatformDraft('securityQuestion', this.value); render()">
          ${options}
        </select>
        <input class="platform-input" type="text" id="auth-custom-question" value="${customQuestion}" placeholder="Ваш вопрос" maxlength="60" style="display:${customSelected ? 'block' : 'none'};margin-bottom:12px" oninput="updatePlatformDraft('customQuestion', this.value); validatePlatformButton()">
        <label class="platform-label">Ответ (подсказка)</label>
        <input class="platform-input" type="text" id="auth-answer" value="${answer}" placeholder="ответ на вопрос" maxlength="60" oninput="updatePlatformDraft('securityAnswer', this.value); validatePlatformButton()">

        ${isOwner ? `
          <label class="platform-label">Название заведения</label>
          <input class="platform-input" type="text" id="auth-venue-name" value="${venueName}" placeholder="Mad Espresso team" maxlength="40" oninput="updatePlatformDraft('venueName', this.value); validatePlatformButton()">
          <label class="platform-label">Код заведения (6 цифр, опционально)</label>
          <input class="platform-input code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" id="auth-venue-code" value="${venueCode}" placeholder="178617" maxlength="6" oninput="let v = this.value.replace(/[^0-9]/g,''); if (v !== this.value) this.value = v; updatePlatformDraft('venueCode', v); validatePlatformButton()">
          <label class="platform-label">Пин владельца (6 цифр, опционально)</label>
          <input class="platform-input code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" id="auth-venue-pin" value="${venuePin}" placeholder="178617" maxlength="6" oninput="let v = this.value.replace(/[^0-9]/g,''); if (v !== this.value) this.value = v; updatePlatformDraft('venuePin', v); validatePlatformButton()">
        ` : `
          <label class="platform-label">Код заведения</label>
          <input class="platform-input code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" id="auth-venue-code" value="${venueCode}" placeholder="178617" maxlength="6" oninput="let v = this.value.replace(/[^0-9]/g,''); if (v !== this.value) this.value = v; updatePlatformDraft('venueCode', v); validatePlatformButton()">
        `}

        <button id="platform-primary-btn" class="onboarding-btn ${valid ? '' : 'disabled'}" onclick="registerUser()">Зарегистрироваться</button>
      </div>
    </div>
  `;
}

function renderForgotPassword() {
  const draft = state.platformDraft || {};
  const login = (draft.login || '').replace(/"/g, '&quot;');
  const valid = (draft.login || '').trim().length >= 3;
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="backToAuthOptions()">← Назад</button>
      </div>
      <div class="platform-title">Восстановление пароля</div>
      <div class="platform-form">
        <label class="platform-label">Логин</label>
        <input class="platform-input" type="text" id="auth-login" value="${login}" placeholder="ivan" maxlength="30" oninput="updatePlatformDraft('login', this.value); validatePlatformButton()">
        <button id="platform-primary-btn" class="onboarding-btn ${valid ? '' : 'disabled'}" onclick="getRecoveryQuestion()">Показать вопрос</button>
      </div>
    </div>
  `;
}

function renderResetPassword() {
  const draft = state.platformDraft || {};
  const question = (draft.securityQuestion || '').replace(/"/g, '&quot;');
  const answer = (draft.securityAnswer || '').replace(/"/g, '&quot;');
  const valid = (draft.securityAnswer || '').trim().length > 0 && (draft.newPassword || '').length >= 4 && (draft.newPassword || '') === (draft.newPasswordRepeat || '');
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="state.screen='forgotPassword'; state.platformDraft={login:draft.login||''}; render()">← Назад</button>
      </div>
      <div class="platform-title">Новый пароль</div>
      <div class="platform-form">
        <label class="platform-label">Контрольный вопрос</label>
        <div class="platform-hint" style="margin-bottom:12px">${question}</div>
        <label class="platform-label">Ответ (подсказка)</label>
        <input class="platform-input" type="text" id="auth-answer" value="${answer}" placeholder="ответ" maxlength="60" oninput="updatePlatformDraft('securityAnswer', this.value); validatePlatformButton()">
        <label class="platform-label">Новый пароль</label>
        <input class="platform-input" type="password" id="auth-new-password" oninput="updatePlatformDraft('newPassword', this.value); validatePlatformButton()">
        <label class="platform-label">Повторите пароль</label>
        <input class="platform-input" type="password" id="auth-new-password-repeat" oninput="updatePlatformDraft('newPasswordRepeat', this.value); validatePlatformButton()">
        <button id="platform-primary-btn" class="onboarding-btn ${valid ? '' : 'disabled'}" onclick="resetUserPassword()">Сохранить пароль</button>
      </div>
    </div>
  `;
}

async function loginUser() {
  const draft = state.platformDraft || {};
  const login = (draft.login || '').trim();
  const password = draft.password || '';
  if (login.length < 3 || password.length < 4) return;
  if (!supabaseClient) { showPlatformToast('Нет подключения к серверу'); return; }
  try {
    const data = await safeRpc('login_user', { p_login: login, p_password: password });
    if (!data) { showPlatformToast('Неверный логин или пароль'); return; }
    handleAuthData(data);
  } catch (e) {
    if (isNetworkError(e)) { showPlatformToast(networkErrorMessage(e)); return; }
    showPlatformToast('Ошибка входа: ' + (e.message || e));
  }
}

function handleAuthData(data) {
  const user = data.user || {};
  let remoteVenue = normalizeVenue(data.venue);
  if (!remoteVenue) {
    showPlatformToast('Не удалось загрузить заведение');
    return;
  }
  const ownerToken = remoteVenue.ownerToken || null;
  if (ownerToken) delete remoteVenue.ownerToken;
  const auth = { login: user.login, userId: user.id, role: user.role, venueId: remoteVenue.id, code: user.venue_code, ownerToken };
  state.auth = auth;
  state.venue = remoteVenue;
  state.profile = { nickname: user.login, avatar: cloneAvatar() };
  state.platformDraft = null;
  saveProgress({ auth, venue: remoteVenue, profile: state.profile });
  applyVenueStyle(remoteVenue.style || 'modern', remoteVenue.bgImage || null);
  window.renderHome = renderPlatformHome;
  loadVenueIntoState();
  if (user.role === 'owner') {
    state.screen = (remoteVenue.sections && remoteVenue.sections.some(s => s.items && s.items.length)) ? 'home' : 'ownerSetup';
  } else {
    state.screen = 'home';
  }
  render();
  syncPendingResults();
  showPlatformToast(user.role === 'owner' ? 'Заведение загружено' : 'Добро пожаловать');
}

async function registerUser() {
  const draft = state.platformDraft || {};
  const login = (draft.login || '').trim();
  const password = draft.password || '';
  const passwordRepeat = draft.passwordRepeat || '';
  const role = draft.role || 'owner';
  let question = draft.securityQuestion || '';
  if (question === 'custom' || question === 'Свой вопрос') question = (draft.customQuestion || '').trim();
  const answer = (draft.securityAnswer || '').trim();
  const venueName = (draft.venueName || '').trim();
  const venueCode = (draft.venueCode || '').trim();
  const venuePin = (draft.venuePin || '').trim();

  if (login.length < 3 || password.length < 4 || password !== passwordRepeat || !question || !answer) {
    showPlatformToast('Заполните все поля корректно');
    return;
  }
  if (role === 'owner' && !venueCode && !venueName) {
    showPlatformToast('Введите название заведения');
    return;
  }
  if (role === 'staff' && !isValidVenueCode(venueCode)) {
    showPlatformToast('Введите код заведения');
    return;
  }
  if (role === 'owner' && venueCode && !isValidVenueCode(venueCode)) {
    showPlatformToast('Код заведения должен быть 6 цифр');
    return;
  }
  if (role === 'owner' && venuePin && !isValidVenueCode(venuePin)) {
    showPlatformToast('Пин владельца должен быть 6 цифр');
    return;
  }

  if (!supabaseClient) { showPlatformToast('Нет подключения к серверу'); return; }

  const params = {
    p_login: login,
    p_password: password,
    p_role: role,
    p_security_question: question,
    p_security_answer: answer
  };
  if (role === 'owner') {
    if (venueName) params.p_venue_name = venueName;
    if (venueCode) {
      params.p_venue_code = venueCode;
      params.p_venue_pin = venuePin || venueCode;
    }
  } else {
    params.p_venue_code = venueCode;
  }

  try {
    const data = await safeRpc('register_user', params);
    if (!data) { showPlatformToast('Ошибка регистрации'); return; }
    handleAuthData(data);
  } catch (e) {
    if (isNetworkError(e)) { showPlatformToast(networkErrorMessage(e)); return; }
    const msg = e.message || String(e);
    if (msg.includes('LOGIN_EXISTS')) showPlatformToast('Логин уже занят');
    else if (msg.includes('CODE_EXISTS')) showPlatformToast('Код заведения уже используется');
    else if (msg.includes('INVALID_PIN')) showPlatformToast('Неверный пин владельца');
    else if (msg.includes('VENUE_NOT_FOUND')) showPlatformToast('Заведение не найдено');
    else showPlatformToast('Ошибка регистрации: ' + msg);
  }
}

async function getRecoveryQuestion() {
  const draft = state.platformDraft || {};
  const login = (draft.login || '').trim();
  if (login.length < 3) return;
  if (!supabaseClient) { showPlatformToast('Нет подключения к серверу'); return; }
  try {
    const data = await safeRpc('get_recovery_question', { p_login: login });
    if (!data) { showPlatformToast('Пользователь не найден'); return; }
    draft.securityQuestion = data;
    state.screen = 'resetPassword';
    render();
  } catch (e) {
    if (isNetworkError(e)) { showPlatformToast(networkErrorMessage(e)); return; }
    showPlatformToast('Ошибка: ' + (e.message || e));
  }
}

async function resetUserPassword() {
  const draft = state.platformDraft || {};
  const login = (draft.login || '').trim();
  const answer = (draft.securityAnswer || '').trim();
  const newPassword = draft.newPassword || '';
  const newPasswordRepeat = draft.newPasswordRepeat || '';
  if (!answer || newPassword.length < 4 || newPassword !== newPasswordRepeat) return;
  if (!supabaseClient) { showPlatformToast('Нет подключения к серверу'); return; }
  try {
    const data = await safeRpc('reset_password', { p_login: login, p_security_answer: answer, p_new_password: newPassword });
    if (data) {
      showPlatformToast('Пароль обновлён. Войдите с новым паролем.');
      state.screen = 'login';
      state.platformDraft = { login };
      render();
    } else {
      showPlatformToast('Неверный ответ на контрольный вопрос');
    }
  } catch (e) {
    if (isNetworkError(e)) { showPlatformToast(networkErrorMessage(e)); return; }
    showPlatformToast('Ошибка сброса: ' + (e.message || e));
  }
}

function renderOwnerRegister() {
  const draft = state.platformDraft || {};
  const name = draft.name || '';
  const venueName = draft.venueName || '';
  const pin = draft.pin || '';
  const valid = name.trim() && venueName.trim() && (!pin.trim() || isValidVenueCode(pin));
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="backToRoleSelect()">← Назад</button>
      </div>
      <div class="platform-title">Создать заведение</div>
      <div class="platform-form">
        <label class="platform-label">Ваше имя</label>
        <input class="platform-input" type="text" id="owner-name" value="${name}" placeholder="Иван" maxlength="30" oninput="updatePlatformDraft('name', this.value); validatePlatformButton()">
        <label class="platform-label">Название заведения</label>
        <input class="platform-input" type="text" id="venue-name" value="${venueName}" placeholder="Кофейня 'Зерно'" maxlength="40" oninput="updatePlatformDraft('venueName', this.value); validatePlatformButton()">
        <label class="platform-label">Пин-код для сотрудников (6 цифр, опционально)</label>
        <input class="platform-input code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" id="owner-pin" value="${pin}" placeholder="178617" maxlength="6" oninput="let v = this.value.replace(/[^0-9]/g,''); if (v !== this.value) this.value = v; updatePlatformDraft('pin', v); validatePlatformButton()">
        <button id="platform-primary-btn" class="onboarding-btn ${valid ? '' : 'disabled'}" onclick="registerOwner()">Создать заведение</button>
      </div>
    </div>
  `;
}

function renderOwnerOptions() {
  const hasVenue = state.venue && state.auth && state.auth.role === 'owner';
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="backToRoleSelect()">← Назад</button>
      </div>
      <div class="platform-title">Я владелец</div>
      <div class="platform-form">
        <button class="onboarding-btn" style="margin-bottom:12px" onclick="state.screen='ownerRegister'; render()">Создать заведение</button>
        <button class="onboarding-btn secondary" onclick="openExistingVenue()">У меня уже есть заведение</button>
      </div>
    </div>
  `;
}

function openExistingVenue() {
  if (state.venue && state.auth && state.auth.role === 'owner') {
    state.screen = 'ownerDashboard';
    render();
    return;
  }
  state.platformDraft = { role: 'owner' };
  state.screen = 'ownerLogin';
  render();
}

function renderOwnerLogin() {
  const draft = state.platformDraft || {};
  const code = draft.code || '';
  const ownerPin = draft.ownerPin || '';
  const valid = isValidVenueCode(code) && isValidVenueCode(ownerPin);
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="backToRoleSelect()">← Назад</button>
      </div>
      <div class="platform-title">Вход для владельца</div>
      <div class="platform-form">
        <label class="platform-label">Код заведения</label>
        <input class="platform-input code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" id="owner-login-code" value="${code}" placeholder="178617" maxlength="6" oninput="let v = this.value.replace(/[^0-9]/g,''); if (v !== this.value) this.value = v; updatePlatformDraft('code', v); validatePlatformButton()">
        <label class="platform-label">Пин владельца</label>
        <input class="platform-input code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" id="owner-login-pin" value="${ownerPin}" placeholder="178617" maxlength="6" oninput="let v = this.value.replace(/[^0-9]/g,''); if (v !== this.value) this.value = v; updatePlatformDraft('ownerPin', v); validatePlatformButton()">
        <div class="platform-hint" style="font-size:13px;color:var(--muted);margin-bottom:12px">Изначально пин владельца совпадает с кодом заведения.</div>
        <button id="platform-primary-btn" class="onboarding-btn ${valid ? '' : 'disabled'}" onclick="ownerLogin()">Войти</button>
      </div>
    </div>
  `;
}

async function ownerLogin() {
  const draft = state.platformDraft || {};
  const code = (draft.code || '').trim();
  const ownerPin = (draft.ownerPin || '').trim();
  if (!isValidVenueCode(code) || !isValidVenueCode(ownerPin)) return;

  if (!supabaseClient) {
    showPlatformToast('Нет подключения к серверу. Создайте или импортируйте заведение.');
    return;
  }

  let remoteData = null;
  try {
    remoteData = await safeRpc('owner_login', { p_code: code, p_owner_pin: ownerPin });
    if (!remoteData) {
      showPlatformToast('Код или пин владельца не найдены.');
      return;
    }
  } catch (e) {
    if (isNetworkError(e)) { showPlatformToast(networkErrorMessage(e)); return; }
    if (e.message && e.message.includes('Could not find the function public.owner_login')) {
      showPlatformToast('Схема Supabase устарела. Обновите SQL-скрипт в проекте.');
    } else {
      showPlatformToast('Ошибка входа: ' + e.message);
    }
    return;
  }

  const remoteVenue = normalizeVenue(remoteData);
  const ownerToken = remoteData.ownerToken || null;
  if (!remoteVenue || !ownerToken) {
    showPlatformToast('Не удалось загрузить заведение.');
    return;
  }

  const auth = { role: 'owner', name: 'Владелец', venueId: remoteVenue.id, code: code, ownerToken: ownerToken };
  state.auth = auth;
  state.venue = remoteVenue;
  state.profile = { nickname: 'Владелец', avatar: cloneAvatar() };
  state.platformDraft = null;
  saveProgress({ auth: auth, venue: remoteVenue, profile: state.profile });
  applyVenueStyle(remoteVenue.style || 'modern', remoteVenue.bgImage || null);
  window.renderHome = renderPlatformHome;
  state.screen = remoteVenue.sections && remoteVenue.sections.some(s => s.items && s.items.length) ? 'home' : 'ownerSetup';
  render();
  showPlatformToast('Заведение загружено');
}

function renderOwnerSetup() {
  const venue = state.venue;
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="logoutPlatform()">← Выйти</button>
      </div>
      <div class="platform-title">${venue.name}</div>
      <div class="platform-subtitle">Код для сотрудников: <span class="venue-code">${venue.code}</span></div>
      <div class="platform-form">
        <label class="platform-label">Загрузите файл меню</label>
        <div class="upload-zone" onclick="document.getElementById('ttk-file').click()">
          <div class="upload-icon"></div>
          <div class="upload-text">Нажмите, чтобы выбрать файл</div>
          <div class="upload-hint">.txt, .md, .csv, .json, .docx</div>
        </div>
        <input type="file" id="ttk-file" style="display:none" accept=".txt,.md,.csv,.json,.docx" onchange="handleTTKFile(this.files[0])">

        <label class="platform-label" style="margin-top:18px;">Или вставьте текст ТТК</label>
        <textarea id="ttk-paste" class="platform-input" rows="6" placeholder="Например:\nКапучино\n• Эспрессо 30 мл\n• Молоко 150 мл\n• Молочная пена 30 г"></textarea>
        <button class="onboarding-btn" onclick="parseTTKPastePreview()">Распознать и открыть редактор</button>

        <div class="demo-hint">Нет файла? <button class="link-btn" onclick="loadDemoVenue()">Загрузить демо-меню</button></div>
      </div>
    </div>
  `;
}

function renderOwnerDashboard() {
  const venue = state.venue;
  const sections = getVenueSections();
  const itemCount = sections.reduce((sum, s) => sum + (s.items ? s.items.length : 0), 0);
  const staffList = state.staffList || venue.staff || [];
  const staffRows = staffList.length ? staffList.map(s => `
    <div class="section-row">
      <div>
        <div class="section-row-name">${escapeHtml(s.name)}</div>
        <div class="section-row-meta">с ${new Date(s.joined_at).toLocaleDateString()}</div>
      </div>
      <button class="section-row-action" onclick="removeStaff('${escapeHtml(s.name)}')">Удалить</button>
    </div>
  `).join('') : '<div class="section-empty">Пока нет сотрудников</div>';

  app.innerHTML = `
    <div class="top-bar">
      <button class="close-btn" onclick="ownerBackToHome()">← Назад</button>
      <div class="path-title">${venue.name}</div>
      <button class="settings-btn" onclick="logoutPlatform()" aria-label="Выйти">×</button>
    </div>
    <div class="platform-dashboard">
      <div class="dashboard-card">
        <div class="dashboard-label">Код для сотрудников</div>
        <div class="venue-code">${venue.code}</div>
        <div class="dashboard-hint">Сотрудник вводит этот код при регистрации</div>
        <div class="dashboard-code-actions" style="display:flex;gap:8px;margin-top:12px;justify-content:center;flex-wrap:wrap;">
          <button class="stats-btn" style="margin:0;" onclick="copyVenueCode()">Копировать</button>
          <button class="stats-btn" style="margin:0;" onclick="regenerateVenueCode()">Сменить</button>
        </div>
      </div>
      <div class="dashboard-grid">
        <div class="dashboard-stat">
          <div class="dashboard-stat-value">${itemCount}</div>
          <div class="dashboard-stat-label">Позиций в меню</div>
        </div>
        <div class="dashboard-stat">
          <div class="dashboard-stat-value">${sections.length}</div>
          <div class="dashboard-stat-label">Разделов</div>
        </div>
        <div class="dashboard-stat">
          <div class="dashboard-stat-value">${staffList.length}</div>
          <div class="dashboard-stat-label">Сотрудников</div>
        </div>
      </div>
      <div class="section-management">
        <div class="platform-label">Сотрудники</div>
        ${staffRows}
      </div>
      <div class="section-management">
        <div class="platform-label">Разделы</div>
        ${sections.length ? sections.map(s => `
          <div class="section-row">
            <div>
              <div class="section-row-name">${s.name}</div>
              <div class="section-row-meta">${s.items ? s.items.length : 0} позиций • ${Math.ceil((s.items ? s.items.length : 0) / 8)} уроков</div>
            </div>
            <button class="section-row-action" onclick="editSection('${s.id}')">Изменить</button>
            <button class="section-row-action" onclick="deleteSection('${s.id}')">Удалить</button>
          </div>
        `).join('') : '<div class="section-empty">Пока нет разделов</div>'}
        <button class="onboarding-btn secondary" onclick="promptNewSection()">+ Новый раздел</button>
      </div>
      <button class="stats-btn" style="${cementStyle()}" onclick="showOwnerStats()">Статистика</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="state.screen='ownerSetup'; render()">Загрузить ТТК</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="renderTrainingSettings()">Настройки обучения</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="generateVenueMoodImage()">Сгенерировать фон заведения</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="exportVenueFile()">Экспортировать заведение</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="document.getElementById('venue-import-file').click()">Импортировать бэкап</button>
      <input type="file" id="venue-import-file" style="display:none" accept=".json,application/json" onchange="importVenueBackup(this.files[0])">
    </div>
  `;
}

function renderTrainingSettings() {
  const settings = getVenueSettings();
  const showGrams = settings.showGrams !== false;
  const requireGrams = showGrams && settings.requireGrams !== false;
  const formats = settings.formats || {};
  const formatLabels = {
    logical: 'Логический',
    missing: 'С пропусками',
    color_coded: 'Цветовой',
    spatial: 'Пространственный'
  };
  const formatDesc = {
    logical: 'Простой выбор ингредиентов',
    missing: 'Указать недостающий компонент',
    color_coded: 'Распределение по цветовым группам',
    spatial: 'Выбор зон подачи/стакана'
  };
  const formatToggles = Object.keys(formatLabels).map(f => {
    const on = formats[f] !== false;
    return `
      <div class="settings-row" style="cursor:pointer" onclick="toggleVenueSetting('format_${f}', this)">
        <div class="settings-row-text">
          <div class="settings-row-label">${formatLabels[f]}</div>
          <div class="settings-row-desc">${formatDesc[f]}</div>
        </div>
        <div class="toggle ${on ? 'on' : ''}" aria-checked="${on ? 'true' : 'false'}"><div class="toggle-knob"></div></div>
      </div>
    `;
  }).join('');
  const speedMode = settings.speedMode || { enabled: false, timeLimit: 15 };
  const speedEnabled = speedMode.enabled === true;
  const speedLimit = Math.max(5, Math.min(60, Number(speedMode.timeLimit) || 15));
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="stats-modal" style="width:min(92vw,420px);max-height:80vh;overflow:auto;">
      <div class="stats-modal-header">
        <div class="stats-modal-title">Настройки обучения</div>
        <button class="stats-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="settings-list">
        <div class="settings-row" style="cursor:pointer" onclick="toggleVenueSetting('showGrams', this)">
          <div class="settings-row-text">
            <div class="settings-row-label">Показывать граммы</div>
            <div class="settings-row-desc">Показывать сотрудникам граммовки в уроках и справочнике</div>
          </div>
          <div class="toggle ${showGrams ? 'on' : ''}" aria-checked="${showGrams ? 'true' : 'false'}"><div class="toggle-knob"></div></div>
        </div>
        <div class="settings-row" style="cursor:pointer;opacity:${showGrams ? 1 : 0.5}" onclick="if(getVenueSettings().showGrams===false)return;toggleVenueSetting('requireGrams', this)">
          <div class="settings-row-text">
            <div class="settings-row-label">Требовать ввод граммов</div>
            <div class="settings-row-desc">Сотрудник должен ввести граммовку каждого ингредиента</div>
          </div>
          <div class="toggle ${requireGrams ? 'on' : ''}" aria-checked="${requireGrams ? 'true' : 'false'}"><div class="toggle-knob"></div></div>
        </div>
        <div class="settings-row" style="cursor:pointer" onclick="toggleVenueSetting('speedEnabled', this)">
          <div class="settings-row-text">
            <div class="settings-row-label">Скоростной режим</div>
            <div class="settings-row-desc">Таймер на каждый вопрос; быстрые правильные ответы дают бонус XP</div>
          </div>
          <div class="toggle ${speedEnabled ? 'on' : ''}" aria-checked="${speedEnabled ? 'true' : 'false'}"><div class="toggle-knob"></div></div>
        </div>
        <div class="settings-row" style="opacity:${speedEnabled ? 1 : 0.5}">
          <div class="settings-row-text">
            <div class="settings-row-label">Время на вопрос</div>
            <div class="settings-row-desc">Секунд для ответа в скоростном режиме</div>
          </div>
          <input class="platform-input" type="number" inputmode="numeric" min="5" max="60" value="${speedLimit}" style="width:70px;text-align:center" onchange="updateSpeedLimit(this.value)">
        </div>
        <div class="settings-row" style="margin-top:8px;cursor:default;">
          <div class="settings-row-text">
            <div class="settings-row-label">Форматы вопросов</div>
            <div class="settings-row-desc">Какие типы заданий показывать сотрудникам</div>
          </div>
        </div>
        ${formatToggles}
      </div>
      <p class="settings-hint">Настройки сохраняются для всех сотрудников заведения.</p>
    </div>
  `;
  document.body.appendChild(overlay);
}

function toggleVenueSetting(key, row) {
  const settings = getVenueSettings();
  const next = { ...settings };
  if (key === 'showGrams') {
    next.showGrams = !settings.showGrams;
    if (!next.showGrams) next.requireGrams = false;
  } else if (key === 'requireGrams') {
    next.requireGrams = !settings.requireGrams;
    if (next.requireGrams) next.showGrams = true;
  } else if (key === 'speedEnabled') {
    next.speedMode = { ...(settings.speedMode || {}), enabled: !(settings.speedMode && settings.speedMode.enabled) };
  } else if (key.startsWith('format_')) {
    const f = key.replace('format_', '');
    next.formats = { ...(settings.formats || {}), [f]: !(settings.formats || {})[f] };
  }
  updateVenueSettings(next);
  const overlay = row.closest('.modal-overlay');
  if (overlay) overlay.remove();
  renderTrainingSettings();
}

function updateSpeedLimit(value) {
  const n = Math.max(5, Math.min(60, parseInt(value) || 15));
  const settings = getVenueSettings();
  updateVenueSettings({ ...settings, speedMode: { ...(settings.speedMode || {}), timeLimit: n } });
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.remove();
  renderTrainingSettings();
}

function formatDateTime(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function accuracyBar(pct) {
  const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--gold)' : 'var(--red)';
  return `<div class="accuracy-bar" style="width:100%;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;margin-top:6px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width .4s ease"></div></div>`;
}

function renderOwnerStats() {
  const stats = state.trainingStats || { staff: [], items: [] };
  const staff = stats.staff || [];
  const items = stats.items || [];
  const totalAttempts = staff.reduce((sum, s) => sum + (s.total || 0), 0);
  const avgAccuracy = staff.length ? Math.round((staff.reduce((sum, s) => sum + (s.accuracy || 0), 0) / staff.length) * 100) : 0;

  const staffRows = staff.map(s => {
    const pct = s.total ? Math.round((s.accuracy || 0) * 100) : 0;
    return `
    <div class="section-row" style="flex-direction:column;align-items:stretch;gap:4px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div class="section-row-name">${escapeHtml(s.login)}</div>
          <div class="section-row-meta">${s.correct || 0} / ${s.total || 0} верно • последняя активность: ${formatDateTime(s.lastActive)}</div>
        </div>
        <div style="font-weight:700;font-size:16px">${pct}%</div>
      </div>
      ${accuracyBar(pct)}
    </div>
  `}).join('') || '<div class="section-empty">Пока нет данных по сотрудникам</div>';

  const weakItems = [...items].filter(i => (i.total || 0) > 0).sort((a, b) => (a.accuracy || 0) - (b.accuracy || 0)).slice(0, 5);
  const weakRows = weakItems.map(it => {
    const pct = it.total ? Math.round((it.accuracy || 0) * 100) : 0;
    return `
    <div class="section-row" style="justify-content:space-between">
      <div class="section-row-name">${escapeHtml(it.name)}</div>
      <div style="font-weight:700;color:var(--red)">${pct}%</div>
    </div>
  `}).join('') || '<div class="section-empty">Нет данных</div>';

  const itemRows = items.map(it => {
    const pct = it.total ? Math.round((it.accuracy || 0) * 100) : 0;
    return `
    <div class="section-row" style="justify-content:space-between">
      <div class="section-row-name">${escapeHtml(it.name)}</div>
      <div style="font-weight:700">${pct}%</div>
    </div>
  `}).join('') || '<div class="section-empty">Пока нет данных по позициям</div>';

  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="ownerDashboard()">← Назад</button>
      </div>
      <div class="platform-title">Прогресс сотрудников</div>
      <div class="platform-form">
        <div class="dashboard-grid" style="margin-bottom:16px">
          <div class="dashboard-stat">
            <div class="dashboard-stat-value">${totalAttempts}</div>
            <div class="dashboard-stat-label">Всего попыток</div>
          </div>
          <div class="dashboard-stat">
            <div class="dashboard-stat-value">${avgAccuracy}%</div>
            <div class="dashboard-stat-label">Средняя точность</div>
          </div>
          <div class="dashboard-stat">
            <div class="dashboard-stat-value">${staff.length}</div>
            <div class="dashboard-stat-label">Сотрудников</div>
          </div>
        </div>
        <div class="platform-label">По сотрудникам</div>
        ${staffRows}
        <div class="platform-label" style="margin-top:16px">Самые проблемные позиции</div>
        ${weakRows}
        <div class="platform-label" style="margin-top:16px">Все позиции</div>
        ${itemRows}
      </div>
    </div>
  `;
}

function renderStaffStats() {
  const stats = state.trainingStats || { staff: [], items: [] };
  const login = (state.auth && state.auth.login) || (state.profile && state.profile.nickname) || 'Ты';
  const myStats = (stats.staff || []).find(s => s.login === login) || { total: 0, correct: 0, accuracy: 0 };
  const itemRows = (stats.items || []).map(it => `
    <div class="section-row">
      <div>
        <div class="section-row-name">${escapeHtml(it.name)}</div>
        <div class="section-row-meta">${it.correct} / ${it.total} верно</div>
      </div>
      <div style="font-weight:700">${it.total ? Math.round((it.accuracy || 0) * 100) : 0}%</div>
    </div>
  `).join('') || '<div class="section-empty">Пока нет данных</div>';

  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="state.screen='home'; render()">← Назад</button>
      </div>
      <div class="platform-title">Моя статистика</div>
      <div class="platform-form">
        <div class="section-row">
          <div>
            <div class="section-row-name">Общая точность</div>
            <div class="section-row-meta">${myStats.correct} / ${myStats.total}</div>
          </div>
          <div style="font-weight:700">${myStats.total ? Math.round((myStats.accuracy || 0) * 100) : 0}%</div>
        </div>
        <div class="platform-label" style="margin-top:16px">По позициям</div>
        ${itemRows}
      </div>
    </div>
  `;
}

function renderStaffRegister() {
  const draft = state.platformDraft || {};
  const name = draft.name || '';
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="backToRoleSelect()">← Назад</button>
      </div>
      <div class="platform-title">Регистрация сотрудника</div>
      <div class="platform-form">
        <label class="platform-label">Ваше имя</label>
        <input class="platform-input" type="text" id="staff-name" value="${name}" placeholder="Анна" maxlength="30" oninput="updatePlatformDraft('name', this.value); validatePlatformButton()">
        <button id="platform-primary-btn" class="onboarding-btn ${name.trim() ? '' : 'disabled'}" onclick="registerStaff()">Далее</button>
      </div>
    </div>
  `;
}

function renderStaffJoin() {
  const draft = state.platformDraft || {};
  const code = draft.code || '';
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="state.screen='staffRegister'; render()">← Назад</button>
      </div>
      <div class="platform-title">Код заведения</div>
      <div class="platform-subtitle">Введите 6-значный код, который вам дал владелец</div>
      <div class="platform-form">
        <input class="platform-input code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" id="venue-code" value="${code}" placeholder="123456" maxlength="6" oninput="let v = this.value.replace(/[^0-9]/g,''); if (v !== this.value) this.value = v; updatePlatformDraft('code', v); validatePlatformButton()">
        <button id="platform-primary-btn" class="onboarding-btn ${code.trim().length === 6 ? '' : 'disabled'}" onclick="joinStaffVenue()">Присоединиться</button>
        <div class="demo-hint">Нет данных заведения? <button class="link-btn" onclick="document.getElementById('venue-import-file').click()">Импортировать файл</button></div>
        <input type="file" id="venue-import-file" style="display:none" accept=".json" onchange="importVenueFile(this.files[0], 'staffJoin')">
      </div>
    </div>
  `;
}

function renderPlatformHome() {
  const stats = getGlobalStats();
  const venue = state.venue;
  const isOwner = state.auth && state.auth.role === 'owner';
  const sections = getVenueSections();
  const hasSections = sections.length > 0;
  const itemCount = sections.reduce((sum, s) => sum + (s.items ? s.items.length : 0), 0);
  const bgImage = venue && venue.bgImage ? `url('${venue.bgImage}')` : '';
  const weakCount = (typeof getGlobalWeakCount === 'function') ? getGlobalWeakCount() : 0;

  app.innerHTML = `
    <div class="top-bar">
      <button class="profile-chip" onclick="openAvatarEditor()">
        ${renderAvatar(state.profile && state.profile.avatar, 32)}
        <span>${state.profile && state.profile.nickname || 'Ты'}</span>
      </button>
      <div style="flex:1"></div>
      ${!isOwner ? `
      <div class="top-bar-stat">
        <span class="icon"></span>
        <span class="streak-count">${stats.streak}</span>
      </div>
      <div class="top-bar-stat">
        <span class="icon"></span>
        <span class="xp-count">${stats.totalXP} XP</span>
      </div>
      ` : ''}
      <button class="settings-btn" onclick="showSettings()" aria-label="Настройки">≡</button>
    </div>
    <div class="home-screen" ${bgImage ? `style="--venue-bg:${bgImage}"` : ''}>
      <div class="mascot-area">
        <span class="mascot"></span>
        <div class="app-title">${venue ? venue.name : 'Cognitio'}</div>
  
      </div>
      ${!isOwner ? `
      ${renderDailyGoalCard()}
      <div class="daily-stats">
        <div class="daily-stat-card" style="${cementStyle()}">
          <div class="stat-value streak-count">${stats.streak}</div>
          <div class="stat-label">Серия дней</div>
        </div>
        <div class="daily-stat-card" style="${cementStyle()}">
          <div class="stat-value xp-count">${stats.totalXP}</div>
          <div class="stat-label">Всего XP</div>
        </div>
        <div class="daily-stat-card" style="${cementStyle()}">
          <div class="stat-value" style="color:var(--green)">${stats.totalLessons}</div>
          <div class="stat-label">Уроков</div>
        </div>
      </div>
      ` : ''}
      ${!isOwner ? `<button class="stats-btn" style="${cementStyle()}" onclick="showLearningStats()">Прогресс</button>` : ''}
      <button class="stats-btn" style="${cementStyle()}" onclick="goLeaderboard()">Рейтинг</button>
      ${!isOwner ? `<button class="stats-btn" style="${cementStyle()}" onclick="showAchievements()">Достижения ${renderAchievementBadge()}</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="showStaffStats()">Моя статистика</button>
      ${weakCount > 0 ? `<button class="stats-btn" style="${cementStyle()}" onclick="startWeakPractice()">Тренировка слабых мест (${weakCount})</button>` : ''}` : ''}
      ${!isOwner ? (hasSections ? sections.map(s => `
        <button class="section-card" style="${cementStyle()}" onclick="startVenueCourse('${s.id}')">
          <div class="card-img-wrap">
            <div class="card-img-placeholder">${s.image ? `<img src="${s.image}" alt="">` : getSectionEmoji(s.name)}</div>
          </div>
          <div class="card-info">
            ${s.name}
            <small>${s.items ? s.items.length : 0} позиций • ${Math.ceil((s.items ? s.items.length : 0) / 8)} уроков</small>
          </div>
          <div class="card-arrow">›</div>
        </button>
      `).join('') : `<div class="parsed-preview" style="background:rgba(255,255,255,0.05);color:var(--text-secondary)">${isOwner ? 'Загрузите ТТК, чтобы создать первый раздел' : 'Владелец ещё не загрузил меню'}</div>`) : ''}
      ${isOwner ? `<button class="section-card" style="${cementStyle()}" onclick="ownerDashboard()">
        <div class="card-img-wrap"><div class="card-img-placeholder">З</div></div>
        <div class="card-info">
          Управление заведением
          <small>Код, сотрудники, разделы, фон</small>
        </div>
        <div class="card-arrow">›</div>
      </button>` : ''}
      <button class="stats-btn" style="${cementStyle()}" onclick="logoutPlatform()">Выйти из аккаунта</button>
    </div>
  `;
}

function getSectionEmoji(name) {
  const n = (name || '').trim();
  return (n[0] || '?').toUpperCase();
}

function getVenueEmoji(style) {
  return '?';
}

// ====================== COURSE EDITOR ======================

function openCourseEditor() {
  const draft = state.platformDraft || {};
  if (!draft.parsedItems || !draft.parsedItems.length) {
    showPlatformToast('Сначала распознайте ТТК');
    return;
  }
  state.screen = 'courseEditor';
  render();
}

function renderCourseEditor() {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  const sectionName = draft.sectionName || 'Основное меню';
  const hasExisting = state.venue && state.venue.sections && state.venue.sections.length;
  const sectionOptions = hasExisting
    ? `<option value="">Новый раздел</option>` + state.venue.sections.map(s => `<option value="${s.name}">${s.name}</option>`).join('')
    : `<option value="">Основное меню</option>`;
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="state.screen='ownerSetup'; render()">← Назад</button>
      </div>
      <div class="platform-title">Редактор блюд</div>
      <div class="platform-subtitle">Проверьте названия, состав и граммовки</div>
      <div class="platform-form">
        <label class="platform-label">Сохранить в раздел</label>
        <div class="section-save-row">
          <select class="platform-input" id="editor-section-select" onchange="onEditorSectionChange(this.value)">
            ${sectionOptions}
          </select>
          <input class="platform-input" type="text" id="editor-section-name" value="${sectionName}" placeholder="Название раздела" oninput="updatePlatformDraft('sectionName', this.value); validatePlatformButton()">
        </div>
        <div class="editor-items">
          ${items.map((it, idx) => renderCourseEditorItem(it, idx)).join('')}
        </div>
        <button class="onboarding-btn secondary" onclick="addParsedItem()">+ Добавить позицию</button>
        <button id="platform-primary-btn" class="onboarding-btn" onclick="saveCourseFromEditor()">Сохранить (${items.length})</button>
      </div>
    </div>
  `;
}

function onEditorSectionChange(val) {
  const input = document.getElementById('editor-section-name');
  if (val) {
    state.platformDraft = state.platformDraft || {};
    state.platformDraft.sectionName = val;
    if (input) input.value = val;
  }
  validatePlatformButton();
}

function renderCourseEditorItem(it, idx) {
  ensureItemCorrectObjects(idx);
  const item = state.platformDraft.parsedItems[idx];
  const image = item.image || '';
  const componentsHTML = (item.correct || []).map((c, i) => renderEditorComponentRow(idx, i, c)).join('');
  return `
    <div class="editor-item" data-idx="${idx}">
      <div class="editor-item-header">
        <input class="platform-input editor-item-name" type="text" value="${escapeHtml(item.name)}" placeholder="Название позиции" oninput="updateParsedItem(${idx}, 'name', this.value)">
        <button class="editor-item-delete" onclick="deleteParsedItem(${idx})">×</button>
      </div>
      <div class="editor-item-section">
        <div style="font-size:12px;color:var(--text-secondary);margin:10px 0 6px">Состав</div>
        <div class="editor-components">
          ${componentsHTML || renderEditorComponentRow(idx, 0, { ingredient: '', grams: '' })}
        </div>
        <button class="editor-add-btn" onclick="addParsedComponent(${idx})">+ Добавить ингредиент</button>
      </div>
      <div class="editor-item-section">
        <div style="font-size:12px;color:var(--text-secondary);margin:10px 0 6px">Фото</div>
        <div class="editor-image-row">
          <input class="platform-input" type="text" value="${escapeHtml(image)}" placeholder="URL или загрузите файл" oninput="updateParsedItemImage(${idx}, this.value)">
          <input type="file" id="editor-img-${idx}" accept="image/*" style="display:none" onchange="handleEditorImage(${idx}, this.files[0])">
          <button class="editor-img-btn" onclick="document.getElementById('editor-img-${idx}').click()">+</button>
        </div>
      </div>
    </div>
  `;
}

function renderEditorComponentRow(itemIdx, compIdx, c) {
  const name = typeof c === 'object' ? (c.ingredient || '') : (c || '');
  const grams = typeof c === 'object' ? (c.grams || '') : '';
  return `
    <div class="editor-component-row">
      <input class="platform-input editor-comp-name" type="text" value="${escapeHtml(name)}" placeholder="Ингредиент" oninput="updateParsedComponentName(${itemIdx}, ${compIdx}, this.value)">
      <input class="platform-input editor-comp-grams" type="number" inputmode="decimal" placeholder="г" value="${grams}" oninput="updateParsedComponentGrams(${itemIdx}, ${compIdx}, this.value)">
      <button class="editor-comp-remove" onclick="removeParsedComponent(${itemIdx}, ${compIdx})">×</button>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function ensureItemCorrectObjects(idx) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  const correct = items[idx].correct || [];
  items[idx].correct = correct.map(c => typeof c === 'object' ? c : { ingredient: String(c || ''), grams: '' });
}

function updateParsedItem(idx, field, value) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  items[idx][field] = value.trim();
}

function updateParsedComponentName(idx, compIdx, value) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  ensureItemCorrectObjects(idx);
  const correct = items[idx].correct;
  if (!correct[compIdx]) correct[compIdx] = { ingredient: '', grams: '' };
  correct[compIdx].ingredient = value.trim();
}

function updateParsedComponentGrams(idx, compIdx, value) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  ensureItemCorrectObjects(idx);
  const correct = items[idx].correct;
  if (!correct[compIdx]) correct[compIdx] = { ingredient: '', grams: '' };
  const val = value.trim();
  correct[compIdx].grams = val === '' ? '' : parseFloat(val.replace(',', '.'));
}

function removeParsedComponent(idx, compIdx) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  ensureItemCorrectObjects(idx);
  items[idx].correct.splice(compIdx, 1);
  render();
}

function addParsedComponent(idx) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  ensureItemCorrectObjects(idx);
  items[idx].correct.push({ ingredient: '', grams: '' });
  render();
}

function updateParsedItemImage(idx, value) {
  updateParsedItem(idx, 'image', value);
}

function handleEditorImage(idx, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => updateParsedItemImage(idx, e.target.result);
  reader.readAsDataURL(file);
}

function deleteParsedItem(idx) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  items.splice(idx, 1);
  render();
}

function addParsedItem() {
  const draft = state.platformDraft || {};
  draft.parsedItems = draft.parsedItems || [];
  draft.parsedItems.push({
    type: 'composition',
    name: '',
    correct: [{ ingredient: '', grams: '' }],
    info_text: 'Состав:\n• ',
  });
  render();
}

function cleanParsedItemForSave(item) {
  const correct = (item.correct || [])
    .filter(c => {
      const name = typeof c === 'object' ? (c.ingredient || '').trim() : String(c || '').trim();
      return name.length > 0;
    })
    .map(c => {
      if (typeof c === 'object') {
        const raw = c.grams === '' || c.grams === undefined || c.grams === null ? '' : String(c.grams).replace(',', '.');
        const grams = raw === '' ? '' : (isNaN(parseFloat(raw)) ? 0 : parseFloat(raw));
        return { ingredient: c.ingredient.trim(), grams, isCount: !!c.isCount };
      }
      return { ingredient: String(c).trim(), grams: '' };
    });
  return { ...item, name: (item.name || '').trim(), correct };
}

function saveCourseFromEditor() {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items.length) return;

  const cleanedItems = items.map(cleanParsedItemForSave).filter(it => it.name && it.correct.length);
  if (!cleanedItems.length) {
    showPlatformToast('Нет позиций для сохранения');
    return;
  }

  const sectionName = (draft.sectionName || 'Основное меню').trim();
  const venue = state.venue;
  venue.sections = venue.sections || [];

  let target = venue.sections.find(s => s.name === sectionName);
  if (!target) {
    target = { id: generateId(), name: sectionName, items: [], createdAt: Date.now() };
    venue.sections.push(target);
  }

  const allComponentNames = new Set();
  cleanedItems.forEach(it => {
    it.correct.forEach(c => allComponentNames.add(c.ingredient));
  });
  const allComponentsArray = [...allComponentNames];
  const showGrams = getVenueSettings().showGrams !== false;

  target.items = cleanedItems.map(item => {
    const hasGrams = item.correct.some(c => c.grams > 0 || c.isCount);
    const correctNames = item.correct.map(c => c.ingredient);
    const distractors = shuffle(allComponentsArray.filter(c => !correctNames.includes(c))).slice(0, Math.min(6, Math.max(0, allComponentsArray.length - correctNames.length)));
    if (hasGrams) {
      return {
        type: 'composition',
        name: item.name,
        correct: item.correct,
        wrong: distractors,
        info_text: buildInfoText(item.name, item.correct, showGrams),
        image: item.image || null,
      };
    } else {
      const pool = shuffle([...correctNames, ...distractors]);
      return {
        type: 'composition',
        name: item.name,
        correct: correctNames,
        pool: pool,
        info_text: buildInfoText(item.name, correctNames, showGrams),
        image: item.image || null,
      };
    }
  });

  state.platformDraft = null;
  saveProgress({ venue: venue });
  syncVenue();
  window.renderHome = renderPlatformHome;
  state.screen = 'home';
  render();
  showPlatformToast(`Курс «${target.name}» сохранён`);
  playSound('correct');
}

function promptNewSection() {
  const name = window.prompt('Название нового раздела:', 'Новый раздел');
  if (name && name.trim()) {
    createSection(name.trim());
  }
}

function createSection(name) {
  const venue = state.venue;
  venue.sections = venue.sections || [];
  venue.sections.push({ id: generateId(), name, items: [], createdAt: Date.now() });
  saveProgress({ venue: venue });
  syncVenue();
  render();
}

function editSection(sectionId) {
  const section = getVenueSection(sectionId);
  if (!section) return;
  const draft = state.platformDraft || {};
  draft.parsedItems = (section.items || []).map(item => {
    const copy = JSON.parse(JSON.stringify(item));
    if (copy._normalized) delete copy._normalized;
    if (copy._ingredients) delete copy._ingredients;
    if (copy._grams) delete copy._grams;
    if (copy._pool) delete copy._pool;
    if (copy._wrongPool) delete copy._wrongPool;
    if (copy._hasGrams) delete copy._hasGrams;
    if (copy._image) { copy.image = copy._image; delete copy._image; }
    return copy;
  });
  draft.sectionName = section.name;
  state.platformDraft = draft;
  state.screen = 'courseEditor';
  render();
}

function deleteSection(sectionId) {
  const venue = state.venue;
  if (!venue || !venue.sections) return;
  venue.sections = venue.sections.filter(s => s.id !== sectionId);
  saveProgress({ venue: venue });
  syncVenue();
  render();
}

function generateVenueMoodImage() {
  const venue = state.venue;
  const style = VENUE_STYLES.find(s => s.id === venue.style) || VENUE_STYLES[0];
  const url = venueMoodImageUrl(style, venue.name);
  venue.bgImage = url;
  saveProgress({ venue: venue });
  syncVenue();
  const img = new Image();
  img.onload = () => {
    applyVenueBackground(style, url);
    render();
    showPlatformToast('Фон заведения обновлён');
  };
  img.onerror = () => showPlatformToast('Не удалось загрузить изображение. Попробуйте ещё раз.');
  img.src = url;
}

function applyVenueBackground(style, imageUrl) {
  let existing = document.getElementById('venue-bg');
  if (!existing) {
    existing = document.createElement('div');
    existing.id = 'venue-bg';
    existing.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;';
    document.body.prepend(existing);
  }
  const gradients = {
    modern: 'linear-gradient(135deg, rgba(26,26,26,0.95) 0%, rgba(45,58,30,0.92) 50%, rgba(0,0,0,0.95) 100%)',
    classic: 'linear-gradient(135deg, rgba(243,231,215,0.95) 0%, rgba(214,192,166,0.95) 100%)',
    rustic: 'linear-gradient(135deg, rgba(44,30,20,0.95) 0%, rgba(74,50,33,0.92) 50%, rgba(26,18,13,0.95) 100%)',
    minimal: 'linear-gradient(135deg, rgba(248,249,250,0.95) 0%, rgba(233,236,239,0.95) 100%)',
    neon: 'linear-gradient(135deg, rgba(13,2,33,0.95) 0%, rgba(42,10,59,0.92) 50%, rgba(0,0,0,0.95) 100%)',
  };
  if (imageUrl) {
    existing.style.background = `${gradients[style.id] || gradients.modern}, url('${imageUrl}') center/cover no-repeat`;
    existing.style.backgroundBlendMode = 'overlay';
    existing.style.opacity = '0.35';
  } else {
    existing.style.background = gradients[style.id] || gradients.modern;
    existing.style.opacity = '0.18';
  }
}

// ====================== PARSERS ======================

function handleTTKFile(file) {
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'docx') {
    handleDocxFile(file);
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const items = parseTTKText(text, ext);
    previewParsedItems(items, file.name);
  };
  reader.onerror = () => showPlatformToast('Не удалось прочитать файл');
  if (ext === 'json') {
    reader.readAsText(file);
  } else {
    reader.readAsText(file, 'UTF-8');
  }
}

function handleDocxFile(file) {
  if (typeof mammoth === 'undefined') {
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js')
      .then(() => handleDocxFile(file))
      .catch(() => showPlatformToast('Не удалось загрузить mammoth.js. Сконвертируйте .docx в .txt/.csv'));
    return;
  }
  file.arrayBuffer().then(arrayBuffer => {
    mammoth.convertToHtml({ arrayBuffer }).then(result => {
      const items = parseDocxHTML(result.value);
      previewParsedItems(items, file.name);
    }).catch(() => showPlatformToast('Не удалось извлечь текст из .docx'));
  });
}

function parseWeightToGrams(str) {
  if (!str) return null;
  const s = str.trim()
    .replace(/\s+/g, ' ')
    .replace(/,/g, '.')
    .replace(/(\d+)\s*\/\s*(\d+)/g, (m, a, b) => {
      const val = parseFloat(a) / parseFloat(b);
      return val.toFixed(3).replace(/\.?0+$/, '');
    });
  const units = ['кг','kg','г','гр','грамм','грам','мл','миллилитров','шт','штук','штуки','л','мг','g','gr','gram','grams','ml','pcs','pc'];
  const weightMult = { 'кг':1000,'kg':1000,'г':1,'гр':1,'грамм':1,'грам':1,'g':1,'gr':1,'gram':1,'grams':1,'мл':1,'миллилитров':1,'ml':1,'л':1000,'мг':0.001 };
  const countUnits = { 'шт':1,'штук':1,'штуки':1,'pcs':1,'pc':1 };
  const fractions = { '½':0.5,'¼':0.25,'¾':0.75,'⅓':0.333,'⅔':0.667 };
  const re = new RegExp('(\\d*[' + Object.keys(fractions).join('') + ']\\d*|\\d+(?:\\.\\d+)?)\\s*(' + units.join('|') + ')?', 'gi');
  const matches = [...s.matchAll(re)];
  const weightTokens = [];
  const countTokens = [];
  for (const m of matches) {
    const num = m[1];
    const unit = (m[2] || '').toLowerCase();
    let val;
    let isFraction = false;
    if (/\d/.test(num)) {
      val = parseFloat(num);
    } else {
      val = fractions[num] || 0;
      isFraction = true;
    }
    if (isNaN(val) || (val === 0 && !isFraction)) continue;
    if (unit && weightMult[unit] !== undefined) {
      weightTokens.push({ grams: val * weightMult[unit], hasUnit: true });
    } else if (unit && countUnits[unit] !== undefined) {
      countTokens.push({ count: val, hasUnit: true });
    } else if (isFraction) {
      countTokens.push({ count: val, hasUnit: false });
    } else {
      weightTokens.push({ grams: val * 1000, hasUnit: false });
    }
  }
  const explicit = weightTokens.filter(t => t.hasUnit);
  if (explicit.length) return { grams: Math.max(...explicit.map(t => t.grams)), isCount: false };
  if (weightTokens.length) return { grams: Math.max(...weightTokens.map(t => t.grams)), isCount: false };
  if (countTokens.length) return { grams: Math.max(...countTokens.map(t => t.count)), isCount: true };
  return null;
}

function parseDocxHTML(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const items = [];
  let pendingName = null;
  let pendingIsHeading = false;

  function nodeText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') return '\n';
      if (tag === 'table') return '';
      if (['script','style','head','title','meta','link'].includes(tag)) return '';
      return [...node.childNodes].map(nodeText).join('');
    }
    return '';
  }

  function isHeaderRow(cells) {
    if (!cells || cells.length < 2) return false;
    const joined = cells.join(' ').toLowerCase();
    return /№|номер|наименование|вес|количество|продукт|ингредиент|name|component|weight/.test(joined);
  }

  function isMenuTable(table) {
    const firstRow = table.querySelector('tr');
    if (!firstRow) return false;
    const cells = [...firstRow.querySelectorAll('td, th')]
      .map(c => c.textContent.replace(/\s+/g, ' ').trim().toLowerCase());
    const compIdx = cells.findIndex(h => /состав|ингредиент|ингредиенты|component|components|ingredient|ingredients/.test(h));
    const nameIdx = cells.findIndex((h, i) =>
      i !== compIdx && /название|блюдо|наименование|name|title|продукт|product/.test(h)
    );
    return compIdx !== -1 && nameIdx !== -1;
  }

  function parseMenuTable(table) {
    const rows = [...table.querySelectorAll('tr')];
    if (!rows.length) return null;
    const headerCells = [...rows[0].querySelectorAll('td, th')]
      .map(c => c.textContent.replace(/\s+/g, ' ').trim().toLowerCase());
    const compIdx = headerCells.findIndex(h => /состав|ингредиент|ингредиенты|component|components|ingredient|ingredients/.test(h));
    const nameIdx = headerCells.findIndex((h, i) =>
      i !== compIdx && /название|блюдо|наименование|name|title|продукт|product/.test(h)
    );
    if (compIdx === -1 || nameIdx === -1) return null;
    const out = [];
    for (const tr of rows.slice(1)) {
      const cells = [...tr.querySelectorAll('td, th')]
        .map(c => c.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (!cells.length || isHeaderRow(cells)) continue;
      const name = cleanItemName(cells[nameIdx >= 0 ? nameIdx : 0]);
      const compText = cells[compIdx] || '';
      if (!name || !compText) continue;
      const parts = compText.split(/[,;|\n]/).map(s => s.trim()).filter(Boolean);
      const components = [];
      for (const part of parts) {
        const parsed = parseWeightToGrams(part);
        const grams = parsed ? parsed.grams : 0;
        const isCount = parsed ? parsed.isCount : false;
        const ingredient = cleanItemName(part);
        if (!ingredient) continue;
        components.push({ ingredient, grams, isCount });
      }
      if (!components.length) continue;
      const infoLines = components.map(c => {
        if (!c.grams) return c.ingredient;
        const val = Number.isInteger(c.grams) ? c.grams : parseFloat(c.grams.toFixed(3));
        const suffix = c.isCount ? ' шт' : 'г';
        return `${c.ingredient} (${val}${suffix})`;
      });
      out.push({
        type: 'composition',
        name,
        correct: components.map(c => ({ ingredient: c.ingredient, grams: c.grams })),
        info_text: `Состав:\n• ${infoLines.join('\n• ')}`,
      });
    }
    return out.length ? out : null;
  }

  function parseIngredientTable(table, dishName) {
    const rows = [];
    for (const tr of table.querySelectorAll('tr')) {
      const cells = [...tr.querySelectorAll('td, th')]
        .map(c => c.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (!cells.length || isHeaderRow(cells)) continue;
      let nameIdx = 0;
      let weightIdx = 1;
      if (cells.length >= 3 && /^\d*№?$/i.test(cells[0].replace(/\s/g, ''))) {
        nameIdx = 1;
        weightIdx = 2;
      } else if (cells.length >= 2 && cells[0].toLowerCase().includes('наименование')) {
        nameIdx = 0;
        weightIdx = 1;
      }
      const name = cleanItemName(cells[nameIdx]);
      const weightStr = cells[weightIdx] || '';
      if (!name) continue;
      const parsed = parseWeightToGrams(weightStr);
      rows.push({
        ingredient: name,
        grams: parsed ? parsed.grams : 0,
        isCount: parsed ? parsed.isCount : false,
      });
    }
    if (!rows.length) return null;
    const components = rows.map(r => ({ ingredient: r.ingredient, grams: r.grams }));
    const infoLines = rows.map(r => {
      if (!r.grams) return r.ingredient;
      const val = Number.isInteger(r.grams) ? r.grams : parseFloat(r.grams.toFixed(3));
      const suffix = r.isCount ? ' шт' : 'г';
      return `${r.ingredient} (${val}${suffix})`;
    });
    return {
      type: 'composition',
      name: dishName ? cleanItemName(dishName) : components[0].ingredient,
      correct: components,
      info_text: `Состав:\n• ${infoLines.join('\n• ')}`,
    };
  }

  const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

  for (const child of wrapper.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'table') {
      const menuItems = parseMenuTable(child);
      if (menuItems) {
        items.push(...menuItems);
      } else {
        const item = parseIngredientTable(child, pendingName);
        if (item) items.push(item);
      }
      pendingName = null;
      pendingIsHeading = false;
    } else {
      const tag = child.nodeType === Node.ELEMENT_NODE ? child.tagName.toLowerCase() : '';
      const isHeading = headingTags.includes(tag);
      const text = nodeText(child).trim();
      if (!text) continue;
      if (/^ттк$/i.test(text)) continue;
      if (/^[A-ZА-ЯЁ\d\s]+$/.test(text)) continue;
      if (isHeading || !pendingIsHeading) {
        pendingName = text;
        pendingIsHeading = isHeading;
      }
    }
  }

  return items;
}

function htmlBlockToText(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        out += '\n';
      } else if (tag === 'li') {
        out += '- ' + htmlBlockToText(child).trim() + '\n';
      } else if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        const inner = htmlBlockToText(child).trim();
        if (inner) out += inner + '\n\n';
      } else {
        out += htmlBlockToText(child);
      }
    }
  }
  return out;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function parseTTKText(text, format) {
  if (format === 'json') {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : (parsed.items || parsed.data || parsed.menu || parsed.venues || []);
      return arr.map(normalizeParsedItem).filter(Boolean);
    } catch (e) {
      return [];
    }
  }
  if (format === 'csv') {
    return parseTTKCSV(text);
  }
  return parseTTKPlainText(text);
}

function parseTTKPastePreview() {
  const textarea = document.getElementById('ttk-paste');
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text) return showPlatformToast('Вставьте текст ТТК');
  const items = parseTTKPlainText(text);
  if (!items || !items.length) return showPlatformToast('Не удалось распознать позиции');
  state.platformDraft = { parsedItems: items, sectionName: 'Основное меню' };
  openCourseEditor();
}

function parseTTKPlainText(text) {
  if (!text || !text.trim()) return [];
  const normalized = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .trim();

  let blocks = normalized.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);

  if (blocks.length === 1 && blocks[0].split('\n').length > 2) {
    const lines = blocks[0].split('\n').map(l => l.trim()).filter(Boolean);
    const split = maybeSplitBlocks(lines);
    if (split.length > 1) blocks = split;
  } else if (blocks.length > 1) {
    blocks = mergeHeadingBlocks(blocks);
  }

  const items = [];
  for (const block of blocks) {
    const item = parseItemBlock(block);
    if (item) items.push(item);
  }
  return items;
}

function mergeHeadingBlocks(blocks) {
  const merged = [];
  let skipNext = false;
  for (let i = 0; i < blocks.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const block = blocks[i];
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const isHeading = lines.length === 1 && /[:\-|–—]$/.test(lines[0]) && !/^[-•–—*‣⁃◦\d[\]()]/.test(lines[0]);
    if (isHeading && i + 1 < blocks.length) {
      const nextLines = blocks[i + 1].split('\n').map(l => l.trim()).filter(Boolean);
      if (nextLines.length && /^[-•–—*‣⁃◦\d[\]()]+/.test(nextLines[0])) {
        merged.push(block + '\n' + blocks[i + 1]);
        skipNext = true;
        continue;
      }
    }
    merged.push(block);
  }
  return merged;
}

function isLikelyComponent(line) {
  const s = (line || '').trim();
  if (!s) return false;
  if (/^[-•–—*‣⁃◦\d.)\]()]/.test(s)) return true;
  if (/п\/ф|пф/i.test(s)) return true;
  const units = ['г', 'гр', 'грамм', 'грам', 'мл', 'миллилитров', 'шт', 'штук', 'штуки', 'л', 'кг', 'кгр', 'мг', 'g', 'gr', 'gram', 'grams', 'ml', 'pcs', 'pc'];
  const unitRe = new RegExp('\\d+(?:[.,]\\d+)?\\s*(?:' + units.join('|') + ')(?:\\s|$|[.,;])', 'i');
  if (unitRe.test(s)) return true;
  if (/\d+(?:[.,]\d+)?\s*%/.test(s)) return true;
  return false;
}

function maybeSplitBlocks(lines) {
  const blocks = [];
  let current = [];
  const numbered = lines.filter(l => /^\d+[.)\]]\s+/.test(l)).length;
  const separators = lines.filter(l => /^[-=_]{3,}$/.test(l)).length;

  if (numbered >= 2) {
    for (const line of lines) {
      if (/^\d+[.)\]]\s+/.test(line) && current.length) {
        blocks.push(current.join('\n'));
        current = [line];
      } else {
        current.push(line);
      }
    }
  } else if (separators >= 2) {
    for (const line of lines) {
      if (/^[-=_]{3,}$/.test(line)) {
        if (current.length) blocks.push(current.join('\n'));
        current = [];
      } else {
        current.push(line);
      }
    }
  } else if (lines.length < 2) {
    return [lines.join('\n')];
  } else {
    function isSectionHeader(s) {
      return /^[A-ZА-ЯЁ\s\d]+$/.test(s) || /^[A-ZА-ЯЁ][A-ZА-ЯЁ\s\d]*:$/.test(s);
    }
    let prevWasComponent = isLikelyComponent(lines[0]);
    current = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const comp = isLikelyComponent(line);
      if (!comp && prevWasComponent && !isSectionHeader(line)) {
        blocks.push(current.join('\n'));
        current = [line];
      } else {
        current.push(line);
      }
      prevWasComponent = comp;
    }
  }

  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}

function parseItemBlock(block) {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const split = splitNameAndComponents(lines[0]);
  let name = split.name;
  let components = split.components;

  if (!components.length && lines.length > 1) {
    components = lines.slice(1).flatMap(extractComponents);
  }

  if (!components.length && lines.length === 1) {
    const fallback = splitNameAndComponents(lines[0], true);
    name = fallback.name;
    components = fallback.components;
  }

  if (!name || !components.length) return null;
  components = components.map(parseComponentToken).filter(Boolean);
  if (!components.length) return null;

  return {
    type: 'composition',
    name,
    correct: components,
    info_text: buildInfoText(name, components),
  };
}

function splitNameAndComponents(line, allowNoComponents) {
  const delimiters = [':', ' - ', ' – ', ' — ', '=>', '|', ';'];
  for (const delim of delimiters) {
    const idx = line.indexOf(delim);
    if (idx > 0) {
      const name = cleanItemName(line.slice(0, idx));
      const rest = line.slice(idx + delim.length);
      const components = extractComponents(rest);
      if (components.length || allowNoComponents) return { name, components };
    }
  }
  return { name: cleanItemName(line), components: [] };
}

function extractComponents(text) {
  if (!text) return [];
  return text.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
}

function cleanItemName(str) {
  if (!str) return '';
  let s = str.trim();
  s = s.replace(/п\\ф/gi, 'п/ф').trim();
  s = s.replace(/^[-•–—*‣⁃◦\d.)\]]+\s*/, '').trim();
  s = s.replace(/\s+\d+(?:[.,]\d+)?\s*(?:г|гр|грамм|грам|гр\.|мл|миллилитров|мл\.|шт|штук|штуки|л|кг|кгр|мг|g|gr|gram|grams|ml|pcs|pc)\s*[\).]*$/i, '').trim();
  s = s.replace(/[-:;|–—]+\s*$/, '').trim();
  return s;
}

function parseComponentToken(str) {
  if (!str) return null;
  let s = str.trim();
  s = s.replace(/^(?:[-•–—*‣⁃◦]+|\d+[.)\]])\s*/, '').trim();
  if (!s) return null;

  const units = '(?:г|гр|грамм|грам|мл|миллилитров|шт|штук|штуки|л|кг|кгр|мг|g|gr|gram|grams|ml|pcs|pc)';
  const countUnits = /^(шт|штук|штуки|pcs|pc)$/i;

  const trailingMatch = s.match(new RegExp('^(.*?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(' + units + ')\\s*[.)]*$', 'i'));
  if (trailingMatch && trailingMatch[1].trim()) {
    const ingredient = trailingMatch[1].trim();
    const grams = parseFloat(trailingMatch[2].replace(',', '.'));
    const isCount = countUnits.test(trailingMatch[3]);
    return { ingredient, grams: isNaN(grams) ? 0 : grams, isCount };
  }

  const leadingMatch = s.match(new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*(' + units + ')\\s*[-–—:]\\s*(.+)$', 'i'));
  if (leadingMatch && leadingMatch[3].trim()) {
    const ingredient = leadingMatch[3].trim();
    const grams = parseFloat(leadingMatch[1].replace(',', '.'));
    const isCount = countUnits.test(leadingMatch[2]);
    return { ingredient, grams: isNaN(grams) ? 0 : grams, isCount };
  }

  return s;
}

function buildInfoText(name, components, showGrams = true) {
  const list = components.map(c => {
    if (c && typeof c === 'object') {
      if (!showGrams || !c.grams) return c.ingredient;
      const val = Number.isInteger(c.grams) ? c.grams : parseFloat(c.grams.toFixed(3));
      const suffix = c.isCount ? ' шт' : 'г';
      return `${c.ingredient} (${val}${suffix})`;
    }
    return c || '';
  });
  return `Состав:\n• ${list.join('\n• ')}`;
}

function parseTTKCSV(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const delimiter = detectCSVDelimiter(lines[0]);
  const headers = parseCSVLine(lines[0], delimiter).map(h => h.trim().toLowerCase());
  const nameIdx = findHeaderIndex(headers, ['name', 'название', 'блюдо', 'напиток', 'item', 'title', 'продукт', 'position', 'позиция', 'назва']);
  const compIdx = findHeaderIndex(headers, ['component', 'components', 'ingredient', 'ingredients', 'ingr', 'состав', 'ингредиент', 'ингредиенты']);
  const gramsIdx = findHeaderIndex(headers, ['gram', 'grams', 'гр', 'грам', 'грамм', 'weight', 'вес', 'количество', 'кол-во', 'amount', 'мл', 'объем', 'объём']);

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i], delimiter);
    if (!cols.length) continue;

    if (nameIdx === -1) {
      const name = cleanItemName(cols[0] || '');
      const rest = cols.slice(1).join(',').trim();
      const components = extractComponents(rest).map(parseComponentToken).filter(Boolean);
      if (name && components.length) {
        items.push({ type: 'composition', name, correct: components, info_text: buildInfoText(name, components) });
      }
      continue;
    }

    const name = cleanItemName(cols[nameIdx] || '');
    if (!name) continue;

    let components = [];
    if (compIdx !== -1 && cols[compIdx]) {
      components = extractComponents(cols[compIdx]).map(parseComponentToken).filter(Boolean);
    }
    if (!components.length) {
      for (let j = 0; j < cols.length; j++) {
        if (j === nameIdx || j === gramsIdx) continue;
        const c = parseComponentToken(cols[j]);
        if (c) components.push(c);
      }
    }
    if (!components.length) continue;

    if (gramsIdx !== -1 && cols[gramsIdx]) {
      const gramsList = cols[gramsIdx].split(/[,;|]/).map(s => parseFloat(s.trim().replace(',', '.'))).filter(n => !isNaN(n));
      components = components.map((c, idx) => {
        if (typeof c === 'object') return c;
        const g = gramsList[idx];
        return g !== undefined ? { ingredient: c, grams: g } : c;
      });
    }

    items.push({ type: 'composition', name, correct: components, info_text: buildInfoText(name, components) });
  }
  return items;
}

function detectCSVDelimiter(line) {
  const delimiters = [',', ';', '\t'];
  let best = ',';
  let bestCount = 0;
  for (const d of delimiters) {
    const count = line.split(d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function findHeaderIndex(headers, candidates) {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h === c || h.includes(c));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseCSVLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const next = line[i + 1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeParsedItem(item) {
  if (!item || !item.name) return null;
  const correct = Array.isArray(item.correct) ? item.correct : (Array.isArray(item.components) ? item.components : (Array.isArray(item.ingredients) ? item.ingredients : []));
  if (!correct.length) return null;
  return {
    type: 'composition',
    name: item.name,
    correct: correct,
    info_text: item.info_text || buildInfoText(item.name, correct),
    image: item.image || null,
  };
}

function sourceNameToSectionName(sourceName) {
  if (!sourceName) return 'Основное меню';
  let cleaned = sourceName.replace(/\.[^.]+$/, '').trim();
  if (!cleaned) return 'Основное меню';
  if (/^вставленный текст$/i.test(cleaned)) return 'Основное меню';
  if (/demo|демо/i.test(cleaned)) return 'Демо';
  cleaned = cleaned.replace(/^.*[_\-]ttk[_\-]/i, '').replace(/^ttk[_\-]?/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'Основное меню';
}

function setParsedItems(items, sourceName) {
  buildVenueFromParsedItems(items, sourceName);
}

function previewParsedItems(items, sourceName) {
  if (!items || !items.length) {
    showPlatformToast('Не удалось распознать позиции');
    return;
  }
  state.platformDraft = { parsedItems: items, sectionName: sourceNameToSectionName(sourceName) };
  openCourseEditor();
}

function buildVenueFromParsedItems(items, sourceName) {
  if (!items || !items.length) {
    showPlatformToast('Не удалось распознать структуру файла. Проверьте формат.');
    return;
  }
  const venue = state.venue;
  if (!venue) return;

  const sectionName = sourceNameToSectionName(sourceName);
  const allComponentNames = new Set();
  items.forEach(item => {
    (item.correct || []).forEach(c => {
      const name = typeof c === 'object' ? c.ingredient : c;
      if (name) allComponentNames.add(name);
    });
  });
  const allComponentsArray = [...allComponentNames];

  const showGrams = getVenueSettings().showGrams !== false;
  const sectionItems = items.map(item => {
    const correct = item.correct || [];
    const hasGrams = correct.some(c => typeof c === 'object' && (c.grams > 0 || c.isCount));
    const correctNames = correct.map(c => typeof c === 'object' ? c.ingredient : c);
    const distractors = shuffle(allComponentsArray.filter(c => !correctNames.includes(c))).slice(0, Math.min(6, Math.max(0, allComponentsArray.length - correctNames.length)));
    if (hasGrams) {
      return {
        type: 'composition',
        name: item.name,
        correct: correct,
        wrong: distractors,
        info_text: buildInfoText(item.name, correct, showGrams),
        image: item.image || null,
      };
    } else {
      const pool = shuffle([...correctNames, ...distractors]);
      return {
        type: 'composition',
        name: item.name,
        correct: correctNames,
        pool: pool,
        info_text: buildInfoText(item.name, correctNames, showGrams),
        image: item.image || null,
      };
    }
  });

  venue.sections = venue.sections || [];
  const sectionKey = name => name.toLowerCase().replace(/[\s_\-]+/g, '');
  const existing = venue.sections.find(s => sectionKey(s.name) === sectionKey(sectionName));
  const section = existing || { id: generateId(), name: sectionName, items: [], createdAt: Date.now() };
  section.name = sectionName;
  section.items = sectionItems;
  section.createdAt = Date.now();
  if (!existing) venue.sections.push(section);
  // merge any accidental duplicate sections with the same normalized name, keeping the newest
  const bestByKey = new Map();
  for (const s of venue.sections) {
    const k = sectionKey(s.name);
    if (!bestByKey.has(k) || (s.createdAt || 0) > (bestByKey.get(k).createdAt || 0)) {
      bestByKey.set(k, s);
    }
  }
  venue.sections = [...bestByKey.values()];

  state.platformDraft = null;
  saveProgress({ venue: venue });
  syncVenue();
  window.renderHome = renderPlatformHome;
  state.screen = 'home';
  render();
  showPlatformToast(`Меню загружено: ${items.length} позиций`);
  playSound('correct');
}

function loadDemoVenue() {
  const demo = [
    { type: 'composition', name: 'Капучино', correct: ['Шот эспрессо', 'Молоко'], info_text: 'Состав:\n• Шот эспрессо\n• Молоко' },
    { type: 'composition', name: 'Латте', correct: ['Шот эспрессо', 'Молоко'], info_text: 'Состав:\n• Шот эспрессо\n• Молоко' },
    { type: 'composition', name: 'Раф', correct: ['Шот эспрессо', 'Молоко', 'Сливки 10%', 'Ванильный сахар'], info_text: 'Состав:\n• Шот эспрессо\n• Молоко\n• Сливки 10%\n• Ванильный сахар' },
  ];
  setParsedItems(demo, 'демо-меню');
}

function showPlatformToast(message) {
  const existing = document.querySelector('.platform-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'platform-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
