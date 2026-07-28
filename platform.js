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
      if (thenScreen) replaceScreen(thenScreen);
      else render();
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

function getVenueJoinUrl() {
  if (!state.venue || !state.venue.code) return '';
  const origin = window.location.origin;
  const pathname = window.location.pathname.replace(/\/$/, '');
  return origin + pathname + '?venue=' + encodeURIComponent(state.venue.code);
}

function getUrlParam(name) {
  try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
}

function showVenueQR() {
  const venue = state.venue;
  if (!venue || !venue.code) return;
  const joinUrl = getVenueJoinUrl();
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(joinUrl);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:1000;';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const modal = document.createElement('div');
  modal.style.cssText = 'position:relative;background:#18181b;padding:20px;border-radius:10px;max-width:360px;width:90%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
  modal.innerHTML = `
    <button class="close-btn" style="position:absolute;top:12px;right:16px;font-size:24px;" onclick="this.closest('div').parentElement.remove()">×</button>
    <div class="platform-title" style="margin-bottom:8px;">QR-код для сотрудников</div>
    <img src="${escapeHtml(qrUrl)}" alt="QR" style="width:100%;max-width:280px;margin:12px auto;display:block;border-radius:8px;">
    <div class="dashboard-hint">Сканируйте, чтобы открыть приложение с уже введённым кодом заведения</div>
    <button class="stats-btn" style="margin-top:16px;" onclick="copyToClipboard('${escapeHtml(joinUrl)}')">Копировать ссылку</button>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
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
  return ['authOptions', 'login', 'register', 'forgotPassword', 'resetPassword', 'roleSelect', 'ownerOptions', 'ownerLogin', 'ownerRegister', 'ownerSetup', 'courseEditor', 'ownerDashboard', 'ownerSettings', 'ownerStats', 'staffStats', 'sectionPicker', 'staffRegister', 'staffJoin'].includes(state.screen);
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
  if (!venue.images) venue.images = [];
  if (venue.instagram === undefined) venue.instagram = '';
  venue.sections.forEach(s => { if (s.image === undefined) s.image = ''; });
  delete venue.items;

  venue.sectionSettings = venue.sectionSettings || {};
  venue.sections.forEach(s => {
    const key = 'venue_' + s.id;
    if (!venue.sectionSettings[key]) {
      venue.sectionSettings[key] = JSON.parse(JSON.stringify(venue.settings || {}));
    }
  });
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

function getSectionSettings(sectionKey = state.section) {
  const defaults = { showGrams: false, requireGrams: false, speedMode: { enabled: false, timeLimit: 15 }, formats: { logical: true, missing: true, color_coded: true, spatial: true, photo: true } };
  const venueSettings = (state.venue && state.venue.settings) || {};
  const sectionSettings = (sectionKey && state.venue && state.venue.sectionSettings && state.venue.sectionSettings[sectionKey]) || {};
  return {
    ...defaults,
    ...venueSettings,
    ...sectionSettings,
    formats: { ...defaults.formats, ...(venueSettings.formats || {}), ...(sectionSettings.formats || {}) },
    speedMode: { ...defaults.speedMode, ...(venueSettings.speedMode || {}), ...(sectionSettings.speedMode || {}) }
  };
}

function updateSectionSettings(sectionKey, patch) {
  if (!state.venue || !sectionKey) return;
  if (!state.venue.sectionSettings) state.venue.sectionSettings = {};
  state.venue.sectionSettings[sectionKey] = { ...getSectionSettings(sectionKey), ...patch };
  if (state.venue.sectionSettings[sectionKey].speedMode && patch.speedMode) {
    state.venue.sectionSettings[sectionKey].speedMode = { ...getSectionSettings(sectionKey).speedMode, ...patch.speedMode };
  }
  if (state.venue.sectionSettings[sectionKey].formats && patch.formats) {
    state.venue.sectionSettings[sectionKey].formats = { ...getSectionSettings(sectionKey).formats, ...patch.formats };
  }
  saveProgress({ venue: state.venue });
  syncVenue();
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
  window.renderHome = renderPlatformHome;

  if (state.venue && state.venue.style) {
    applyVenueStyle(state.venue.style, state.venue.bgImage || null);
  }

  const joinCode = getUrlParam('venue');
  state.platformDraft = {};
  window.renderHome = (state.auth && state.auth.role === 'owner') ? renderOwnerHome : renderPlatformHome;
  if (!state.auth && joinCode && /^\d{6}$/.test(joinCode)) {
    state.screen = 'staffJoin';
    state.platformDraft = { code: joinCode };
  } else if (state.auth && state.venue) {
    if (state.auth.role === 'owner') {
      state.screen = (state.venue.sections && state.venue.sections.some(s => s.items && s.items.length)) ? 'home' : 'ownerSetup';
    } else {
      state.screen = 'home';
    }
  } else if (p.profile) {
    state.screen = 'home';
  } else {
    state.screen = 'authOptions';
  }

  const urlParams = new URLSearchParams(location.search);
  if (urlParams.get('screen') === 'reference' && state.venue) state.screen = 'reference';
  if (urlParams.get('standalone') === '1') state.standalone = true;

  initHistory();
  applyTheme(getSettings().theme);
  applyAnimationPref();
  checkAchievements();
  render();
  loadAvatarConfig().then(() => {
    if (!isPlatformScreen()) render();
  });
}

function initHistory() {
  if (!history.state || !history.state.cognitio) {
    history.replaceState({ cognitio: true, screen: state.screen }, '');
    history.pushState({ cognitio: true, screen: state.screen }, '');
  } else if (history.state.screen !== state.screen) {
    history.replaceState({ cognitio: true, screen: state.screen }, '');
  }
  if (!window.__cognitioPopstate) {
    window.__cognitioPopstate = true;
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.cognitio) {
        state.screen = e.state.screen;
        state.platformDraft = {};
        if (state.screen === 'home') state.section = null;
        render();
      }
    });
  }
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
  goToScreen('register', { role });
}

function goToScreen(screen, draftPatch) {
  if (state.screen === 'reference' && screen !== 'reference' && state.referenceRefreshInterval) {
    clearInterval(state.referenceRefreshInterval);
    state.referenceRefreshInterval = null;
  }
  if (state.screen === screen) {
    if (draftPatch === true) state.platformDraft = {};
    else if (draftPatch && typeof draftPatch === 'object') state.platformDraft = { ...(state.platformDraft || {}), ...draftPatch };
    render();
    return;
  }
  if (draftPatch === true) state.platformDraft = {};
  else if (draftPatch && typeof draftPatch === 'object') state.platformDraft = { ...(state.platformDraft || {}), ...draftPatch };
  state.screen = screen;
  history.pushState({ cognitio: true, screen: screen }, '');
  render();
}

function replaceScreen(screen, draftPatch) {
  if (draftPatch === true) state.platformDraft = {};
  else if (draftPatch && typeof draftPatch === 'object') state.platformDraft = { ...(state.platformDraft || {}), ...draftPatch };
  state.screen = screen;
  history.replaceState({ cognitio: true, screen: screen }, '');
  render();
}

function goBack() {
  if (history.length > 1) {
    history.back();
  } else {
    replaceScreen(state.auth && state.venue ? 'home' : 'authOptions');
  }
}

function backToRoleSelect() {
  goBack();
}

function backToAuthOptions() {
  goBack();
}

function updatePlatformDraft(key, value) {
  state.platformDraft = state.platformDraft || {};
  state.platformDraft[key] = value;
}

function validatePlatformButton() {
  const draft = state.platformDraft || {};
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
    valid = (draft.code || '').trim().length === 6;
  } else if (state.screen === 'courseEditor') {
    valid = !!(draft.parsedItems && draft.parsedItems.length && draft.sectionName && draft.sectionName.trim());
  }
  const primaryBtn = document.getElementById('platform-primary-btn');
  const editorSaveBtn = document.getElementById('editor-save-btn');
  if (primaryBtn) primaryBtn.classList.toggle('disabled', !valid);
  if (editorSaveBtn) editorSaveBtn.classList.toggle('disabled', !valid);
}

function markEditorDirty() {
  if (state.screen !== 'courseEditor') return;
  state.editorDirty = true;
  const titleEl = document.getElementById('editor-sticky-title');
  const statusEl = document.getElementById('editor-save-status');
  const draft = state.platformDraft || {};
  const sectionName = (draft.sectionName || '').trim() || 'Новый раздел';
  if (titleEl) titleEl.textContent = `Редактор (${sectionName})`;
  if (statusEl) statusEl.textContent = 'Сохранение...';
  if (state.editorSaveTimeout) clearTimeout(state.editorSaveTimeout);
  state.editorSaveTimeout = setTimeout(() => autoSaveCourseFromEditor(), 600);
}

function autoSaveCourseFromEditor() {
  if (state.screen !== 'courseEditor') return;
  if (!state.editorDirty) return;
  const statusEl = document.getElementById('editor-save-status');
  if (persistCourseEditor()) {
    state.editorDirty = false;
    if (statusEl) statusEl.textContent = 'Сохранено';
  } else {
    if (statusEl) statusEl.textContent = '';
  }
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
  window.renderHome = renderOwnerHome;
  replaceScreen('ownerSetup');
}

function registerStaff() {
  const draft = state.platformDraft || {};
  const name = (draft.name || '').trim();
  if (!name) return;
  goToScreen('staffJoin', { ...draft, step: 'code' });
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
  replaceScreen('home');
  syncPendingResults();
  playSound('correct');
}

function startVenueCourse(sectionId) {
  if (!state.venue || !state.venue.sections.length) return;
  loadVenueIntoState(sectionId);
  goToScreen('path');
}

function startMixedPractice() {
  const sections = getVenueSections();
  const allItems = sections.flatMap(s => s.items || []);
  if (!allItems.length) return showPlatformToast('Нет позиций для тренировки');

  state.section = '__mixed__';
  state.sectionLabel = 'Случайный тест';
  state.allData = allItems.map(normalizeItem);
  state.lessons = [];
  state.isPractice = true;
  state.currentLessonIdx = -1;

  const pool = shuffle(state.allData).slice(0, 15);
  state.questions = generateQuestions(pool);
  state.currentQIdx = 0;
  state.hearts = 5;
  state.sessionXP = 0;
  state.sessionCorrect = 0;
  state.sessionTotal = 0;
  state._sessionCorrectStreak = 0;
  state.mistakeIds = [];
  state.basicMistakeIds = [];
  state._sessionDishNames = new Set();
  state.feedbackShown = false;
  state.selectedOptions = new Set();
  state.selectedChoice = null;
  state.gramInputs = {};
  state._questionStartTime = Date.now();
  goToScreen('lesson');
}

function logoutPlatform() {
  saveProgress({ auth: null, staff: null, profile: null });
  state.auth = null;
  state.staff = null;
  state.profile = null;
  replaceScreen('authOptions');
}

function ownerDashboard() {
  goToScreen('ownerDashboard');
  loadStaffList();
}

function ownerBackToHome() {
  goBack();
}

function renderOwnerHome() {
  loadStaffList();
  replaceScreen('ownerDashboard');
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
  goToScreen('ownerStats');
  loadTrainingStats();
}

function showStaffStats() {
  goToScreen('staffStats');
  loadTrainingStats();
}

// ====================== RENDERERS ======================

function renderAuthOptions() {
  app.innerHTML = `
    <div class="platform-screen landing-layout landing-v1">
      <nav class="landing-nav">
        <div class="landing-nav-brand">Cognitio</div>
        <div class="landing-nav-links">
          <button class="landing-nav-link" onclick="goToScreen('authOptions', true)">Продукт</button>
          <button class="landing-nav-link" onclick="goToScreen('roleSelect', true)">Решения</button>
          <button class="landing-nav-link" onclick="goToScreen('authOptions', true)">Тарифы</button>
          <button class="landing-nav-link" onclick="goToScreen('authOptions', true)">О нас</button>
        </div>
        <div class="landing-nav-actions">
          <button class="landing-nav-link" onclick="goToScreen('login', true)">Войти</button>
          <button class="landing-nav-cta" onclick="goToScreen('roleSelect', true)">Попробовать бесплатно</button>
        </div>
      </nav>
      <div class="landing-main">
        <div class="landing-hero">
          <div class="brand">Обучение в формате Duolingo для бизнеса</div>
          <div class="hero-brain-wrap">
            <img src="img/hero-brain.png" class="hero-brain" alt="">
            <h1>Знания, которые создают <span class="hero-gold">качество</span> сервиса</h1>
          </div>
          <p>Обучайте сотрудников меню заведения за 10 минут в день. ТТК, тесты, прогресс.</p>
          <div class="landing-cta">
            <button class="landing-btn-primary" onclick="goToScreen('roleSelect', true)">
              <span>Попробовать бесплатно</span>
              <svg class="btn-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </button>
            <button class="landing-btn-secondary" onclick="goToScreen('roleSelect', true)">
              <svg class="btn-play" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <span>Смотреть демо</span>
            </button>
          </div>
          <div class="landing-logos-label">Доверяют лидеры индустрии</div>
          <div class="landing-logos">
            <span class="landing-logo">Cofix</span>
            <span class="landing-logo">Teremok</span>
            <span class="landing-logo">Додо</span>
            <span class="landing-logo">Вкусно — и точка</span>
          </div>
        </div>
        <div class="landing-phones">
          <div class="phone-mockup phone-1">
            <div class="phone-screen">
              <div class="phone-notch"></div>
              <div class="phone-title">УРОК 1</div>
              <div class="phone-dish">Какие ингредиенты входят в состав Цезарь с курицей?</div>
              <div class="phone-options">
                <div class="phone-option">Куриное филе</div>
                <div class="phone-option">Салат романо</div>
                <div class="phone-option">Соус цезарь</div>
                <div class="phone-option">Пармезан</div>
              </div>
            </div>
          </div>
          <div class="phone-mockup phone-2">
            <div class="phone-screen">
              <div class="phone-notch"></div>
              <div class="phone-title">ВАШ ПРОГРЕСС</div>
              <div class="phone-xp">675 XP</div>
              <div class="phone-level">Уровень 12</div>
              <div class="phone-progress">
                <div class="phone-progress-label">Цель дня</div>
                <div class="phone-progress-bar"><div class="phone-progress-fill" style="width:67%"></div></div>
              </div>
            </div>
          </div>
        </div>
        <div class="landing-auth">
          <div class="auth-panel">
            <div class="auth-header">
              <div class="auth-brain-wrap"><img src="img/hero-brain.png" class="auth-brain" alt=""></div>
              <div class="auth-brand">Cognitio</div>
            </div>
            <div class="auth-tagline">Знания, которые создают качество сервиса</div>
            <div class="auth-desc">Обучайте сотрудников меню заведения за 10 минут в день.</div>
            <button class="auth-login-btn" onclick="goToScreen('login', true)">
              <span>Войти</span>
              <svg class="btn-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </button>
            <button class="auth-register-btn" onclick="goToScreen('roleSelect', true)">Регистрация</button>
            <div class="auth-divider"><span>или продолжить с</span></div>
            <div class="auth-socials">
              <button class="auth-social" aria-label="Google" onclick="goToScreen('roleSelect', true)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2h-1.5c-3.5 0-6.5 2.5-7.3 6"></path><path d="M12 2c5.5 0 10 4.5 10 10s-4.5 10-10 10"></path></svg>
              </button>
              <button class="auth-social" aria-label="Apple" onclick="goToScreen('roleSelect', true)">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.7 8.1c-.9-.8-2.2-1.1-3.4-.7-.7.2-1.3.7-1.7 1.3-.5.8-.5 1.8-.1 2.6.2.4.5.8.9 1.1-1 1.6-2.5 2.6-4.3 2.6-1 0-2-.3-2.8-.9-1-.7-1.6-1.8-1.6-3 0-1.8 1.2-3.4 3-4 .6-.2 1.2-.3 1.8-.2.7.1 1.3.4 1.8.8l.2.2c.5-.8 1.2-1.4 2.1-1.8.9-.4 2-.5 3-.2 1.2.3 2.2 1.1 2.8 2.2-.3.2-.6.5-.9.7-.6.5-1.1 1.1-1.4 1.8-.4.9-.4 1.9 0 2.8.3.7.8 1.3 1.4 1.8.3.2.6.4.9.6-.4 1.1-1.1 2-2.1 2.7-1.2.9-2.8 1.4-4.3 1.1-.8-.2-1.5-.5-2.1-1l-.2-.2c-.6.7-1.3 1.2-2.2 1.5-.8.3-1.8.3-2.6-.1 1.3-1.2 2.1-2.9 2.1-4.7 0-1.9-1-3.6-2.6-4.5.3-1.3 1-2.4 2.1-3.1 1-.7 2.3-1 3.5-.7.6.1 1.1.4 1.6.7z"></path></svg>
              </button>
              <button class="auth-social" aria-label="Email" onclick="goToScreen('roleSelect', true)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><polyline points="2 7 12 13 22 7"></polyline></svg>
              </button>
            </div>
            <div class="auth-privacy">Нажимая кнопку, вы соглашаетесь с политикой конфиденциальности</div>
            <button class="link-btn auth-forgot" onclick="goToScreen('forgotPassword', { login: '' })">Забыли пароль?</button>
          </div>
        </div>
      </div>
      <div class="landing-features">
        <div class="feature-card">
          <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>
          <div class="feature-title">5 минут в день</div>
          <div class="feature-desc">Короткие занятия, которые легко вписать в смену.</div>
        </div>
        <div class="feature-card">
          <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.663 17h4.673M12 3v1M6.343 4.343l.707.707M17.657 4.343l-.707.707M4 12h1M19 12h1M12 21c-3.866 0-7-3.134-7-7a7 7 0 0 1 7-7 7 7 0 0 1 7 7c0 3.866-3.134 7-7 7z"></path></svg></div>
          <div class="feature-title">Запоминается надолго</div>
          <div class="feature-desc">Интервальные повторения и практика закрепляют знания.</div>
        </div>
        <div class="feature-card">
          <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg></div>
          <div class="feature-title">Контроль и аналитика</div>
          <div class="feature-desc">Отслеживайте прогресс каждого сотрудника и всей команды.</div>
        </div>
        <div class="feature-card">
          <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg></div>
          <div class="feature-title">Мотивация сотрудников</div>
          <div class="feature-desc">XP, уровни, достижения и лидерборды вовлекают в обучение.</div>
        </div>
      </div>
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
        <button class="link-btn" style="margin-top:12px" onclick="goToScreen('forgotPassword', { login: draft.login || '' })">Забыли пароль?</button>
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
    valid = baseValid && ((draft.venueName || '').trim().length > 0 || hasExistingCode) && (!(draft.venueCode || '').trim() || isValidVenueCode(draft.venueCode));
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
        <button class="close-btn" onclick="goBack()">← Назад</button>
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
  window.renderHome = user.role === 'owner' ? renderOwnerHome : renderPlatformHome;
  loadVenueIntoState();
  if (user.role === 'owner') {
    replaceScreen((remoteVenue.sections && remoteVenue.sections.some(s => s.items && s.items.length)) ? 'home' : 'ownerSetup');
  } else {
    replaceScreen('home');
  }
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
  const venuePin = venueCode;

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
    goToScreen('resetPassword');
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
      replaceScreen('login', { login });
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
        <button class="onboarding-btn" style="margin-bottom:12px" onclick="goToScreen('ownerRegister')">Создать заведение</button>
        <button class="onboarding-btn secondary" onclick="openExistingVenue()">У меня уже есть заведение</button>
      </div>
    </div>
  `;
}

function openExistingVenue() {
  if (state.venue && state.auth && state.auth.role === 'owner') {
    replaceScreen('ownerDashboard');
    return;
  }
  goToScreen('ownerLogin', { role: 'owner' });
}

function renderOwnerLogin() {
  const draft = state.platformDraft || {};
  const code = draft.code || '';
  const valid = isValidVenueCode(code);
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="goBack()">← Назад</button>
      </div>
      <div class="platform-title">Вход для владельца</div>
      <div class="platform-form">
        <label class="platform-label">Код заведения</label>
        <input class="platform-input code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" id="owner-login-code" value="${code}" placeholder="178617" maxlength="6" oninput="let v = this.value.replace(/[^0-9]/g,''); if (v !== this.value) this.value = v; updatePlatformDraft('code', v); validatePlatformButton()">
        <button id="platform-primary-btn" class="onboarding-btn ${valid ? '' : 'disabled'}" onclick="ownerLogin()">Войти</button>
      </div>
    </div>
  `;
}

async function ownerLogin() {
  const draft = state.platformDraft || {};
  const code = (draft.code || '').trim();
  if (!isValidVenueCode(code)) return;
  const ownerPin = code;

  if (!supabaseClient) {
    showPlatformToast('Нет подключения к серверу. Создайте или импортируйте заведение.');
    return;
  }

  let remoteData = null;
  try {
    remoteData = await safeRpc('owner_login', { p_code: code, p_owner_pin: ownerPin });
    if (!remoteData) {
      showPlatformToast('Код заведения не найден.');
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
  window.renderHome = renderOwnerHome;
  replaceScreen(remoteVenue.sections && remoteVenue.sections.some(s => s.items && s.items.length) ? 'home' : 'ownerSetup');
  showPlatformToast('Заведение загружено');
}

function renderOwnerSetup() {
  const venue = state.venue;
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="goBack()">← Назад</button>
      </div>
      <div class="platform-title">${venue.name}</div>
      <div class="platform-subtitle">Код для сотрудников: <span class="venue-code">${venue.code}</span></div>
      <div class="platform-form">
        <label class="platform-label">Загрузите файл или фото ТТК</label>
        <div class="upload-zone" onclick="document.getElementById('ttk-file').click()">
          <div class="upload-icon"></div>
          <div class="upload-text">Нажмите, чтобы выбрать файлы</div>
          <div class="upload-hint">.txt, .md, .csv, .json, .docx, .jpg, .png, .webp (можно несколько)</div>
        </div>
        <input type="file" id="ttk-file" style="display:none" accept=".txt,.md,.csv,.json,.docx,image/*" multiple onchange="handleTTKFiles(this.files)">

        <label class="platform-label" style="margin-top:18px;">Или вставьте текст ТТК</label>
        <textarea id="ttk-paste" class="platform-input" rows="6" placeholder="Например:\nКапучино\n• Эспрессо 30 мл\n• Молоко 150 мл\n• Молочная пена 30 г"></textarea>
        <button class="onboarding-btn" onclick="parseTTKPastePreview()">Распознать и открыть редактор</button>
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
          <button class="stats-btn" style="margin:0;" onclick="showVenueQR()">QR-код</button>
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
            <button class="section-row-action" onclick="renderSectionSettings('${s.id}')">Настройки</button>
            <button class="section-row-action" onclick="editSection('${s.id}')">Изменить</button>
            <button class="section-row-action" onclick="deleteSection('${s.id}')">Удалить</button>
          </div>
        `).join('') : '<div class="section-empty">Пока нет разделов</div>'}
        <button class="onboarding-btn secondary" onclick="promptNewSection()">+ Новый раздел</button>
      </div>
      <button class="stats-btn" style="${cementStyle()}" onclick="goLeaderboard()">Рейтинг</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="showOwnerStats()">Статистика</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="goToScreen('ownerSettings')">Настройки</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="logoutPlatform()">Выйти из аккаунта</button>
    </div>
  `;
}

function renderOwnerSettings() {
  const venue = state.venue;
  app.innerHTML = `
    <div class="top-bar">
      <button class="close-btn" onclick="goBack()">← Назад</button>
      <div class="path-title">${venue ? venue.name : 'Cognitio'}</div>
      <div style="width:40px"></div>
    </div>
    <div class="platform-dashboard">
      <div class="platform-title" style="text-align:center;margin:16px 0;">Настройки</div>
      <button class="stats-btn" style="${cementStyle()}" onclick="goToScreen('ownerSetup')">Загрузить ТТК</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="openVenueImages()">Фото заведения</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="exportVenueFile()">Экспортировать данные</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="document.getElementById('venue-import-file').click()">Импорт бэкапа</button>
      <input type="file" id="venue-import-file" style="display:none" accept=".json,application/json" onchange="importVenueBackup(this.files[0])">
    </div>
  `;
}

function sectionSettingsKey(sectionId) {
  return 'venue_' + sectionId;
}

function getSectionNodeState(section, idx, sections) {
  const key = sectionSettingsKey(section.id);
  const sp = getSectionProgress(key);
  const lessonCount = Math.ceil((section.items || []).length / 8) || 1;
  let completedLessons = 0;
  for (let i = 0; i < lessonCount; i++) {
    if (sp[`lesson_${i}`]?.completed) completedLessons++;
  }

  for (let j = 0; j < idx; j++) {
    const prev = sections[j];
    const prevKey = sectionSettingsKey(prev.id);
    const prevSp = getSectionProgress(prevKey);
    const prevCount = Math.ceil((prev.items || []).length / 8) || 1;
    let prevCompleted = 0;
    for (let k = 0; k < prevCount; k++) {
      if (prevSp[`lesson_${k}`]?.completed) prevCompleted++;
    }
    if (prevCompleted < prevCount) return 'locked';
  }

  if (completedLessons >= lessonCount) {
    const p = getProgress();
    const itemStrength = p.itemStrength || {};
    const items = section.items || [];
    let totalStrength = 0;
    let strengthCount = 0;
    let weakCount = 0;
    let lastSeenMax = 0;
    const now = Date.now();
    for (const it of items) {
      const name = it.name || it;
      const st = itemStrength[name];
      if (st) {
        totalStrength += st.strength || 0;
        strengthCount++;
        if (st.lastSeen) lastSeenMax = Math.max(lastSeenMax, st.lastSeen);
        if ((st.strength || 0) < 3) weakCount++;
      }
    }
    const avgStrength = strengthCount ? totalStrength / strengthCount : 5;
    const daysSince = lastSeenMax ? (now - lastSeenMax) / 86400000 : 999;
    if (weakCount > 0 || (avgStrength < 3.5 && daysSince > 5)) return 'broken';
    return 'completed';
  }

  return 'available';
}

function getSkillNodeIcon(section, state) {
  if (state === 'completed') return `<span class="skill-icon skill-star">★</span>`;
  if (state === 'broken') return `<span class="skill-icon skill-crack">✕</span>`;
  if (state === 'locked') return `<svg class="skill-icon skill-lock" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a4 4 0 0 1 4 4v2H8V6a4 4 0 0 1 4-4zm5 6V6a5 5 0 0 0-10 0v2H5v10h14V8h-2z"/></svg>`;
  if (section && section.image) {
    return `<img class="skill-icon skill-img" src="${section.image}" alt="" onerror="this.outerHTML='<span class=\\'skill-icon skill-letter\\'>${(section.name || '?')[0].toUpperCase()}</span>'">`;
  }
  return `<span class="skill-icon skill-letter">${(section.name || '?')[0].toUpperCase()}</span>`;
}

function startSectionReview(sectionId) {
  if (!state.venue || !state.venue.sections.length) return;
  loadVenueIntoState(sectionId);
  const weakItems = getWeakItems(state.section);
  if (weakItems.length === 0) {
    showPlatformToast('Нет слабых позиций для повторения');
    goToScreen('path');
    return;
  }
  startPractice();
}

function renderSkillTree(nodes) {
  if (!nodes || !nodes.length) return '';
  const treeWidth = 320;
  const nodeSize = 72;
  const spacingY = 110;
  const offsets = [0, 60, 90, 60, 0, -60, -90, -60];
  const centerX = treeWidth / 2;
  const height = nodes.length * spacingY + nodeSize + 60;
  let pathD = '';
  let nodesHTML = '';
  let prevX = centerX, prevY = 0;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const offset = offsets[i % offsets.length];
    const x = centerX + offset;
    const y = i * spacingY + nodeSize / 2 + 30;
    if (i === 0) pathD = `M ${x} ${y}`;
    else pathD += ` Q ${centerX} ${prevY + (y - prevY) / 2} ${x} ${y}`;
    prevX = x; prevY = y;

    const click = n.click ? `onclick="${n.click}"` : '';
    const icon = n.icon || getSkillNodeIcon(n, n.state);
    const labelClass = n.state === 'locked' ? 'dim' : '';
    const aria = n.ariaLabel || (n.state === 'locked' ? 'Заблокировано' : escapeHtml(n.name));
    nodesHTML += `
      <div class="skill-node-wrap" style="left:${x}px;top:${y}px;">
        <button class="skill-node ${n.state}" ${click} aria-label="${aria}">${icon}</button>
        <div class="skill-node-label ${labelClass}">${escapeHtml(n.name)}</div>
        <div class="skill-node-meta ${labelClass}">${n.meta || ''}</div>
      </div>
    `;
  }

  return `
    <div class="skill-tree-scroll">
      <div class="skill-tree" style="width:${treeWidth}px;height:${height}px;">
        <svg class="skill-tree-svg" width="${treeWidth}" height="${height}" viewBox="0 0 ${treeWidth} ${height}">
          <path class="skill-tree-path" d="${pathD}" fill="none" stroke-width="4" stroke-linecap="round"/>
        </svg>
        ${nodesHTML}
      </div>
    </div>
  `;
}

function getLessonNodeState(i, sp, lessonItems) {
  const completed = !!(sp[`lesson_${i}`] && sp[`lesson_${i}`].completed);
  for (let j = 0; j < i; j++) {
    if (!(sp[`lesson_${j}`] && sp[`lesson_${j}`].completed)) return 'locked';
  }
  if (completed) {
    const p = getProgress();
    const itemStrength = p.itemStrength || {};
    const now = Date.now();
    let weakCount = 0;
    let totalStrength = 0;
    let count = 0;
    let lastSeenMax = 0;
    for (const it of lessonItems) {
      const name = it.name || it;
      const st = itemStrength[name];
      if (st) {
        totalStrength += st.strength || 0;
        count++;
        if (st.lastSeen) lastSeenMax = Math.max(lastSeenMax, st.lastSeen);
        if ((st.strength || 0) < 3) weakCount++;
      }
    }
    const avgStrength = count ? totalStrength / count : 5;
    const daysSince = lastSeenMax ? (now - lastSeenMax) / 86400000 : 999;
    if (weakCount > 0 || (avgStrength < 3.5 && daysSince > 5)) return 'broken';
    return 'completed';
  }
  return 'available';
}

function buildLessonSkillNodes(weakItems) {
  const sp = getSectionProgress(state.section);
  const lessons = state.lessons || [];
  const nodes = [];
  nodes.push({
    state: 'guidebook',
    name: 'Справочник',
    meta: `${(state.allData || []).length} позиций`,
    icon: '<svg class="skill-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h5a3 3 0 0 1 3 3 3 3 0 0 1 3-3h5v13H5V4zm2 2v9h3a3 3 0 0 0-3-3V6zm12 0h-3v3a3 3 0 0 0 3 3V6z"/></svg>',
    click: 'openBrowse()',
    ariaLabel: 'Справочник'
  });
  for (let i = 0; i < lessons.length; i++) {
    const items = lessons[i] || [];
    const st = getLessonNodeState(i, sp, items);
    nodes.push({
      state: st,
      name: `Урок ${i + 1}`,
      meta: `${items.length} карт`,
      icon: getSkillNodeIcon(items[0] || {}, st),
      click: st === 'locked' ? '' : `startLesson(${i})`,
      ariaLabel: st === 'locked' ? 'Заблокировано' : `Урок ${i + 1}`
    });
  }
  if (weakItems && weakItems.length > 0) {
    nodes.push({
      state: 'practice',
      name: 'Тренировка',
      meta: `${weakItems.length} слабых`,
      icon: '<svg class="skill-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a9 9 0 0 0-9 9H2l3.5 3.5L9 15H6a7 7 0 0 1 7-7 7 7 0 0 1 7 7 7 7 0 0 1-7 7c-1.9 0-3.7-.8-4.9-2.1L7 20.1A9 9 0 1 0 13 3z"/></svg>',
      click: 'startPractice()',
      ariaLabel: 'Тренировка слабых мест'
    });
  }
  return nodes;
}

function renderSectionSettings(sectionId) {
  const sectionKey = sectionSettingsKey(sectionId);
  const section = getVenueSections().find(s => s.id === sectionId);
  const settings = getSectionSettings(sectionKey);
  const showGrams = settings.showGrams !== false;
  const requireGrams = showGrams && settings.requireGrams !== false;
  const formats = settings.formats || {};
  const formatLabels = {
    logical: 'Логический',
    missing: 'С пропусками',
    color_coded: 'Цветовой',
    spatial: 'Пространственный',
    photo: 'По фото'
  };
  const formatDesc = {
    logical: 'Простой выбор ингредиентов',
    missing: 'Указать недостающий компонент',
    color_coded: 'Распределение по цветовым группам',
    spatial: 'Выбор зон подачи/стакана',
    photo: 'Угадать состав по фотографии блюда'
  };
  const formatToggles = Object.keys(formatLabels).map(f => {
    const on = formats[f] !== false;
    return `
      <div class="settings-row" style="cursor:pointer" onclick="toggleSectionSetting('${sectionId}', 'format_${f}', this)">
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
        <div class="stats-modal-title">Настройки раздела: ${escapeHtml((section && section.name) || '')}</div>
        <button class="stats-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="settings-list">
        <div class="settings-row" style="cursor:pointer" onclick="toggleSectionSetting('${sectionId}', 'showGrams', this)">
          <div class="settings-row-text">
            <div class="settings-row-label">Показывать граммы</div>
            <div class="settings-row-desc">Показывать сотрудникам граммовки в уроках и справочнике</div>
          </div>
          <div class="toggle ${showGrams ? 'on' : ''}" aria-checked="${showGrams ? 'true' : 'false'}"><div class="toggle-knob"></div></div>
        </div>
        <div class="settings-row" style="cursor:pointer;opacity:${showGrams ? 1 : 0.5}" onclick="if(getSectionSettings('${sectionKey}').showGrams===false)return;toggleSectionSetting('${sectionId}', 'requireGrams', this)">
          <div class="settings-row-text">
            <div class="settings-row-label">Требовать ввод граммов</div>
            <div class="settings-row-desc">Сотрудник должен ввести граммовку каждого ингредиента</div>
          </div>
          <div class="toggle ${requireGrams ? 'on' : ''}" aria-checked="${requireGrams ? 'true' : 'false'}"><div class="toggle-knob"></div></div>
        </div>
        <div class="settings-row" style="cursor:pointer" onclick="toggleSectionSetting('${sectionId}', 'speedEnabled', this)">
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
          <input class="platform-input" type="number" inputmode="numeric" min="5" max="60" value="${speedLimit}" style="width:70px;text-align:center" onchange="updateSectionSpeedLimit('${sectionId}', this.value)">
        </div>
        <div class="settings-row" style="margin-top:8px;cursor:default;">
          <div class="settings-row-text">
            <div class="settings-row-label">Форматы вопросов</div>
            <div class="settings-row-desc">Какие типы заданий показывать в этом разделе</div>
          </div>
        </div>
        ${formatToggles}
      </div>
      <p class="settings-hint">Настройки применяются только для раздела «${escapeHtml((section && section.name) || '')}».</p>
    </div>
  `;
  document.body.appendChild(overlay);
}

function toggleSectionSetting(sectionId, key, row) {
  const sectionKey = sectionSettingsKey(sectionId);
  const settings = getSectionSettings(sectionKey);
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
  updateSectionSettings(sectionKey, next);
  const overlay = row.closest('.modal-overlay');
  if (overlay) overlay.remove();
  renderSectionSettings(sectionId);
}

function updateSectionSpeedLimit(sectionId, value) {
  const sectionKey = sectionSettingsKey(sectionId);
  const n = Math.max(5, Math.min(60, parseInt(value) || 15));
  const settings = getSectionSettings(sectionKey);
  updateSectionSettings(sectionKey, { ...settings, speedMode: { ...(settings.speedMode || {}), timeLimit: n } });
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.remove();
  renderSectionSettings(sectionId);
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
        <button class="close-btn" onclick="goBack()">← Назад</button>
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
        <button class="stats-btn" style="${cementStyle()}margin-top:16px" onclick="exportTrainingStatsCSV()">Экспорт CSV</button>
      </div>
    </div>
  `;
}

function escapeCsv(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportTrainingStatsCSV() {
  const stats = state.trainingStats || { staff: [], items: [] };
  const staff = stats.staff || [];
  const items = stats.items || [];
  let csv = '\ufeff';
  csv += 'Статистика по сотрудникам\n';
  csv += 'Логин,Всего ответов,Верно,Точность (%),Последняя активность\n';
  staff.forEach(s => {
    const pct = s.total ? Math.round((s.accuracy || 0) * 100) : 0;
    csv += [escapeCsv(s.login), s.total || 0, s.correct || 0, pct, formatDateTime(s.lastActive)].join(',') + '\n';
  });
  csv += '\nСтатистика по позициям\n';
  csv += 'Название,Всего ответов,Верно,Точность (%)\n';
  items.forEach(it => {
    const pct = it.total ? Math.round((it.accuracy || 0) * 100) : 0;
    csv += [escapeCsv(it.name), it.total || 0, it.correct || 0, pct].join(',') + '\n';
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cognitio-stats-${state.venue ? state.venue.code : 'venue'}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showPlatformToast('CSV экспортирован');
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
        <button class="close-btn" onclick="goBack()">← Назад</button>
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
        <button class="close-btn" onclick="goBack()">← Назад</button>
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
  if (state.auth && state.auth.role === 'owner') {
    renderOwnerHome();
    return;
  }
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
      <div class="top-bar-stat gem-balance" onclick="goToScreen('shop')">
        <svg class="gem-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l8 8-8 12-8-12 8-8z"/></svg>
        <span class="gem-count">${typeof getGems === 'function' ? getGems() : 0}</span>
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
        <div class="daily-stat-card" style="${cementStyle()}">
          <div class="stat-value" style="color:var(--gold)">${stats.totalCrowns}</div>
          <div class="stat-label">Корон</div>
        </div>
      </div>
      ` : ''}
      ${!isOwner ? `<button class="stats-btn" style="${cementStyle()}" onclick="showLearningStats()">Прогресс</button>` : ''}
      ${!isOwner && hasSections ? `<button class="stats-btn" style="${cementStyle()}" onclick="startMixedPractice()">Случайный тест</button>` : ''}
      ${!isOwner ? `<button class="stats-btn" style="${cementStyle()}" onclick="goToScreen('shop')">Магазин</button>` : ''}
      <button class="stats-btn" style="${cementStyle()}" onclick="goLeaderboard()">Рейтинг</button>
      ${!isOwner ? `<button class="stats-btn" style="${cementStyle()}" onclick="showAchievements()">Достижения ${renderAchievementBadge()}</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="showStaffStats()">Моя статистика</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="openReference()">Справочник</button>
      ${weakCount > 0 ? `<button class="stats-btn" style="${cementStyle()}" onclick="startWeakPractice()">Тренировка слабых мест (${weakCount})</button>` : ''}` : ''}
      ${!isOwner ? (hasSections ? sections.map(s => `
        <button class="section-card" style="${cementStyle()}" onclick="startVenueCourse('${s.id}')">
          <div class="card-img-wrap">
            ${s.image ? `<img class="card-img" src="${s.image}" alt="" onerror="this.parentNode.classList.add('no-img')">` : `<div class="card-img-placeholder">${getSectionEmoji(s.name)}</div>`}
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

// ====================== REFERENCE ======================

function openReference() {
  state.referenceFilter = '';
  if (!state.referenceRefreshInterval) {
    state.referenceRefreshInterval = setInterval(() => {
      if (state.screen !== 'reference' || !state.venue || !state.venue.code || !state.auth || state.auth.role !== 'staff') {
        clearInterval(state.referenceRefreshInterval);
        state.referenceRefreshInterval = null;
        return;
      }
      refreshReferenceFromCloud();
    }, 30000);
  }
  if (state.venue && state.venue.code && state.auth && state.auth.role === 'staff') {
    refreshReferenceFromCloud().then(() => {
      goToScreen('reference');
    });
  } else {
    goToScreen('reference');
  }
}

function closeReference() {
  if (state.referenceRefreshInterval) {
    clearInterval(state.referenceRefreshInterval);
    state.referenceRefreshInterval = null;
  }
  goBack();
}

function isReferenceStandalone() {
  if (state.standalone) return true;
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  if (typeof window !== 'undefined' && window.navigator && window.navigator.standalone === true) return true;
  return /standalone=1/.test(location.search);
}

function filterReference(value) {
  updateReferenceSearch(value);
}

function updateReferenceSearch(value) {
  state.referenceFilter = value;
  const list = document.getElementById('reference-list');
  if (list) {
    list.innerHTML = renderReferenceListHTML(value);
    requestAnimationFrame(() => {
      const input = document.getElementById('reference-search');
      if (input && document.activeElement !== input) {
        try { input.focus(); } catch (e) {}
      }
    });
  }
}

function handleReferenceScroll(el) {
  const header = document.getElementById('reference-header');
  if (!header) return;
  if (el.scrollTop > 8) header.classList.add('scrolled');
  else header.classList.remove('scrolled');
}

function toggleReferenceItem(btn) {
  const item = btn.closest('.browse-item');
  if (item) item.classList.toggle('open');
}

function openReferenceShortcut() {
  try {
    window.open('reference.html?open=0', '_blank');
  } catch (e) {
    location.href = 'reference.html?open=0';
  }
}

async function refreshReferenceFromCloud() {
  if (!supabaseClient || !state.venue || !state.venue.code) return;
  const remote = await fetchRemoteVenue(state.venue.code);
  if (remote) {
    state.venue = normalizeVenue(remote);
    saveProgress({ venue: state.venue });
    if (state.screen === 'reference') render();
  }
}

function renderReferenceListHTML(query) {
  const settings = getVenueSettings();
  const q = (query || '').trim().toLowerCase();
  const sections = getVenueSections();
  let sectionsHTML = '';
  let totalItems = 0;

  sections.forEach(section => {
    const items = (section.items || []).map(normalizeItem).filter(it => {
      if (!q) return true;
      const nameMatch = (it.name || '').toLowerCase().includes(q);
      const ingMatch = (it._ingredients || []).some(i => i.toLowerCase().includes(q));
      return nameMatch || ingMatch;
    });
    if (!items.length) return;
    totalItems += items.length;

    const itemsHTML = items.map(item => {
      const ingredientsHTML = item._ingredients.map(ing => {
        const showGrams = item._hasGrams && settings.showGrams !== false;
        const hasGram = Number(item._grams[ing]) > 0;
        const unit = (item._gramUnit && item._gramUnit[ing]) || 'г';
        const grams = showGrams && hasGram ? `<span class="browse-grams">&nbsp;${item._grams[ing]} ${unit}</span>` : '';
        return `<div class="browse-ingredient"><span>${ing}</span>${grams}</div>`;
      }).join('');
      const mastery = getDishMastery(item.name);
      const crowns = mastery.level > 0 ? '<span class="mastery-crowns" style="margin-left:6px">' + '★'.repeat(mastery.level) + '</span>' : '';
      const masteryLabel = mastery.level > 0 ? `<span class="mastery-label" style="margin-left:6px">${getMasteryLabel(mastery.level)}</span>` : '';
      const descriptionHTML = item._description ? `<div class="browse-item-description">${escapeHtml(item._description).replace(/\n/g, '<br>')}</div>` : '';
      return `
        <div class="browse-item">
          <button class="browse-item-header" style="${cementStyle()}" onclick="toggleReferenceItem(this)">
            ${item._image ? getDishPhotoHTML(item, 'browse-item-photo') : ''}
            <div class="browse-item-title">
              <span class="browse-item-name">${item.name}</span>
              ${crowns}
              ${masteryLabel}
            </div>
            <span class="browse-arrow">▼</span>
          </button>
          <div class="browse-item-body">
            ${ingredientsHTML}
            ${descriptionHTML}
          </div>
        </div>
      `;
    }).join('');

    sectionsHTML += `
      <div class="reference-section">
        <div class="reference-section-title">${escapeHtml(section.name)} <small>${items.length} позиций</small></div>
        ${itemsHTML}
      </div>
    `;
  });

  if (!sections.length) return '<div class="section-empty">В заведении пока нет разделов</div>';
  if (totalItems === 0) return '<div class="section-empty">Ничего не найдено</div>';
  return sectionsHTML;
}

function renderReference() {
  const venue = state.venue || {};
  const isStandalone = isReferenceStandalone();
  const venueName = escapeHtml(venue.name || 'Справочник');

  app.innerHTML = `
    <div class="reference-screen" onscroll="handleReferenceScroll(this)">
      <div class="reference-header" id="reference-header">
        <div class="reference-top">
          ${isStandalone ? '' : `<button class="reference-back" onclick="closeReference()">← Назад</button>`}
          <div class="reference-title">${venueName}</div>
          <button class="reference-add-btn" onclick="openReferenceShortcut()">Добавить</button>
        </div>
        <div class="reference-search-wrap">
          <input type="search" class="reference-search" id="reference-search" placeholder="Найти блюдо или ингредиент" value="${escapeHtml(state.referenceFilter || '')}" oninput="updateReferenceSearch(this.value)">
        </div>
      </div>
      <div class="reference-list" id="reference-list">
        ${renderReferenceListHTML(state.referenceFilter || '')}
      </div>
    </div>
  `;

  requestAnimationFrame(() => {
    const screen = document.querySelector('.reference-screen');
    if (screen) handleReferenceScroll(screen);
    const input = document.getElementById('reference-search');
    if (input && state.referenceFilter) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  });
}

// ====================== COURSE EDITOR ======================

function openCourseEditor() {
  const draft = state.platformDraft || {};
  if (!draft.parsedItems || !draft.parsedItems.length) {
    showPlatformToast('Сначала распознайте ТТК');
    return;
  }
  goToScreen('courseEditor');
}

function renderCourseEditor() {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  const rawSectionName = (draft.sectionName || '').trim();
  const displayName = rawSectionName || 'Новый раздел';
  const hasExisting = state.venue && state.venue.sections && state.venue.sections.length;
  const sectionOptions = hasExisting
    ? `<option value="">Новый раздел</option>` + state.venue.sections.map(s => `<option value="${s.name}">${s.name}</option>`).join('')
    : `<option value="">Основное меню</option>`;
  const saveStatus = state.editorDirty ? 'Сохранение...' : '';
  app.innerHTML = `
    <div class="platform-screen">
      <div class="editor-sticky-header">
        <button class="editor-back-btn" onclick="goBack()">←</button>
        <div class="editor-sticky-title" id="editor-sticky-title">Редактор (${escapeHtml(displayName)})</div>
        <div class="editor-save-status" id="editor-save-status">${saveStatus}</div>
      </div>
      <div class="platform-form">
        <label class="platform-label">Сохранить в раздел</label>
        <div class="section-save-row">
          <select class="platform-input" id="editor-section-select" onchange="onEditorSectionChange(this.value)">
            ${sectionOptions}
          </select>
          <input class="platform-input" type="text" id="editor-section-name" value="${escapeHtml(draft.sectionName || '')}" placeholder="Название раздела" oninput="updatePlatformDraft('sectionName', this.value); markEditorDirty()">
        </div>
        <div class="editor-items">
          ${items.map((it, idx) => renderCourseEditorItem(it, idx)).join('')}
        </div>
        <button class="onboarding-btn secondary" onclick="addParsedItem()">+ Добавить позицию</button>
      </div>
    </div>
  `;
  if (state.editorDirty) markEditorDirty();
}

function onEditorSectionChange(val) {
  const input = document.getElementById('editor-section-name');
  if (val) {
    state.platformDraft = state.platformDraft || {};
    state.platformDraft.sectionName = val;
    if (input) input.value = val;
  }
  markEditorDirty();
}

function renderCourseEditorItem(it, idx) {
  ensureItemCorrectObjects(idx);
  const item = state.platformDraft.parsedItems[idx];
  const image = item.image || '';
  const componentsHTML = (item.correct || []).map((c, i) => renderEditorComponentRow(idx, i, c)).join('');
  const description = item.description || '';
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
      <details class="editor-description" open>
        <summary class="editor-desc-toggle">Описание / процесс приготовления</summary>
        <textarea class="editor-desc-textarea platform-input" rows="4" placeholder="Процесс приготовления блюда" oninput="updateParsedItem(${idx}, 'description', this.value)">${escapeHtml(description)}</textarea>
      </details>
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
  const grams = typeof c === 'object' ? (c.grams === 0 || c.grams === '0' ? '0' : (c.grams || '')) : '';
  const isCount = typeof c === 'object' ? !!c.isCount : false;
  const placeholder = isCount ? 'шт' : 'г';
  const unit = isCount ? 'шт' : 'г';
  return `
    <div class="editor-component-row">
      <input class="platform-input editor-comp-name" type="text" value="${escapeHtml(name)}" placeholder="Ингредиент" oninput="updateParsedComponentName(${itemIdx}, ${compIdx}, this.value)">
      <div class="editor-comp-weight-wrap">
        <input class="platform-input editor-comp-grams" type="number" inputmode="decimal" placeholder="${placeholder}" value="${grams}" oninput="updateParsedComponentGrams(${itemIdx}, ${compIdx}, this.value)">
        <span class="editor-comp-unit">${unit}</span>
      </div>
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
  markEditorDirty();
}

function updateParsedComponentName(idx, compIdx, value) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  ensureItemCorrectObjects(idx);
  const correct = items[idx].correct;
  if (!correct[compIdx]) correct[compIdx] = { ingredient: '', grams: '' };
  correct[compIdx].ingredient = value.trim();
  markEditorDirty();
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
  markEditorDirty();
}

function removeParsedComponent(idx, compIdx) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  ensureItemCorrectObjects(idx);
  items[idx].correct.splice(compIdx, 1);
  state.editorDirty = true;
  render();
}

function addParsedComponent(idx) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  ensureItemCorrectObjects(idx);
  items[idx].correct.push({ ingredient: '', grams: '' });
  state.editorDirty = true;
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
  state.editorDirty = true;
  render();
}

function addParsedItem() {
  const draft = state.platformDraft || {};
  draft.parsedItems = draft.parsedItems || [];
  draft.parsedItems.push({
    type: 'composition',
    name: '',
    correct: [{ ingredient: '', grams: '' }],
    description: '',
    info_text: 'Состав:\n• ',
  });
  state.editorDirty = true;
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

function persistCourseEditor() {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items.length) return false;
  if (!state.venue) return false;

  const sectionName = (draft.sectionName || '').trim();
  if (!sectionName) return false;

  const cleanedItems = items.map(cleanParsedItemForSave).filter(it => it.name && it.correct.length);
  if (!cleanedItems.length) return false;

  const venue = state.venue;
  venue.sections = venue.sections || [];

  let target = null;
  if (draft.targetSectionId) {
    target = venue.sections.find(s => s.id === draft.targetSectionId);
    if (target) target.name = sectionName;
  }
  if (!target) {
    target = venue.sections.find(s => s.name === sectionName);
  }
  if (!target) {
    target = { id: generateId(), name: sectionName, items: [], createdAt: Date.now() };
    venue.sections.push(target);
  }

  const allComponentNames = new Set();
  cleanedItems.forEach(it => {
    it.correct.forEach(c => allComponentNames.add(c.ingredient));
  });
  const allComponentsArray = [...allComponentNames];
  const sectionKey = sectionSettingsKey(target.id);
  const showGrams = getSectionSettings(sectionKey).showGrams !== false;

  target.items = cleanedItems.map(item => {
    const hasGrams = item.correct.some(c => c.grams > 0 || c.isCount);
    const correctNames = item.correct.map(c => c.ingredient);
    const distractors = shuffle(allComponentsArray.filter(c => !correctNames.includes(c))).slice(0, Math.min(6, Math.max(0, allComponentsArray.length - correctNames.length)));
    if (hasGrams) {
      const out = {
        type: 'composition',
        name: item.name,
        correct: item.correct,
        wrong: distractors,
        info_text: buildInfoText(item.name, item.correct, showGrams),
        image: item.image || null,
      };
      if (item.description) out.description = item.description;
      return out;
    } else {
      const pool = shuffle([...correctNames, ...distractors]);
      const out = {
        type: 'composition',
        name: item.name,
        correct: correctNames,
        pool: pool,
        info_text: buildInfoText(item.name, correctNames, showGrams),
        image: item.image || null,
      };
      if (item.description) out.description = item.description;
      return out;
    }
  });

  saveProgress({ venue: venue });
  syncVenue();
  return true;
}

function saveCourseFromEditor() {
  if (state.editorSaveTimeout) clearTimeout(state.editorSaveTimeout);
  if (persistCourseEditor()) {
    state.platformDraft = null;
    state.editorDirty = false;
    window.renderHome = renderOwnerHome;
    replaceScreen('home');
    showPlatformToast('Курс сохранён');
    playSound('correct');
  }
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
  draft.targetSectionId = section.id;
  state.platformDraft = draft;
  state.editorDirty = false;
  goToScreen('courseEditor');
}

function deleteSection(sectionId) {
  const venue = state.venue;
  if (!venue || !venue.sections) return;
  venue.sections = venue.sections.filter(s => s.id !== sectionId);
  saveProgress({ venue: venue });
  syncVenue();
  render();
}

function openVenueImages() {
  goToScreen('venueImages');
}

function renderVenueImages() {
  const venue = state.venue;
  const sections = getVenueSections();
  const images = venue.images || [];
  const bgImage = venue.bgImage || '';

  const gallery = images.length ? images.map(img => {
    const isBg = bgImage === img.url;
    const usedSection = sections.find(s => s.image === img.url);
    const usedLabel = isBg ? 'Фон' : (usedSection ? usedSection.name : '');
    const sectionButtons = sections.map(s => `
      <button class="section-row-action" onclick="setSectionCover('${img.id}', '${s.id}')">${escapeHtml(s.name)}</button>
    `).join('');
    return `
      <div class="venue-image-card ${isBg ? 'selected-bg' : ''}">
        <img src="${escapeHtml(img.url)}" class="venue-image-thumb" loading="lazy" alt="">
        <div class="venue-image-actions">
          <button class="section-row-action" onclick="setVenueBackground('${img.id}')">Фон</button>
          ${sectionButtons}
          <button class="section-row-action" onclick="removeVenueImage('${img.id}')">Удалить</button>
        </div>
        ${usedLabel ? `<div class="venue-image-label">${escapeHtml(usedLabel)}</div>` : ''}
      </div>
    `;
  }).join('') : '<div class="section-empty">Нет фото. Загрузите свои или найдите в интернете.</div>';

  const sectionTargets = sections.length ? sections.map(s => `
    <div class="section-row">
      <div>
        <div class="section-row-name">${escapeHtml(s.name)}</div>
        <div class="section-row-meta">${s.image ? 'обложка есть' : 'без обложки'}</div>
      </div>
      <button class="section-row-action" onclick="clearSectionCover('${s.id}')">Сбросить</button>
    </div>
  `).join('') : '<div class="section-empty">Нет разделов</div>';

  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="ownerBackToHome()">← Назад</button>
      </div>
      <div class="platform-title">Фото заведения</div>
      <div class="platform-form">
        <label class="platform-label">Загрузить свои фото</label>
        <input type="file" class="platform-input" id="venue-image-upload" accept="image/*" multiple onchange="handleVenueImageUpload(this.files)">

        <label class="platform-label" style="margin-top:16px;">Или найдите по запросу</label>
        <input class="platform-input" type="text" id="custom-image-query" placeholder="например, капучино">
        <button class="stats-btn" style="${cementStyle()}" onclick="searchCustomVenueImage(document.getElementById('custom-image-query').value)">Найти</button>

        <button class="stats-btn" style="${cementStyle()}margin-top:12px" onclick="searchVenueImagesOnline()">Найти фото в интернете по названию</button>
        <button class="stats-btn" style="${cementStyle()}" onclick="clearSearchImages()">Убрать найденные фото</button>
        <button class="stats-btn" style="${cementStyle()}" onclick="autoAssignVenueImages()">Автораспределить фото</button>
        <button class="stats-btn" style="${cementStyle()}" onclick="clearVenueBackground()">Убрать фон</button>

        <div class="platform-label" style="margin-top:16px">Галерея</div>
        <div class="venue-image-gallery">${gallery}</div>

        <div class="platform-label" style="margin-top:16px">Обложки разделов</div>
        ${sectionTargets}
      </div>
    </div>
  `;
}

function handleVenueImageUpload(files) {
  if (!files || !files.length) return;
  const venue = state.venue;
  if (!venue) return;
  let pending = files.length;
  const onDone = () => {
    pending--;
    if (pending === 0) {
      saveProgress({ venue: venue });
      syncVenue();
      render();
      showPlatformToast('Фото добавлены');
    }
  };
  Array.from(files).forEach(file => {
    resizeImageFile(file, 900, 0.85).then(dataUrl => {
      venue.images.push({ id: generateId(), url: dataUrl, source: 'upload', name: file.name });
      onDone();
    }).catch(() => {
      onDone();
    });
  });
}

function resizeImageFile(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function addVenueImage(url, source, meta) {
  const venue = state.venue;
  if (!venue || !url) return;
  if (!venue.images) venue.images = [];
  if (venue.images.some(i => i.url === url)) return;
  venue.images.push({ id: generateId(), url, source, meta });
  saveProgress({ venue: venue });
  syncVenue();
}

function removeVenueImage(id) {
  const venue = state.venue;
  if (!venue || !venue.images) return;
  const img = venue.images.find(i => i.id === id);
  if (img && venue.bgImage === img.url) venue.bgImage = '';
  venue.sections.forEach(s => { if (s.image === img.url) s.image = ''; });
  venue.images = venue.images.filter(i => i.id !== id);
  saveProgress({ venue: venue });
  syncVenue();
  render();
}

function setVenueBackground(id) {
  const venue = state.venue;
  if (!venue || !venue.images) return;
  const img = venue.images.find(i => i.id === id);
  if (!img) return;
  venue.bgImage = img.url;
  saveProgress({ venue: venue });
  syncVenue();
  applyVenueStyle(venue.style, venue.bgImage);
  render();
  showPlatformToast('Фон обновлён');
}

function clearVenueBackground() {
  const venue = state.venue;
  if (!venue) return;
  venue.bgImage = '';
  saveProgress({ venue: venue });
  syncVenue();
  applyVenueStyle(venue.style, '');
  render();
}

function setSectionCover(imageId, sectionId) {
  const venue = state.venue;
  if (!venue || !venue.images) return;
  const img = venue.images.find(i => i.id === imageId);
  const section = venue.sections.find(s => s.id === sectionId);
  if (!img || !section) return;
  section.image = img.url;
  saveProgress({ venue: venue });
  syncVenue();
  render();
  showPlatformToast('Обложка раздела обновлена');
}

function clearSectionCover(sectionId) {
  const venue = state.venue;
  if (!venue) return;
  const section = venue.sections.find(s => s.id === sectionId);
  if (section) section.image = '';
  saveProgress({ venue: venue });
  syncVenue();
  render();
}

const IMAGE_BAD_URL_TERMS = ['youtube','ytimg','steam','24smi','pockettactics','allthings.how','ttk-internet','adesk','maximilians','gruppa','festivalsreda','imzagazetesi','sreda','shared.fastly','vk.com','gta','csgo','counter-strike','pubg','fortnite','logo','clipart','pngkey','icon','emoji','meme','wallpaper','demo','test','ttk','pdf','game','gaming','play','app','apk','iphone','android','steamstatic','fastly','demo-','test-','kinoafisha','kpcdn','plus2net','gmesupply'];
const IMAGE_GOOD_DOMAINS = ['pinterest','pinimg','tripadvisor','restoclub','timeout','restaurantguru','unsplash','pexels','pixabay','wikimedia','alamy','gettyimages','shutterstock','dreamstime','flickr','yandex','yelp','restocdn','zoon','restobook','booking','googleusercontent','fbcdn','instagram','cdninstagram'];
const IMAGE_STOPWORDS = new Set(['cafe','restaurant','interior','inside','menu','food','drink','dessert','coffee','tea','cake','bar','shop','venue','place','the','and','of','a','an','в','и','на','к','для','с','из','по','за','под','напитки','десерты','кухня','кофе','чай','test','demo','ttk','тест','демо']);

function getImageHostname(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; }
}

function isGoodImageDomain(hostname) {
  if (!hostname) return false;
  const parts = hostname.split('.');
  return IMAGE_GOOD_DOMAINS.some(d => parts.includes(d));
}

function isBadImageDomain(hostname) {
  if (!hostname) return false;
  const h = hostname;
  return IMAGE_BAD_URL_TERMS.some(t => h.includes(t));
}

function isImageRelevantForQuery(url, query) {
  if (!url) return false;
  const u = url.toLowerCase();
  const hostname = getImageHostname(url);
  if (isBadImageDomain(hostname) || IMAGE_BAD_URL_TERMS.some(t => u.includes(t))) return false;
  const q = (query || '').toLowerCase().trim();
  const qWords = q.split(/[^a-zа-я0-9]+/i).map(w => w.trim()).filter(w => w.length > 1);
  const meaningful = qWords.filter(w => !IMAGE_STOPWORDS.has(w));
  if (meaningful.length && meaningful.some(w => u.includes(w))) return true;
  if (q.includes('interior') || q.includes('интерьер') || q.includes('inside')) {
    if (['interior','inside','cafe','coffee','restaurant','bar','shop','room','table','chair','window'].some(h => u.includes(h))) return true;
  }
  if (q.includes('coffee') || q.includes('кофе')) {
    if (['coffee','cafe','espresso','cappuccino','latte','cup','mug'].some(h => u.includes(h))) return true;
  }
  if (q.includes('drink') || q.includes('напит')) {
    if (['drink','coffee','tea','beverage','cup','glass','cocktail','juice'].some(h => u.includes(h))) return true;
  }
  if (q.includes('dessert') || q.includes('десерт')) {
    if (['dessert','cake','sweet','pastry','tart','croissant','chocolate'].some(h => u.includes(h))) return true;
  }
  if (q.includes('food')) {
    if (['food','dish','meal','plate','cuisine','lunch','dinner'].some(h => u.includes(h))) return true;
  }
  if (isGoodImageDomain(hostname)) return true;
  return false;
}

function clearSearchImages() {
  const venue = state.venue;
  if (!venue) return;
  const yandexUrls = new Set((venue.images || []).filter(i => i.source === 'yandex').map(i => i.url));
  venue.images = (venue.images || []).filter(i => i.source !== 'yandex');
  if (venue.bgImage && yandexUrls.has(venue.bgImage)) venue.bgImage = '';
  venue.sections.forEach(s => { if (yandexUrls.has(s.image)) s.image = ''; });
  saveProgress({ venue: venue });
  syncVenue();
  render();
  showPlatformToast('Найденные фото удалены');
}

async function searchCustomVenueImage(query) {
  const venue = state.venue;
  if (!venue) return;
  const q = (query || '').trim();
  if (!q) return;
  showPlatformToast('Ищем фото...');
  try {
    const results = await searchYandexImages(q, 6);
    const seen = new Set((venue.images || []).map(i => i.url));
    results.forEach(r => {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        addVenueImage(r.url, 'yandex', { query: q, title: r.title });
      }
    });
    render();
    showPlatformToast('Фото добавлены');
  } catch (e) {
    console.error('Custom image search error', e);
    showPlatformToast('Не удалось найти фото');
  }
}

async function searchVenueImagesOnline() {
  const venue = state.venue;
  if (!venue) return;
  showPlatformToast('Ищем фото в Яндекс Картинках...');
  const sections = getVenueSections();
  const venueName = (venue.name || '').trim();
  const baseQueries = [];
  if (venueName) {
    baseQueries.push(`${venueName} interior`, `${venueName} inside`);
  }
  baseQueries.push('coffee shop interior', 'cafe interior');
  const sectionQueries = [];
  sections.forEach(s => {
    const sn = (s.name || '').trim();
    if (!sn) return;
    const hint = sectionSearchHint(sn);
    const meaningfulWords = sn.toLowerCase().split(/[^a-zа-я0-9]+/i).filter(w => w.length > 1 && !IMAGE_STOPWORDS.has(w));
    if (!hint && !meaningfulWords.length) return;
    if (venueName) sectionQueries.push(`${venueName} ${sn}`);
    if (hint) {
      sectionQueries.push(`${sn} ${hint}`, `${hint} cafe`);
    } else {
      sectionQueries.push(`${sn} cafe`, `${sn} restaurant`);
    }
  });
  const allQueries = [...baseQueries, ...sectionQueries];
  const yandexUrls = new Set((venue.images || []).filter(i => i.source === 'yandex').map(i => i.url));
  venue.images = (venue.images || []).filter(i => i.source !== 'yandex');
  if (venue.bgImage && yandexUrls.has(venue.bgImage)) venue.bgImage = '';
  venue.sections.forEach(s => { if (yandexUrls.has(s.image)) s.image = ''; });
  const seen = new Set((venue.images || []).map(i => i.url));
  const MAX_TOTAL = 20;
  for (const q of allQueries) {
    if ((venue.images || []).length >= MAX_TOTAL) break;
    try {
      const results = await searchYandexImages(q, 2);
      results.forEach(r => {
        if (!seen.has(r.url)) {
          seen.add(r.url);
          addVenueImage(r.url, 'yandex', { query: q, title: r.title });
        }
      });
    } catch (e) {
      console.error('Yandex search error', q, e);
    }
  }
  render();
  showPlatformToast('Фото из интернета добавлены');
}

function sectionSearchHint(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('напит') || n.includes('кофе') || n.includes('чай') || n.includes('drink') || n.includes('coffee') || n.includes('tea')) return 'drink';
  if (n.includes('десерт') || n.includes('сладк') || n.includes('cake') || n.includes('dessert') || n.includes('pastry')) return 'dessert';
  if (n.includes('кухн') || n.includes('блюдо') || n.includes('еда') || n.includes('food') || n.includes('dish') || n.includes('kitchen')) return 'food';
  if (n.includes('сэндвич') || n.includes('бургер') || n.includes('sandwich') || n.includes('burger')) return 'sandwich';
  if (n.includes('салат') || n.includes('salad')) return 'salad';
  if (n.includes('суп') || n.includes('soup')) return 'soup';
  return '';
}

async function searchYandexImages(query, limit) {
  if (!query || !query.trim()) return [];
  const target = `https://yandex.com/images/search?text=${encodeURIComponent(query)}&lr=10415`;
  const proxy = 'https://corsproxy.io/?' + encodeURIComponent(target);
  const res = await fetch(proxy);
  const text = await res.text();
  const urls = [];
  const re = /&quot;img_href&quot;:&quot;([^&]+)&quot;/g;
  let m;
  while ((m = re.exec(text))) {
    if (urls.length >= 10) break;
    let url = m[1].replace(/&amp;/g, '&');
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) continue;
    if (urls.includes(url)) continue;
    if (!isImageRelevantForQuery(url, query)) continue;
    urls.push(url);
  }
  return urls.slice(0, limit).map(url => ({ url, title: query }));
}

function autoAssignVenueImages() {
  const venue = state.venue;
  if (!venue || !venue.images) return;
  const sections = getVenueSections();
  const venueName = (venue.name || '').trim();
  const bg = pickRelevantImageByQuery(venue.images, `${venueName} interior`)
    || pickRelevantImageByQuery(venue.images, `${venueName} inside`)
    || pickRelevantImageByQuery(venue.images, 'coffee shop interior')
    || pickRelevantImageByQuery(venue.images, 'cafe interior')
    || findBestImageForKeywords(venue.images, ['interior', 'inside', 'room', 'cafe', 'restaurant']);
  if (bg && !venue.bgImage) venue.bgImage = bg.url;
  sections.forEach(s => {
    if (s.image) return;
    const sn = (s.name || '').trim();
    const hint = sectionSearchHint(sn);
    let img = pickRelevantImageByQuery(venue.images, `${venueName} ${sn}`)
      || pickRelevantImageByQuery(venue.images, hint ? `${sn} ${hint}` : `${sn} cafe`)
      || pickRelevantImageByQuery(venue.images, sn);
    if (!img) {
      const words = sn.toLowerCase().split(/[^a-zа-я0-9]+/i).filter(Boolean);
      img = findBestImageForKeywords(venue.images, words) || findBestImageForKeywords(venue.images, ['food', 'drink', 'dessert']);
    }
    if (img) s.image = img.url;
  });
  saveProgress({ venue: venue });
  syncVenue();
  applyVenueStyle(venue.style, venue.bgImage);
  render();
  showPlatformToast('Фото распределены');
}

function pickRelevantImageByQuery(images, query) {
  if (!query || !images || !images.length) return null;
  const q = query.trim().toLowerCase();
  if (!q) return null;
  for (const img of images) {
    const metaQuery = ((img.meta && img.meta.query) || '').toLowerCase();
    if (metaQuery === q && isImageRelevantForQuery(img.url, query)) return img;
  }
  return findBestImageForKeywords(images, q.split(/\s+/).filter(Boolean));
}

function findBestImageForKeywords(images, keywords) {
  if (!images || !images.length || !keywords || !keywords.length) return null;
  const scored = images.map(img => {
    if (!isImageRelevantForQuery(img.url, (img.meta && img.meta.query) || '')) return null;
    const text = ((img.meta && img.meta.query) || img.name || img.url || '').toLowerCase();
    let score = 0;
    keywords.forEach(k => {
      if (k && text.includes(k.toLowerCase())) score += 1;
    });
    return { img, score };
  }).filter(Boolean).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].img : null;
}

// ====================== PARSERS ======================

function isImageFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','webp','gif','bmp','heic','heif'].includes(ext)) return true;
  return (file.type || '').startsWith('image/');
}

function loadMammoth() {
  if (typeof mammoth !== 'undefined') return Promise.resolve();
  return loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
}

function parseDocxFile(file) {
  return loadMammoth().then(() => {
    return file.arrayBuffer().then(arrayBuffer => {
      return mammoth.convertToHtml({ arrayBuffer }).then(result => parseDocxHTML(result.value));
    });
  });
}

function parseTTKFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve([]); return; }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'docx') {
      parseDocxFile(file).then(items => resolve(items || [])).catch(reject);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const items = parseTTKText(text, ext);
      resolve(items || []);
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    if (ext === 'json') reader.readAsText(file);
    else reader.readAsText(file, 'UTF-8');
  });
}

async function parseTTKImageFiles(files) {
  if (!files || !files.length) return [];
  await loadTesseract();
  const worker = await Tesseract.createWorker('rus');
  const results = [];
  for (const file of files) {
    const items = await processTTKImageWithWorker(file, worker);
    if (items && items.length) results.push(...items);
  }
  await worker.terminate();
  return results;
}

async function handleTTKFiles(files) {
  if (!files || !files.length) return;
  const fileArray = Array.from(files);
  const allItems = [];
  let worker = null;
  let hasImages = false;
  let ocrSpaceFailed = false;
  try {
    for (const file of fileArray) {
      if (isImageFile(file)) {
        if (!hasImages) {
          hasImages = true;
          showPlatformToast('Распознаём фото...');
        }
        let items = null;
        if (!ocrSpaceFailed) {
          try {
            items = await processTTKImageWithOCRSpace(file);
          } catch (e) {
            console.warn('OCR.space failed, falling back to Tesseract', e);
            ocrSpaceFailed = true;
          }
        }
        if (!items || !items.length) {
          if (!worker) {
            await loadTesseract();
            worker = await Tesseract.createWorker('rus');
          }
          items = await processTTKImageWithWorker(file, worker);
        }
        if (items && items.length) allItems.push(...items);
      } else {
        const items = await parseTTKFile(file);
        if (items && items.length) allItems.push(...items);
      }
    }
  } catch (e) {
    console.error('TTK files error:', e);
    showPlatformToast('Ошибка распознавания файлов');
    return;
  } finally {
    if (worker) await worker.terminate();
  }
  if (!allItems.length) {
    showPlatformToast('Не удалось распознать позиции');
    return;
  }
  const sourceName = fileArray.length === 1 ? (fileArray[0].name.replace(/\.[^.]+$/, '').trim() || 'ТТК') : 'ТТК';
  previewParsedItems(allItems, sourceName);
}

function handleTTKFile(file) {
  if (file) handleTTKFiles([file]);
}

async function handleTTKImageFiles(files) {
  await handleTTKFiles(files);
}

function loadTesseract() {
  if (typeof Tesseract !== 'undefined') return Promise.resolve();
  return loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
}

function median(arr) {
  if (!arr || !arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function parseTTKImageLayout(ret) {
  let lines = ret && ret.data && ret.data.lines;
  const words = ret && ret.data && ret.data.words;
  const text = (ret && ret.data && ret.data.text) || '';
  if (!lines || !lines.length || !words || !words.length) return parseTTKOCRText(text);
  // Attach per-line word lists from the global word list (Tesseract does not always include them).
  lines = lines.map(l => {
    const lWords = words.filter(w => {
      const cy = ((w.bbox.y0 || 0) + (w.bbox.y1 || 0)) / 2;
      return cy >= (l.bbox.y0 - 5) && cy <= (l.bbox.y1 + 5);
    });
    return Object.assign({}, l, { words: lWords });
  });
  const cardTexts = extractCardTextsFromLines(lines, words);
  if (!cardTexts.length) return parseTTKOCRText(text);
  const all = [];
  for (const cardText of cardTexts) {
    const items = parseCardBlock(cardText);
    if (items && items.length) all.push(...items);
  }
  return postProcessParsedItems(all);
}

function extractCardTextsFromLines(lines, words) {
  // 1. Build per-line segments. Title lines are kept whole or split by dish-name
  //    ranges so the title does not lose words. Non-title lines are split by
  //    horizontal word gaps to separate side-by-side columns/pages.
  const allSegments = [];
  for (const l of lines) {
    const ws = (l.words || []).filter(w => w.text && w.text.trim().length)
      .sort((a, b) => (a.bbox.x0 || 0) - (b.bbox.x0 || 0));
    if (!ws.length) continue;
    const lineY0 = Math.min(...ws.map(w => w.bbox.y0));
    const lineY1 = Math.max(...ws.map(w => w.bbox.y1));
    const lineX0 = Math.min(...ws.map(w => w.bbox.x0));
    const lineX1 = Math.max(...ws.map(w => w.bbox.x1));
    const lineWidth = Math.max(1, lineX1 - lineX0);
    const fullText = normalizeOCRText(ws.map(w => w.text).join(' '));
    const dishNames = (splitDishNames(fullText) || []).filter(isLikelyDishName);
    const isTitleLine = dishNames.length > 1 || (dishNames.length === 1 && isLikelyDishName(fullText) && !isLikelyComponent(fullText));
    if (isTitleLine) {
      const ranges = findTitleWordRanges(ws, dishNames);
      for (const range of ranges) {
        if (range && range.length) allSegments.push(makeSegment(range, lineY0, lineY1));
      }
      continue;
    }
    const gaps = [];
    for (let i = 1; i < ws.length; i++) {
      gaps.push((ws[i].bbox.x0 || 0) - (ws[i - 1].bbox.x1 || 0));
    }
    const avgGap = gaps.length ? (gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
    const gapThresh = Math.max(70, lineWidth * 0.30, avgGap * 4);
    let start = 0;
    for (let i = 1; i < ws.length; i++) {
      if ((ws[i].bbox.x0 || 0) - (ws[i - 1].bbox.x1 || 0) > gapThresh) {
        allSegments.push(makeSegment(ws.slice(start, i), lineY0, lineY1));
        start = i;
      }
    }
    allSegments.push(makeSegment(ws.slice(start), lineY0, lineY1));
  }

  function makeSegment(segWords, y0, y1) {
    const x0 = Math.min(...segWords.map(w => w.bbox.x0));
    const x1 = Math.max(...segWords.map(w => w.bbox.x1));
    const text = normalizeOCRText(segWords.map(w => w.text).join(' '));
    return { text, x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, words: segWords };
  }

  const segments = allSegments.filter(s => s.text && s.text.trim().length).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  if (!segments.length) return [];

  // 2. Extract titles from segments.
  const titles = extractLayoutTitles(segments);
  if (!titles.length) return segments.map(s => s.text);

  // 3. Cluster titles by horizontal position to separate side-by-side pages/cards.
  const maxX = Math.max(1, ...segments.map(s => s.x1));
  const sortedTitles = titles.slice().sort((a, b) => a.cx - b.cx);
  const clusters = [];
  const xGapThresh = Math.max(70, maxX * 0.12);
  for (const t of sortedTitles) {
    let placed = false;
    for (const c of clusters) {
      const centerDiff = Math.abs(t.cx - (c.cx / c.titles.length));
      if (centerDiff <= xGapThresh) { c.titles.push(t); c.cx += t.cx; placed = true; break; }
    }
    if (!placed) clusters.push({ titles: [t], cx: t.cx });
  }
  for (const c of clusters) {
    c.cx = c.cx / c.titles.length;
    c.cards = c.titles.slice().sort((a, b) => a.y0 - b.y0);
  }

  // 4. Horizontal zones for clusters.
  clusters.sort((a, b) => a.cx - b.cx);
  for (let i = 0; i < clusters.length; i++) {
    let left = 0, right = maxX;
    if (clusters.length > 1) {
      if (i === 0) right = (clusters[0].cx + clusters[1].cx) / 2;
      else if (i === clusters.length - 1) left = (clusters[i - 1].cx + clusters[i].cx) / 2;
      else {
        left = (clusters[i - 1].cx + clusters[i].cx) / 2;
        right = (clusters[i].cx + clusters[i + 1].cx) / 2;
      }
    }
    clusters[i].left = left - 25;
    clusters[i].right = right + 25;
  }

  // 5. Assign every non-title segment to the nearest title in its horizontal zone.
  const titleSegments = new Set(titles.map(t => t.line).filter(Boolean));
  const cardMap = new Map();
  for (const t of titles) cardMap.set(t, { title: t, segments: [] });

  function findTitleForSegment(seg) {
    let cluster = clusters.find(c => seg.cx >= c.left && seg.cx <= c.right);
    if (!cluster) cluster = clusters.reduce((best, c) => Math.abs(seg.cx - c.cx) < Math.abs(seg.cx - best.cx) ? c : best, clusters[0]);
    let best = null, bestScore = Infinity;
    for (const t of cluster.cards) {
      if (seg.cy < t.y0 - 10) continue;
      const score = Math.abs(seg.cy - t.cy) * 1.5 + Math.abs(seg.cx - t.cx);
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  for (const seg of segments) {
    if (titleSegments.has(seg)) continue;
    const t = findTitleForSegment(seg);
    if (t) cardMap.get(t).segments.push(seg);
  }

  // 6. Build per-card text blocks; merge same-y segments left-to-right.
  const cards = Array.from(cardMap.values()).sort((a, b) => a.title.y0 - b.title.y0 || a.title.cx - b.title.cx);
  return cards.map(({ title, segments: segs }) => {
    if (!segs.length) return title.text;
    const sorted = segs.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const avgHeight = Math.max(10, median(sorted.map(s => s.y1 - s.y0)) || 20);
    const rows = [];
    for (const seg of sorted) {
      if (!rows.length) { rows.push([seg]); continue; }
      const last = rows[rows.length - 1];
      const lastMinY = Math.min(...last.map(s => s.y0));
      const lastMaxY = Math.max(...last.map(s => s.y1));
      const lastCy = (lastMinY + lastMaxY) / 2;
      const lastMaxX = Math.max(...last.map(s => s.x1));
      const curCy = (seg.y0 + seg.y1) / 2;
      const overlap = Math.max(0, Math.min(seg.y1, lastMaxY) - Math.max(seg.y0, lastMinY));
      const yClose = Math.abs(curCy - lastCy) <= avgHeight * 0.55 || overlap > avgHeight * 0.4;
      // A big jump back to the left column means a new table row, even if y is close.
      const movedRight = seg.x0 >= lastMaxX - 20 || Math.abs(curCy - lastCy) <= avgHeight * 0.25;
      if (yClose && movedRight) {
        last.push(seg);
      } else {
        rows.push([seg]);
      }
    }
    const rowTexts = rows.map(row => {
      row.sort((a, b) => a.x0 - b.x0);
      return row.map(s => s.text).join(' ').trim();
    }).filter(Boolean);
    return [title.text, ...rowTexts].join('\n').trim();
  }).filter(Boolean);
}

function extractLayoutTitles(lineObjs) {
  const titles = [];
  for (const line of lineObjs) {
    const norm = normalizeOCRText(line.text);
    if (!norm.trim()) continue;
    const names = splitDishNames(norm);
    if (names.length > 1) {
      const ranges = findTitleWordRanges(line.words, names);
      for (let i = 0; i < names.length && i < ranges.length; i++) {
        const ws = ranges[i];
        const rangeText = ws.map(w => w.text).join(' ');
        if (isLikelyComponent(rangeText)) continue;
        const x0 = Math.min(...ws.map(w => w.bbox.x0));
        const x1 = Math.max(...ws.map(w => w.bbox.x1));
        const xs = ws.map(w => (w.bbox.x0 + w.bbox.x1) / 2);
        titles.push({ text: names[i], x0, x1, cx: median(xs), y0: line.y0, y1: line.y1, cy: line.cy, words: ws, line });
      }
    } else if (names.length === 1 && isLikelyDishName(names[0]) && !isLikelyComponent(norm)) {
      titles.push({ text: names[0], x0: line.x0, x1: line.x1, cx: line.cx, y0: line.y0, y1: line.y1, cy: line.cy, words: line.words, line });
    }
  }
  return titles;
}

function findTitleWordRanges(words, names) {
  const n = names.length;
  const cache = new Map();
  function isDishCached(text) {
    if (cache.has(text)) return cache.get(text);
    const ok = isLikelyDishName(cleanItemName(text));
    cache.set(text, ok);
    return ok;
  }
  function search(startIdx, nameIdx) {
    if (nameIdx === n - 1) {
      const left = words.slice(startIdx).map(w => w.text).join(' ');
      if (isDishCached(left)) return [words.slice(startIdx)];
      return null;
    }
    let best = null;
    let bestGap = -1;
    for (let i = startIdx + 1; i <= words.length - (n - nameIdx - 1); i++) {
      const left = words.slice(startIdx, i).map(w => w.text).join(' ');
      if (!isDishCached(left)) continue;
      const rightWords = words.slice(i);
      if (rightWords.length < n - nameIdx - 1) continue;
      const rest = search(i, nameIdx + 1);
      if (!rest) continue;
      const gap = i < words.length ? words[i].bbox.x0 - words[i - 1].bbox.x1 : 0;
      if (gap > bestGap) { bestGap = gap; best = [words.slice(startIdx, i), ...rest]; }
    }
    return best;
  }
  return search(0, 0) || [words];
}

function parseCardBlock(text) {
  if (!text) return [];
  const normalized = normalizeOCRText(text);
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const name = cleanItemName(lines[0]);
  if (!name || !isLikelyDishName(name)) return [];
  const noteStartWords = new Set(['сверху','снизу','внутрь','внутри','вне','для','по','как','фото','рисунок','пример','примерно']);
  const noteAnyWords = new Set(['украшение','украсить','посыпать','присыпать','разрезать','запечь','половина','треть','четверть','ломтик','кусочек','щепотка','сверху','снизу']);
  function isNoteFragment(line) {
    const words = (line || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return false;
    return noteStartWords.has(words[0]);
  }
  function parseComponentLine(line) {
    const compList = [];
    const ex = extractComponents(line);
    if (ex.tokens && ex.tokens.length) {
      for (const t of ex.tokens) {
        const comp = parseComponentToken(t);
        if (comp && comp.ingredient) compList.push(comp);
      }
    }
    if (!compList.length) {
      const comp = parseComponentToken(line);
      if (comp && comp.ingredient) compList.push(comp);
    }
    return { comps: compList, description: ex.description || '' };
  }
  function appendNote(note) {
    if (!components.length || !note) return;
    const prev = components[components.length - 1];
    if (!prev.ingredient) return;
    const m = prev.ingredient.match(/^(.*)\((.*)\)$/);
    if (m) {
      prev.ingredient = m[1] + '(' + m[2] + ' ' + note + ')';
    } else {
      prev.ingredient = prev.ingredient + ' (' + note + ')';
    }
  }
  const components = [];
  const descLines = [];
  let inDesc = false;
  let hasComponent = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (isDescriptionHeader(line)) { inDesc = true; descLines.push(line); continue; }
    if (inDesc) { descLines.push(line); continue; }
    if (isLikelyComponent(line) || isLikelyIngredientName(cleanItemName(line))) {
      if (!isLikelyComponent(line)) {
        const firstChar = line.charAt(0);
        const wordCount = line.split(/\s+/).filter(Boolean).length;
        if (firstChar !== firstChar.toUpperCase() && wordCount > 1) {
          if (hasComponent) appendNote(cleanItemName(line));
          continue;
        }
      }
      const { comps, description: lineDesc } = parseComponentLine(line);
      if (comps.length) {
        components.push(...comps);
        hasComponent = true;
      }
      if (lineDesc) {
        descLines.push(lineDesc);
      }
      continue;
    }
    if (isNoteFragment(line)) {
      if (hasComponent) appendNote(cleanItemName(line));
      continue;
    }
    if (hasInstructionWords(line) || line.length > 70) {
      if (hasComponent) { inDesc = true; descLines.push(line); }
      continue;
    }
    if (hasComponent && line.length < 60) {
      appendNote(cleanItemName(line));
      continue;
    }
    // ignore leading noise until first component is found
  }
  if (!components.length) return [];
  return [{
    type: 'composition',
    name,
    correct: components,
    info_text: buildInfoText(name, components),
    description: descLines.join('\n').trim() || undefined
  }];
}

async function processTTKImageWithWorker(file, worker) {
  const imageUrl = await resizeImageFile(file, 1400, 0.9);
  const ret = await worker.recognize(imageUrl);
  const text = ret.data.text || '';
  const words = ret.data.words || [];
  const photoUrl = words.length ? await extractDishPhoto(imageUrl, words) : null;
  const layoutItems = parseTTKImageLayout(ret, imageUrl) || [];
  const plainItems = parseTTKOCRText(text) || [];
  function totalComponents(arr) { return arr.reduce((s, it) => s + ((it.correct && it.correct.length) || 0), 0); }
  let items = layoutItems;
  if (totalComponents(plainItems) > totalComponents(layoutItems)) {
    items = plainItems;
  }
  if (!items.length) items = plainItems.length ? plainItems : layoutItems;
  if (photoUrl && items.length) {
    items[0].image = photoUrl;
  }
  return items;
}

function getOCRSpaceApiKey() {
  try {
    return localStorage.getItem('ocrSpaceApiKey') || 'helloworld';
  } catch (e) {
    return 'helloworld';
  }
}

async function callOCRSpace(imageDataUrl) {
  const form = new FormData();
  form.append('apikey', getOCRSpaceApiKey());
  form.append('language', 'rus');
  form.append('OCREngine', '2');
  form.append('isTable', 'true');
  form.append('scale', 'true');
  form.append('isOverlayRequired', 'true');
  form.append('base64Image', imageDataUrl);
  const resp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form });
  if (!resp.ok) throw new Error('OCR.space HTTP ' + resp.status);
  const json = await resp.json();
  if (json.IsErroredOnProcessing || !json.ParsedResults || !json.ParsedResults[0]) {
    throw new Error(json.ErrorMessage || 'OCR.space error');
  }
  return json.ParsedResults[0];
}

function isQualityItem(item) {
  const comps = (item && item.correct) || [];
  if (comps.length > 40) return false; // likely several dishes merged together
  for (const c of comps) {
    if (c.grams > 0 || c.isCount) return true;
    const clean = cleanItemName(c.ingredient || '');
    if (clean && /[а-яё]{2,}/i.test(clean)) return true;
  }
  return false;
}

function isQualityOCRResult(items) {
  if (!items || !items.length) return false;
  return items.some(isQualityItem);
}

async function processTTKImageWithOCRSpace(file) {
  const imageUrl = await resizeImageFile(file, 1400, 0.9);
  const result = await callOCRSpace(imageUrl);
  const parsedText = (result.ParsedText || '').replace(/\r\n/g, '\n');
  const overlay = result.TextOverlay || {};
  const rawLines = overlay.Lines || [];

  // Try tabular OCR text first; OCR.space with isTable=true returns tabs between columns.
  let items = parseTTKTableText(parsedText) || [];
  if (isQualityOCRResult(items)) {
    items = items.filter(isQualityItem);
    const allWords = rawLines.reduce((acc, line) => {
      (line.Words || []).forEach(w => acc.push({
        text: w.WordText || '',
        confidence: 95,
        bbox: { x0: w.Left || 0, y0: w.Top || 0, x1: (w.Left || 0) + (w.Width || 0), y1: (w.Top || 0) + (w.Height || 0) }
      }));
      return acc;
    }, []).filter(w => w.text);
    const photoUrl = allWords.length ? await extractDishPhoto(imageUrl, allWords) : null;
    if (photoUrl && items.length) items[0].image = photoUrl;
    return items;
  }

  if (!rawLines.length) {
    items = parseTTKOCRText(parsedText) || [];
    if (isQualityOCRResult(items)) return items.filter(isQualityItem);
    return [];
  }
  const lines = rawLines.map(line => {
    const ws = (line.Words || []).map(w => ({
      text: w.WordText || '',
      confidence: 95,
      bbox: {
        x0: w.Left || 0,
        y0: w.Top || 0,
        x1: (w.Left || 0) + (w.Width || 0),
        y1: (w.Top || 0) + (w.Height || 0)
      }
    })).filter(w => w.text);
    const x0s = ws.map(w => w.bbox.x0);
    const x1s = ws.map(w => w.bbox.x1);
    const y0s = ws.map(w => w.bbox.y0);
    const y1s = ws.map(w => w.bbox.y1);
    const bbox = ws.length ? { x0: Math.min(...x0s), x1: Math.max(...x1s), y0: Math.min(...y0s), y1: Math.max(...y1s) } : { x0: 0, y0: 0, x1: 0, y1: 0 };
    return { text: (line.LineText || '').trim(), words: ws, bbox };
  }).filter(l => l.words.length);
  const allWords = lines.reduce((acc, l) => { acc.push(...l.words); return acc; }, []);
  const ret = { data: { text: parsedText, lines, words: allWords } };
  items = parseTTKImageLayout(ret, imageUrl) || [];
  if (!isQualityOCRResult(items)) items = parseTTKOCRText(parsedText) || [];
  items = items.filter(isQualityItem);
  const photoUrl = allWords.length ? await extractDishPhoto(imageUrl, allWords) : null;
  if (photoUrl && items.length) items[0].image = photoUrl;
  return items.length ? items : [];
}

async function extractDishPhoto(imageDataUrl, words) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.width;
      const height = img.height;
      if (width < 80 || height < 80) { resolve(null); return; }
      const pad = Math.min(width, height) * 0.02;
      const cols = 24, rows = 24;
      const cw = width / cols;
      const ch = height / rows;
      const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
      for (const w of words) {
        const b = w.bbox;
        const c0 = Math.max(0, Math.floor((b.x0 - pad) / cw));
        const c1 = Math.min(cols - 1, Math.ceil((b.x1 + pad) / cw));
        const r0 = Math.max(0, Math.floor((b.y0 - pad) / ch));
        const r1 = Math.min(rows - 1, Math.ceil((b.y1 + pad) / ch));
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            grid[r][c] = 1;
          }
        }
      }
      let gridCopy = grid.map(row => row.slice());
      let attempts = 5;
      while (attempts-- > 0) {
        const rect = maximalRectangleOfZeros(gridCopy);
        if (!rect) break;
        const left = Math.max(0, Math.floor(rect.left * cw));
        const top = Math.max(0, Math.floor(rect.top * ch));
        const right = Math.min(width, Math.ceil((rect.right + 1) * cw));
        const bottom = Math.min(height, Math.ceil((rect.bottom + 1) * ch));
        const cropW = right - left;
        const cropH = bottom - top;
        if (cropW >= 80 && cropH >= 80) {
          const canvas = document.createElement('canvas');
          canvas.width = cropW;
          canvas.height = cropH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, left, top, cropW, cropH, 0, 0, cropW, cropH);
          const stats = computeImageStats(canvas);
          if (stats.variance >= 150 && stats.nonWhiteRatio > 0.1) {
            resolve(canvas.toDataURL('image/jpeg', 0.85));
            return;
          }
        }
        for (let r = rect.top; r <= rect.bottom; r++) {
          for (let c = rect.left; c <= rect.right; c++) {
            gridCopy[r][c] = 1;
          }
        }
      }
      resolve(null);
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });
}

function maximalRectangleOfZeros(matrix) {
  if (!matrix.length || !matrix[0].length) return null;
  const rows = matrix.length;
  const cols = matrix[0].length;
  const heights = new Array(cols).fill(0);
  let best = null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[c] = matrix[r][c] === 0 ? heights[c] + 1 : 0;
    }
    const stack = [];
    for (let c = 0; c <= cols; c++) {
      const h = c === cols ? 0 : heights[c];
      let start = c;
      while (stack.length && h < stack[stack.length - 1].h) {
        const top = stack.pop();
        const width = c - top.i;
        const height = top.h;
        const area = width * height;
        if (!best || area > best.area) {
          best = { area, top: r - height + 1, left: top.i, bottom: r, right: c - 1 };
        }
        start = top.i;
      }
      stack.push({ i: start, h });
    }
  }
  return best;
}

function computeImageStats(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  if (width < 2 || height < 2) return { variance: 0, nonWhiteRatio: 0 };
  const data = ctx.getImageData(0, 0, width, height).data;
  let sum = 0;
  let sumSq = 0;
  let nonWhite = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const v = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += v;
    sumSq += v * v;
    if (v < 245) nonWhite++;
    n++;
  }
  if (!n) return { variance: 0, nonWhiteRatio: 0 };
  const mean = sum / n;
  const variance = (sumSq / n) - mean * mean;
  return { variance, nonWhiteRatio: nonWhite / n };
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
  let lastTableItem = null;
  let descriptionBuffer = [];

  function isBoldParagraph(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE || node.tagName.toLowerCase() !== 'p') return false;
    const bold = [...node.querySelectorAll('strong, b')].map(n => n.textContent).join('');
    return bold.trim() === node.textContent.trim();
  }

  function flushDescription() {
    if (lastTableItem && descriptionBuffer.length) {
      lastTableItem.description = ((lastTableItem.description || '') + (lastTableItem.description ? '\n\n' : '') + descriptionBuffer.join('\n\n')).trim();
      descriptionBuffer = [];
    }
  }

  for (const child of wrapper.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'table') {
      flushDescription();
      const menuItems = parseMenuTable(child);
      if (menuItems) {
        items.push(...menuItems);
        lastTableItem = null;
      } else {
        const item = parseIngredientTable(child, pendingName);
        if (item) {
          items.push(item);
          lastTableItem = item;
        }
      }
      pendingName = null;
      pendingIsHeading = false;
      continue;
    }
    const tag = child.nodeType === Node.ELEMENT_NODE ? child.tagName.toLowerCase() : '';
    const isHeading = headingTags.includes(tag) || isBoldParagraph(child);
    const text = nodeText(child).trim();
    if (!text) continue;
    if (/^ттк$/i.test(text)) continue;
    if (/^[A-ZА-ЯЁ\d\s]+$/.test(text)) continue;
    if (isHeading || isLikelyDishName(cleanItemName(text))) {
      flushDescription();
      pendingName = text;
      pendingIsHeading = isHeading;
      lastTableItem = null;
    } else if (lastTableItem) {
      descriptionBuffer.push(text);
    } else {
      flushDescription();
      pendingName = text;
      pendingIsHeading = false;
    }
  }
  flushDescription();

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
  state.editorDirty = true;
  openCourseEditor();
}

function isSectionHeading(s) {
  const words = ['состав','ингредиенты','ингредиент','рецепт','готовка','техкарта','карточка','описание','фото','фотография'];
  return words.includes((s || '').toLowerCase().trim());
}

const headerDishWords = new Set(['салат','суп','омлет','яичница','блюдо','гарнир','соус','закуска','десерт','напиток','каша','салями','рыба','мясо']);
function isDishDishHeader(s) {
  const t = (s || '').trim();
  const m = t.match(/^([A-ZА-ЯЁ][a-zа-яё\s-]{1,20}):\s*([A-ZА-ЯЁ][a-zа-яё\s-]{1,20}):?$/);
  if (!m) return false;
  return headerDishWords.has(m[2].toLowerCase().trim());
}

function normalizeOCRText(text) {
  if (!text) return '';
  const units = 'шт|штук|штуки|г|гр|грамм|грам|мл|миллилитров|л|кг|кгр|мг|g|gr|gram|grams|ml|pcs|pc';
  const ocrUnits = units.split('|').sort((a, b) => b.length - a.length).join('|');
  const ocrDigitRe = new RegExp('(^|[^a-zA-Zа-яёЁ0-9])([ЗзАа])(' + units + ')(?![a-zA-Zа-яёЁ0-9])', 'gi');
  const ocrDigit2Re = new RegExp('(^|[^a-zA-Zа-яёЁ0-9])([Зз])([Оо0])\\s*(' + ocrUnits + ')(?![a-zA-Zа-яёЁ0-9])', 'gi');
  const ocrZeroRe = new RegExp('(\\d)(?:\\s*[ОоO]\\s*)+(' + ocrUnits + ')(?![a-zA-Zа-яёЁ0-9])', 'gi');
  let t = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/@/g, 'а')
    .replace(/`/g, '');
  const uiPatterns = [
    /^\s*<\s*.*$/,
    /^\s*\d{1,2}:\d{2}\b/,
    /редактор\s*\(?фото\s*ттк\)?/i,
    /сохранено/i,
    /\+\s*добавить\s*ингредиент/i,
    /описание\s*\/\s*процесс\s*приготовления/i,
    /процесс\s*приготовления\s*блюда/i,
    /^\s*фото\s*$/i,
    /^\s*[-+=—–…]+\s*$/,
    /(?:басе64|base64|data:image|image\/)/i,
    /закрепл[её]нное\s+сообщение/i,
    /\bсообщение\b/i,
    /\bфотография\b/i,
    /\bв\s+сети\b/i,
    /^\s*\d{1,2}:\d{2}\s*(?:[ap]m)?\s*$/i,
    /\d{1,2}:\d{2}/,
    /[®©]/,
    /^\s*[\[<].*$/,
    /^\s*[A-ZА-ЯЁ\s\d]+[)\]<>]\s*$/,
    /^\s*\d+(?:\s+\d+)+\s*$/,
    /^\s*\d+\s*$/,
  ];
  const outLines = [];
  let prevEmpty = false;
  for (const line of t.split('\n')) {
    let keep = line.replace(/^\s*\|+/, '').trim();
    for (const re of uiPatterns) if (re.test(line)) { keep = ''; break; }
    if (isSectionHeading(cleanItemName(line)) && line.trim().length <= 30) keep = '';
    if (keep && isDishDishHeader(line)) keep = '';
    if (keep === '') {
      if (!prevEmpty) outLines.push('');
      prevEmpty = true;
    } else {
      outLines.push(keep);
      prevEmpty = false;
    }
  }
  t = outLines.join('\n').trim();
  t = t.replace(/(\d{1,3}(?:[.,]\d{1,3})?)\s*[/\\]\s*(\d{1,3})(?![\d.,])/g, (m, a, b) => {
    const val = parseFloat(a.replace(',', '.')) / parseFloat(b);
    return val.toFixed(3).replace(/\.?0+$/, '');
  })
    // drop common OCR garbage tokens
    .replace(/(^|[^a-zA-Zа-яёЁ0-9])(?:ке\s*сонеы|зоне|зонеы|зерен|зере|зее|зеее|сонеы|сенеы)(?![a-zA-Zа-яёЁ0-9])/gi, '$1')
    // OCR misreads "60г" as "бог" (б->6, о->0, г->г)
    .replace(/(^|[^a-zA-Zа-яёЁ0-9])[Бб][Оо0][Гг](?![a-zA-Zа-яёЁ0-9])/g, '$160г')
    .replace(ocrZeroRe, (m, digit, unit) => digit + '0' + unit.toLowerCase())
    .replace(ocrDigit2Re, (m, before, z, o, unit) => before + '30' + unit.toLowerCase())
    .replace(ocrDigitRe, (m, before, digit, unit) => before + (digit.toLowerCase() === 'а' ? '4' : '3') + unit.toLowerCase())
    .replace(/(^|[^a-zA-Zа-яёЁ0-9])дшт(?![a-zA-Zа-яёЁ0-9])/gi, '$14 шт')
    .replace(/(^|[^a-zA-Zа-яёЁ0-9])Солы?перец(?![a-zA-Zа-яёЁ0-9])/gi, '$1Соль перец')
    .replace(/(^|[^a-zA-Zа-яёЁ0-9])Перец[.,]?\s*соль(?![a-zA-Zа-яёЁ0-9])/gi, '$1перец соль')
    .replace(/[ \xA0]{2,}/g, ' ')
    .trim();
  return t;
}

function parseTTKPlainText(text) {
  if (!text || !text.trim()) return [];
  const normalized = normalizeOCRText(text);

  let blocks = normalized.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);

  if (blocks.length === 1 && blocks[0].split('\n').length >= 2) {
    const lines = blocks[0].split('\n').map(l => l.trim()).filter(Boolean);
    const split = maybeSplitBlocks(lines);
    if (split.length > 1) blocks = split;
  } else if (blocks.length > 1) {
    blocks = mergeHeadingBlocks(blocks);
  }
  blocks = mergeContinuationBlocks(blocks);
  blocks = mergeDescriptionBlocks(blocks);

  return postProcessParsedItems(processTTKBlocks(blocks));
}

function mergeContinuationBlocks(blocks) {
  const merged = [];
  for (const block of blocks) {
    const firstLine = (block.split('\n')[0] || '').trim();
    const cleaned = cleanItemName(firstLine);
    const lastLine = merged.length ? merged[merged.length - 1].split('\n').pop().trim() : '';
    const isIngredientLike = isLikelyComponent(firstLine) || (isLikelyIngredientName(cleaned) && !isLikelyDishName(cleaned));
    const isNoteContinuation = merged.length && isContinuationNote(firstLine) && (isLikelyComponent(lastLine) || isContinuationNote(lastLine)) && /(?:\s|^)(как|на|по|для|в|с|из|под|над|перед|после|при|про|к|от|до|без|за|об|у|и|а|но|или|со|во|о|не|также|ещё|еще|тоже|так|[,:;])\s*$/i.test(lastLine);
    if (merged.length && (isIngredientLike || isNoteContinuation) && !isDescriptionHeader(firstLine) && !isLabelPrefixedDishName(firstLine) && (!hasStrongDishWord(cleaned) || isNoteContinuation)) {
      merged[merged.length - 1] = merged[merged.length - 1] + '\n' + block;
    } else {
      merged.push(block);
    }
  }
  return merged;
}

function mergeDescriptionBlocks(blocks) {
  const merged = [];
  for (const block of blocks) {
    const firstLine = (block.split('\n')[0] || '').trim();
    if (isDescriptionHeader(firstLine) && merged.length) {
      merged[merged.length - 1] = merged[merged.length - 1] + '\n' + block;
    } else {
      merged.push(block);
    }
  }
  return merged;
}

function processTTKBlocks(blocks) {
  const items = [];
  let pendingDesc = '';
  for (const block of blocks) {
    const itemOrItems = parseItemBlock(block);
    const arr = Array.isArray(itemOrItems) ? itemOrItems : (itemOrItems ? [itemOrItems] : []);
    if (arr.length) {
      for (const item of arr) {
        if (pendingDesc) {
          item.description = (item.description ? item.description + '\n\n' : '') + pendingDesc;
        }
        items.push(item);
      }
      pendingDesc = '';
      continue;
    }
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.length === 1 && !isDescriptionHeader(lines[0]) && isLikelyDishName(lines[0])) continue;
    const headerIdx = lines.findIndex(isDescriptionHeader);
    let descLines = [];
    let headerFound = false;
    if (headerIdx !== -1) {
      headerFound = true;
      descLines = lines.slice(headerIdx);
    } else if (items.length) {
      descLines = lines;
    } else {
      continue;
    }
    const descText = descLines.join('\n').trim();
    if (!descText) continue;
    if (items.length) {
      const last = items[items.length - 1];
      last.description = (last.description ? last.description + '\n\n' : '') + descText;
    } else if (headerFound) {
      pendingDesc = descText;
    }
  }
  return items;
}

function postProcessParsedItems(items) {
  const out = [];
  for (const item of (items || [])) {
    const correct = (item.correct || []).filter(c => {
      if (typeof c !== 'object') return true;
      return (c.ingredient || '').trim().length > 0 || c.grams === '' || c.grams === undefined || c.grams === null;
    });
    item.correct = correct;
    const name = (item.name || '').trim();
    let desc = (item.description || '').trim();
    if (desc) {
      const descHeaderRe = /^(?:технология\s*приготовления|приготовление|способ\s*приготовления|готовка|описание)[\s:—–-]*$/i;
      desc = desc.split('\n').filter(l => !descHeaderRe.test(l.trim())).join('\n').trim();
    }
    item.description = desc;
    if (correct.length === 1 && name && correct[0].ingredient && name.toLowerCase() === correct[0].ingredient.trim().toLowerCase() && !desc && out.length) {
      const prev = out[out.length - 1];
      prev.correct = prev.correct.concat(correct);
      if (item.image) prev.image = item.image;
      continue;
    }
    out.push(item);
  }
  return out;
}

function parseTTKTableText(text) {
  if (!text || !text.trim() || text.indexOf('\t') === -1) return [];
  const lines = normalizeOCRText(text).split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const headerRe = /^(?:ингредиент|кол[-\s]?во|количество|вес|состав|наименование|продукт|ед\.?\s*изм|грамм|шт|мл|единица)$/i;
  const commonSingleDish = new Set(['оладьи','сырники','борщ','салат','суп','омлет','гречка','рис','каша','мюсли','бургер','чизкейк','морс','кисель','компот','смузи','пельмени','макароны','паштет','рулет','котлет','медальон','салями','пепперони','бекон','лимон','лайм','пицца','паста','лаваш','шаурма','плов','курица','рыба','мясо']);

  function isStrongDishTitle(l) {
    if (headerRe.test(l)) return false;
    if (isLikelyComponent(l)) return false;
    const s = cleanItemName(l);
    if (!s || s.length < 3 || s.length > 80) return false;
    if (/^\d/.test(s)) return false;
    if (!isLikelyDishName(s)) return false;
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      // Require at least one clearly dish-related word or a preposition; otherwise it is likely an ingredient phrase.
      const preps = new Set(['а','б','в','на','по','для','из','к','от','перед','после','при','про','без','до','за','над','под','об','у','и','но','или','чтобы','так','как','если','когда','где','затем','потом','далее','еще','ещё','же','бы','ли','со','во','с','о']);
      const dishWords = new Set([...commonSingleDish, 'сэндвич','салат','суп','бургер','пицца','паста','ролл','кремчиз','грильчиз','завтрак','завтраки','мортаделла','страчателла','прошутто','паштет','рулет','котлет','медальон','салями','пепперони']);
      const hasDishMarker = words.some(w => dishWords.has(w.toLowerCase()) || preps.has(w.toLowerCase()));
      if (!hasDishMarker) return false;
      return true;
    }
    return commonSingleDish.has(words[0].toLowerCase());
  }

  // Find the first solid dish title; skip Telegram/UI noise like "4 Instagram" or "Алина".
  const titleIdx = lines.findIndex(isStrongDishTitle);
  let title = titleIdx >= 0 ? lines[titleIdx] : (lines.find(l => !headerRe.test(l) && !l.includes('\t')) || 'Блюдо');

  const items = [];
  let item = { type: 'composition', name: cleanItemName(title), correct: [], info_text: '', description: '' };
  let inHeader = true;
  let inDescription = false;
  let descLines = [];

  function pushItem() {
    if (item.correct.length || item.description || descLines.length) {
      if (descLines.length && !item.description) item.description = descLines.join('\n').trim();
      items.push(postProcessParsedItems([item])[0]);
    }
    item = { type: 'composition', name: '', correct: [], info_text: '', description: '' };
    descLines = [];
    inHeader = true;
    inDescription = false;
  }

  for (let i = titleIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (i === titleIdx) continue;
    if (headerRe.test(line) && inHeader) continue;
    inHeader = false;
    if (isDescriptionHeader(line)) { inDescription = true; if (line) descLines.push(line); continue; }
    if (inDescription) { descLines.push(line); continue; }

    // New dish title: flush current and start next.
    if (!line.includes('\t') && isStrongDishTitle(line) && item.correct.length) {
      pushItem();
      item.name = cleanItemName(line);
      continue;
    }

    if (!line.includes('\t')) {
      if (isLikelyComponent(line)) {
        const ex = extractComponents(line);
        if (ex.tokens && ex.tokens.length) {
          for (const t of ex.tokens) {
            const comp = parseComponentToken(t);
            if (comp && comp.ingredient) item.correct.push(comp);
          }
        } else {
          const comp = parseComponentToken(line);
          if (comp && comp.ingredient) item.correct.push(comp);
          else if (ex.description) descLines.push(ex.description);
        }
        if (ex.description && !item.correct.length) descLines.push(ex.description);
      } else if (isLikelyDishName(line)) {
        descLines.push(line);
      } else {
        descLines.push(line);
      }
      continue;
    }

    const cells = line.split('\t').map(c => c.trim()).filter(c => c);
    if (!cells.length) continue;
    if (cells.length === 1) {
      const cell = cells[0];
      if (headerRe.test(cell)) continue;
      if (isLikelyComponent(cell)) {
        const ex = extractComponents(cell);
        if (ex.tokens && ex.tokens.length) {
          for (const t of ex.tokens) {
            const comp = parseComponentToken(t);
            if (comp && comp.ingredient) item.correct.push(comp);
          }
        } else {
          const comp = parseComponentToken(cell);
          if (comp && comp.ingredient) item.correct.push(comp);
          else if (ex.description) descLines.push(ex.description);
        }
        if (ex.description && !item.correct.length) descLines.push(ex.description);
      } else if (isStrongDishTitle(cell)) {
        pushItem();
        item.name = cleanItemName(cell);
      } else if (isLikelyDishName(cell)) {
        descLines.push(cell);
      } else {
        descLines.push(cell);
      }
      continue;
    }
    // At least 2 cells: name and weight/quantity.
    const name = cells[0];
    const weight = cells.slice(1).join(' ');
    if (headerRe.test(name)) continue;
    const fullLine = (name + ' ' + weight).trim();
    const ex = extractComponents(fullLine);
    if (ex.tokens && ex.tokens.length) {
      for (const t of ex.tokens) {
        const comp = parseComponentToken(t);
        if (comp && comp.ingredient) item.correct.push(comp);
      }
    } else {
      const comp = parseComponentToken(fullLine);
      if (comp && comp.ingredient) item.correct.push(comp);
      else if (name) item.correct.push({ ingredient: cleanItemName(name), grams: 0, isCount: false });
    }
    if (ex.description && !item.correct.length) descLines.push(ex.description);
  }

  pushItem();
  return items.length ? items : [];
}

function parseTTKOCRText(text) {
  if (!text || !text.trim()) return [];
  const normalized = normalizeOCRText(text);
  if (normalized.indexOf('\t') !== -1) {
    const tableItems = parseTTKTableText(normalized);
    if (tableItems && tableItems.length) return tableItems;
  }

  let blocks = normalized.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);

  if (blocks.length === 1 && blocks[0].split('\n').length >= 2) {
    const lines = blocks[0].split('\n').map(l => l.trim()).filter(Boolean);
    const split = maybeSplitBlocks(lines);
    if (split.length > 1) blocks = split;
  } else if (blocks.length > 1) {
    blocks = mergeHeadingBlocks(blocks);
  }
  blocks = mergeContinuationBlocks(blocks);
  blocks = mergeDescriptionBlocks(blocks);

  const items = postProcessParsedItems(processTTKBlocks(blocks));
  return items.length ? items : parseTTKPlainText(text);
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
    if (lines.length === 1) {
      const cleaned = cleanItemName(lines[0]);
      const isDishTitle = isLikelyDishName(cleaned) && (hasStrongDishWord(cleaned) || !isLikelyIngredientName(cleaned) || isLabelPrefixedDishName(lines[0]) || /^[A-ZА-ЯЁ][A-ZА-ЯЁ\s\d-]*:$/.test(lines[0]));
      const isOldHeading = /[:\-|–—]$/.test(lines[0]) && !/^[-•–—*‣⁃◦\d[\]()]+/.test(lines[0]);
      if ((isDishTitle || isOldHeading) && i + 1 < blocks.length) {
        const nextLines = blocks[i + 1].split('\n').map(l => l.trim()).filter(Boolean);
        if (nextLines.length && !isDescriptionHeader(nextLines[0])) {
          merged.push(block + '\n' + blocks[i + 1]);
          skipNext = true;
          continue;
        }
      }
    }
    merged.push(block);
  }
  return merged;
}

function isLikelyComponent(line) {
  let s = (line || '').trim();
  if (!s) return false;
  const stripped = s.replace(/\([^)]*\)/g, ' ').replace(/\[.*?\]/g, ' ');
  if (/^[-•–—*‣⁃◦.)\]()]/.test(s)) return true;
  if (/п\/ф|пф/i.test(s)) return true;
  const units = ['г', 'гр', 'грамм', 'грам', 'мл', 'миллилитров', 'шт', 'штук', 'штуки', 'л', 'кг', 'кгр', 'мг', 'g', 'gr', 'gram', 'grams', 'ml', 'pcs', 'pc'];
  const unitRe = new RegExp('\\d+(?:[.,]\\d+)?\\s*(?:' + units.join('|') + ')(?:\\s|$|[.,;])', 'i');
  if (unitRe.test(stripped)) return true;
  const pctMatch = s.match(/^(.*?)\s*[\s(]*(\d+(?:[.,]\d+)?)\s*%[\s)]*/);
  if (pctMatch && isLikelyIngredientName(cleanItemName(pctMatch[1].replace(/[\s(]+$/, '')))) return true;
  // count-only ingredient lines like "Соль 1" or "Сахар 10"
  const noUnitMatch = s.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s*[.)]*$/);
  if (noUnitMatch && isLikelyIngredientName(noUnitMatch[1])) return true;
  // measure-word ingredient lines like "Соль 1 щепотка" or "Авокадо 1/2 шт"
  const measureWords = 'щепотка|щепотки|ложка|ложки|ложечка|чайная|столовая|стакан|чашка|горсть|горсти|пучок|пучки|зубчик|зубчика|стручок|стручка|капля|капли|кусочек|кусочка|ломтик|ломтика|пластинка|пластинки|долька|дольки|половинка|половинки|четвертинка|четвертинки|пучочек|горошина|горошины|кружка|банка|пакет|пакетик';
  const measureRe = new RegExp('^(.*?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(' + measureWords + ')(?![a-zA-Zа-яёЁ0-9])', 'i');
  const measureMatch = s.match(measureRe);
  if (measureMatch && isLikelyIngredientName(cleanItemName(measureMatch[1]))) return true;
  // bare measure lines like "1 щепотка" (OCR lost the ingredient name)
  const measureOnlyRe = new RegExp('^\\d+(?:[.,]\\d+)?\\s*(' + measureWords + ')\\s*$', 'i');
  if (measureOnlyRe.test(s)) return true;
  // ingredient lines like "Банан: половинка" or "Сметана: 30г" (not a dish heading)
  if (/:\s+/.test(s)) {
    const parts = s.split(/:\s+/, 2);
    if (parts[1] && !/:/.test(parts[1]) && !isDescriptionHeader(parts[0]) && !isLikelyDishName(cleanItemName(parts[1])) && isLikelyIngredientName(cleanItemName(parts[0]))) return true;
  }
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
      if (isDescriptionHeader(s)) return false;
      const t = (s || '').trim();
      if (!/[A-ZА-ЯЁ]/.test(t)) return false;
      return /^[A-ZА-ЯЁ\s\d]+$/.test(t) || /^[A-ZА-ЯЁ][A-ZА-ЯЁ\s\d]*:$/.test(t);
    }
    const weightUnitRe = /\d+(?:[.,]\d+)?\s*(?:г|гр|грамм|грам|мл|миллилитров|шт|штук|штуки|л|кг|кгр|мг)(?![a-zA-Zа-яёЁ0-9])/i;
    function blockHasComponent(arr) {
      return arr.some(l => weightUnitRe.test(l));
    }
    current = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const cleaned = cleanItemName(line);
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      const nextIsComponent = nextLine && isLikelyComponent(nextLine);
      const words = cleaned.split(/\s+/).filter(Boolean);
      const isDishHeader = !isLikelyComponent(line) && !isLikelyNote(cleaned) && !isSectionHeading(cleaned) && (isSectionHeader(line) || isLabelPrefixedDishName(line) || (isLikelyDishName(cleaned) && hasStrongDishWord(cleaned)));
      if (isDishHeader) {
        const isSingleIng = isLikelyIngredientName(cleaned) && words.length === 1;
        // split on a likely dish name that is followed by a component line (new dish block)
        if (nextIsComponent) {
          // keep a single ambiguous ingredient word (e.g. "Салат") inside an ongoing ingredient list
          if (isSingleIng && blockHasComponent(current) && !isLabelPrefixedDishName(line)) {
            current.push(line);
            continue;
          }
          blocks.push(current.join('\n'));
          current = [line];
          continue;
        }
        // don't split on an ingredient-looking word when the current block already has real components,
        // unless it is a strong multi-word dish title
        if (isLikelyIngredientName(cleaned) && blockHasComponent(current) && (words.length === 1 || !hasDishWord(cleaned))) {
          current.push(line);
          continue;
        }
        // don't split on an ingredient-looking word that is followed by a description/process header
        if (isLikelyIngredientName(cleaned) && i + 1 < lines.length && isDescriptionHeader(lines[i + 1]) && (words.length === 1 || !hasDishWord(cleaned))) {
          current.push(line);
          continue;
        }
        // otherwise split on a clear dish title
        blocks.push(current.join('\n'));
        current = [line];
      } else {
        current.push(line);
      }
    }
  }

  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}

function isDescriptionHeader(line) {
  const s = (line || '').trim().toLowerCase();
  if (!s) return false;
  if (/^(?:способ|порядок)\s*приготовления\s*[\-–—:\.]?/i.test(line)) return true;
  if (/^(?:приготовление|готовка|технология|процесс|рецепт|инструкция|описание|как\s+готовить|приготовить|готовить|execution|preparation|method|instructions|directions)\s*[\-–—:\.]?/i.test(line)) return true;
  if (/приготовлен(ие|ия|ию)|\sпроцесс\s|\sготовк|\sрецепт\s|\sинструкци/i.test(' ' + s + ' ')) return true;
  return false;
}

function hasInstructionWords(s) {
  const words = (s || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const verbEndings = /(ем|им|ет|ит|ут|ют|ешь|ишь|ете|ите|ать|ять|еть|ить|уть|ыть|овать|евать|авать|ывать|ивать|аться|еться|иться|уться|ыться|оваться|еваться|аваться|ываться|иваться)$/;
  const nonInstructionNouns = new Set(['омлет','паштет','рулет','котлет','медальон','бургер','чизкейк','морс','кисель','компот','смузи','лайм','лимон','бекон','салями','пепперони','салат','суп','борщ','сирт','оладьи','сырники','пельмени','макароны','гречка','рис','каша','мюсли']);
  const prepositions = new Set(['а','б','в','на','по','для','из','к','от','перед','после','при','про','без','до','за','над','под','об','у','и','но','или','чтобы','так','как','если','когда','где','затем','потом','далее','еще','ещё','же','бы','ли']);
  function isVerb(w) {
    const lw = w.toLowerCase();
    if (nonInstructionNouns.has(lw) || nonInstructionNouns.has(lw.replace(/[иы]$/, ''))) return false;
    return verbEndings.test(lw) && lw.length > 3;
  }
  // if the first word is a verb, it's an instruction
  if (isVerb(words[0])) return true;
  // if the line starts with a preposition/conjunction, it is an instruction only if a verb follows
  if (prepositions.has(words[0])) {
    return words.slice(1).some(isVerb);
  }
  // otherwise it's an instruction only if it contains a verb (description/prose)
  return words.some((w, i) => i > 0 && isVerb(w));
}

function isLabelPrefixedDishName(line) {
  const s = (line || '').trim();
  const m = s.match(/^(?:блюдо|название|наименование|позиция|товар|dish|name|title)[\s:—–-]+(.+)$/i);
  if (!m) return false;
  const rest = cleanItemName(m[1]);
  return rest.length >= 2 && !/\d/.test(rest);
}

const COMMON_DISH_WORDS = new Set(['оладьи','оладья','сырники','борщ','суп','солянка','щи','окрошка','бульон','омлет','яичница','гречка','рис','каша','мюсли','бургер','чизкейк','морс','кисель','компот','смузи','сок','лимонад','пельмени','макароны','паштет','рулет','котлет','котлета','биточек','тефтели','медальон','салями','пепперони','бекон','ветчина','колбаса','сервелат','сосиска','сарделька','язык','печень','сердце','пицца','паста','лаваш','шаурма','донер','кебаб','гирос','тако','буррито','кесадилья','плов','курица','индейка','утка','гусь','кролик','свинина','говядина','баранина','телятина','мясо','рыба','семга','лосось','форель','скумбрия','сельдь','тунец','треска','минтай','кета','горбуша','икра','краб','креветки','мидии','кальмар','осьминог','раки','сэндвич','ролл','суши','сашими','гунканы','рамэн','поке','боул','тарт','кремчиз','грильчиз','завтрак','завтраки','обед','ужин','ланч','мортаделла','страчателла','прошутто','блин','блины','блинчики','сыр','хлеб','кекс','пирог','торт','печенье','вафли','вафля','пончик','круассан','пирожное','десерт','шницель','шашлык','люля','фрикадельки','спагетти','феттучини','лазанья','ризотто','жюльен','крем','соус','пюре','жаркое','гуляш','салат','закуска','гарнир','напиток','коктейль','чай','кофе','сироп','варенье','мёд','мед','зефир','пастила','мармелад','конфета','шоколад']);
const DISH_PREPOSITIONS = new Set(['а','б','в','на','по','для','из','к','от','перед','после','при','про','без','до','за','над','под','об','у','и','но','или','чтобы','так','как','если','когда','где','затем','потом','далее','еще','ещё','же','бы','ли','со','во','с','о']);

function hasDishWord(s) {
  return (s || '').split(/\s+/).filter(Boolean).some(w => COMMON_DISH_WORDS.has(w.toLowerCase()));
}

const GENERIC_FOOD_WORDS = new Set(['сок','морс','компот','кисель','лимонад','чай','кофе','какао','вода','молоко','сливки','сметана','йогурт','кефир','творог','сыр','масло','сахар','соль','перец','мука','мёд','мед','яйцо','яйца','лимон','лайм','апельсин','яблоко','банан','груша','виноград','клубника','малина','черника','голубика','облепиха','вишня','черри','томат','огурец','перец','лук','чеснок','морковь','свекла','капуста','картофель','тыква','кабачок','баклажан','грибы','шампиньоны']);

function hasStrongDishWord(s) {
  return (s || '').split(/\s+/).filter(Boolean).some(w => COMMON_DISH_WORDS.has(w.toLowerCase()) && !GENERIC_FOOD_WORDS.has(w.toLowerCase()));
}

function isLikelyDishName(line) {
  const s = cleanItemName(line || '');
  if (!s || s.length < 2 || s.length > 80) return false;
  if (isSectionHeading(s)) return false;
  if (isDescriptionHeader(s)) return false;
  if (/[,;!:?().]/.test(s)) return false;
  if (isLikelyNote(s)) return false;
  if (/\d/.test(s)) return false;
  if (!/[аеёиоуыэюя]/i.test(s)) return false;
  const first = s.charAt(0);
  if (!/[A-ZА-ЯЁ]/.test(first) && s !== s.toUpperCase()) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  // reject noise like "ЕООД ых": a long all-caps word mixed with lowercase
  if (words.some(w => w.length > 3 && w === w.toUpperCase()) && words.some(w => w !== w.toUpperCase())) return false;
  // single-word titles must be known dish words
  if (words.length === 1) return COMMON_DISH_WORDS.has(words[0].toLowerCase());
  // multi-word titles need a known dish word or a preposition (for "Тесто для оладьев")
  return words.some(w => COMMON_DISH_WORDS.has(w.toLowerCase()) || DISH_PREPOSITIONS.has(w.toLowerCase())) && !hasInstructionWords(s);
}

function isLikelyIngredientName(line) {
  const s = cleanItemName(line || '');
  if (!s || s.length < 2 || s.length > 40) return false;
  if (isSectionHeading(s)) return false;
  if (isDescriptionHeader(s)) return false;
  if (/[,;!:?().\d]/.test(s)) return false;
  if (isLikelyNote(s)) return false;
  const first = s.charAt(0);
  if (!/[A-ZА-ЯЁa-zа-яё]/.test(first)) return false;
  if (!/[аеёиоуыэюя]/i.test(s)) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words[0] && ['ингредиент','ингредиенты'].includes(words[0].toLowerCase())) return false;
  if (words[0] && words[0].length < 3 && words[0] === words[0].toLowerCase()) return false;
  if (words.length === 1 && words[0] === words[0].toUpperCase() && words[0].length <= 4 && /[Зз]/.test(words[0])) return false;
  const nonIngredientNouns = new Set(['гриль','гриле','сковород','сковорода','сковороде','тарелка','тарелке','плита','плите','духовка','духовке','микроволновка','нож','вилка','ложка','кастрюля','сотейник','доска','толкушка','венчик','половник','кухня','посуда','огонь','газ','плитка','минута','минут','секунда','час','градус','температура','время','процесс','способ']);
  if (words.some(w => nonIngredientNouns.has(w.toLowerCase()))) return false;
  const nonIngredientRoots = /^(гриль|гриле|сковород|тарелк|плит|духов|микроволнов|нож|вилк|ложк|кастрюл|сотейник|дос(?!пех)|толкушк|венчик|половник|кухн|посуд|огон|газ|минут|секунд|час|градус|температур|врем|процесс|способ)/i;
  if (words.some(w => nonIngredientRoots.test(w))) return false;
  const prepositions = new Set(['а','б','в','на','по','для','из','к','от','перед','после','при','про','без','до','за','над','под','об','у','и','но','или','чтобы','так','как','если','когда','где','затем','потом','далее','еще','ещё','же','бы','ли','со','во']);
  if (words.slice(1).some(w => prepositions.has(w.toLowerCase()))) return false;
  if (words.length === 1 && isAdjectiveOnly(words[0])) return false;
  return !hasInstructionWords(s);
}

function isLikelyNote(s) {
  if (!s) return false;
  const words = s.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const startNoteWords = new Set(['сверху','снизу','внутрь','внутри','вне','для','по','как','фото','рисунок','пример','примерно']);
  const anyNoteWords = new Set(['украшение','украсить','посыпать','присыпать','разрезать','запечь','половина','треть','четверть','ломтик','кусочек','щепотка','сверху','снизу']);
  if (startNoteWords.has(words[0])) return true;
  if (words.some(w => anyNoteWords.has(w))) return true;
  return hasInstructionWords(s);
}

function isContinuationNote(s) {
  if (!s) return false;
  const words = (s || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const startNoteWords = new Set(['сверху','снизу','внутрь','внутри','вне','для','по','как','фото','рисунок','пример','примерно']);
  const anyNoteWords = new Set(['украшение','украсить','посыпать','присыпать','разрезать','запечь','половина','треть','четверть','ломтик','кусочек','щепотка','сверху','снизу']);
  if (startNoteWords.has(words[0])) return true;
  if (words.some(w => anyNoteWords.has(w))) return true;
  return false;
}

function isAdjectiveOnly(word) {
  const s = (word || '').toLowerCase();
  return /(ский|ской|ская|ское|ские|ный|ная|ное|ные|вой|вый|вая|вое|вые|чный|чная|чное|чные|кой|кий|кая|кое|кие|ой|ая|ое|ые|ий|яя|ее|ие|ым|им|ом|ем)$/i.test(s) && !/(ник|ик|ок|ек|чик|щик|ец|ор|ер)$/i.test(s);
}

function splitDishNames(line) {
  const cleaned = cleanItemName(line);
  if (!cleaned) return [];
  const words = cleaned.split(/\s+/).filter(Boolean);
  const names = [];
  let start = 0;
  for (let i = 1; i <= words.length; i++) {
    if (i === words.length) {
      const candidate = words.slice(start).join(' ');
      if (isLikelyDishName(candidate)) names.push(candidate);
      break;
    }
    const left = words.slice(start, i).join(' ');
    const right = words.slice(i).join(' ');
    if (isLikelyDishName(left) && isLikelyDishName(right)) {
      const rightWords = right.split(/\s+/).filter(Boolean);
      if (rightWords.length === 1 && isAdjectiveOnly(right)) continue;
      names.push(left);
      start = i;
    }
  }
  return names.length ? names : [cleaned];
}

function parseItemBlock(block) {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  if (isDescriptionHeader(lines[0])) return [];
  const firstCleaned = cleanItemName(lines[0]);
  if (!isLikelyDishName(firstCleaned) && !isLikelyIngredientName(firstCleaned) && !isLabelPrefixedDishName(lines[0])) return [];
  const split = splitNameAndComponents(lines[0]);
  let firstName = split.name;
  let strippedPrefix = false;
  const nameWords = firstName.split(/\s+/).filter(Boolean);
  if (nameWords.length > 1 && nameWords[0] === nameWords[0].toUpperCase() && nameWords[0].length <= 3 && /[Зз]/.test(nameWords[0]) && isLikelyDishName(nameWords.slice(1).join(' '))) {
    firstName = nameWords.slice(1).join(' ');
    strippedPrefix = true;
  }

  const remainingLines = lines.slice(1);
  // collect component lines: skip leading descriptions, then collect contiguous plausible component lines
  const compLines = [];
  let descLines = [];
  let collecting = false;
  let inDescription = false;
  for (const line of remainingLines) {
    if (isDescriptionHeader(line)) {
      descLines.push(line);
      inDescription = true;
      collecting = true;
      continue;
    }
    if (inDescription) {
      descLines.push(line);
      continue;
    }
    if (isLikelyComponent(line) || isLikelyIngredientName(cleanItemName(line))) {
      compLines.push(line);
      collecting = true;
    } else if (collecting && !inDescription && isContinuationNote(line)) {
      // continuation note for the previous ingredient line (e.g. note split across lines)
      compLines[compLines.length - 1] = (compLines[compLines.length - 1] + ' ' + line).trim();
    } else if (collecting) {
      descLines.push(line);
      if (hasInstructionWords(line)) inDescription = true;
    } else {
      descLines.push(line);
    }
  }

  let description = descLines.join('\n').trim();
  let components = split.components;

  if (!components.length && compLines.length) {
    const extracted = compLines.map(line => {
      const ex = extractComponents(line);
      if (ex.tokens && ex.tokens.length) return ex;
      // colon/weightless lines that extractComponents routed to description may still be ingredients
      const comp = parseComponentToken(line);
      if (comp && comp.ingredient) return { tokens: [comp], description: '' };
      return ex;
    }).reduce((acc, ex) => {
      if (ex.tokens && ex.tokens.length) {
        acc.tokens.push(...ex.tokens);
        if (ex.description) acc.description.push(ex.description);
      } else if (ex.description) {
        acc.description.push(ex.description);
      }
      return acc;
    }, { tokens: [], description: [] });
    components = extracted.tokens;
    if (extracted.description.length) {
      description = (description ? description + '\n' : '') + extracted.description.filter(Boolean).join('\n');
    }
  }

  if (!components.length && lines.length === 1) {
    const fallback = splitNameAndComponents(lines[0], true);
    firstName = fallback.name;
    components = fallback.components;
    description = '';
  }

  if (!firstName || !components.length) return [];
  components = components.map(parseComponentToken).filter(Boolean);
  if (!components.length) return [];
  if (strippedPrefix && components.length === 1 && !components[0].ingredient && components[0].grams !== undefined) {
    components[0].ingredient = firstName;
  }

  const names = splitDishNames(firstName);
  const items = [];
  for (const name of names) {
    const item = {
      type: 'composition',
      name,
      correct: components,
      info_text: buildInfoText(name, components),
      description,
    };
    if (!item.description) delete item.description;
    items.push(item);
  }
  return items;
}

function splitNameAndComponents(line, allowNoComponents) {
  const labelRe = /^(?:блюдо|название|наименование|позиция|товар|dish|name|title|menu item)[\s:—–-]*$/i;
  const delimiters = [':', ' - ', ' – ', ' — ', '=>', '|', ';'];
  for (const delim of delimiters) {
    const idx = line.indexOf(delim);
    if (idx > 0) {
      const name = cleanItemName(line.slice(0, idx));
      const rest = line.slice(idx + delim.length);
      if (labelRe.test(name)) {
        const nested = splitNameAndComponents(rest, allowNoComponents);
        if (nested.name || nested.components.length) return nested;
        return { name: cleanItemName(rest), components: [] };
      }
      const extracted = extractComponents(rest);
      if (extracted.tokens.length || allowNoComponents) return { name, components: extracted.tokens };
    }
  }
  return { name: cleanItemName(line), components: [] };
}

function isConcreteIngredientName(s) {
  if (!isLikelyIngredientName(s)) return false;
  const words = (s || '').split(/\s+/).filter(Boolean);
  const markers = new Set(['п/ф','пф','с/с','с/м','с/о']);
  const prepositions = new Set(['а','б','в','на','по','для','из','к','от','перед','после','при','про','без','до','за','над','под','об','у','и','но','или','чтобы','так','как','если','когда','где','затем','потом','далее','еще','ещё','же','бы','ли','со','во','с','о']);
  const nonStandalone = new Set(['лист','листья','крошка','стружка','смесь','салата','филе','кусочек','ломтик','долька','половинка','зубчик','стручок','пучок','пластинка','четвертинка','горошина','щепотка','капля']);
  return words.some(w => {
    const lw = w.toLowerCase();
    if (markers.has(lw) || prepositions.has(lw)) return false;
    if (isAdjectiveOnly(w)) return false;
    if (nonStandalone.has(lw) && words.length === 1) return false;
    return true;
  });
}

function findIngredientInPrefix(prefix) {
  const segments = (prefix || '').split(/[.,;|]\s+/).map(s => s.trim()).filter(Boolean);
  const target = segments.length ? segments[segments.length - 1] : '';
  const beforeSegments = segments.slice(0, -1).join(', ');
  const extras = (beforeSegments ? beforeSegments.split(/[.,;|]\s+/) : [])
    .map(s => cleanItemName(s.trim())).filter(s => isConcreteIngredientName(s));
  const words = cleanItemName(target).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const prepositions = new Set(['в','на','с','по','из','к','от','для','при','про','без','до','за','над','под','об','у','и','но','или','со','во']);
  for (let start = words.length - 1; start >= 0; start--) {
    const suffix = words.slice(start).join(' ');
    if (!isConcreteIngredientName(suffix)) continue;
    const leftover = words.slice(0, start).join(' ');
    if (!leftover) {
      if (!beforeSegments) return { name: suffix, leftover: '', type: 'none' };
      if (hasInstructionWords(beforeSegments) || isLikelyNote(beforeSegments)) return { name: suffix, leftover: beforeSegments, type: hasInstructionWords(beforeSegments) ? 'instruction' : 'note' };
      const full = (beforeSegments + ' ' + suffix).trim();
      if (isConcreteIngredientName(full) && !hasInstructionWords(full) && !isLikelyNote(full)) return { name: full, leftover: '', type: 'none' };
      return { name: suffix, leftover: beforeSegments, type: 'note' };
    }
    if (isLikelyNote(leftover) || hasInstructionWords(leftover)) {
      return { name: suffix, leftover: (beforeSegments ? beforeSegments + ' ' : '') + leftover, type: hasInstructionWords(leftover) ? 'instruction' : 'note' };
    }
    const fullName = (beforeSegments ? beforeSegments + ' ' : '') + (leftover + ' ' + suffix).trim();
    const localName = (leftover + ' ' + suffix).trim();
    const leftoverWords = leftover.split(/\s+/).filter(Boolean);
    if (isConcreteIngredientName(localName) && !hasInstructionWords(localName) && !isLikelyNote(localName) && !hasDishWord(leftover)) {
      if (leftoverWords.length === 1 && isConcreteIngredientName(leftover)) {
        const extra = cleanItemName(leftover);
        const newExtras = (extras || []).slice();
        if (extra) newExtras.push(extra);
        return { name: suffix, extras: newExtras.length ? newExtras : undefined, type: 'none' };
      }
      return { name: localName, extras: extras.length ? extras : undefined, type: 'none' };
    }
    const allModifiers = leftoverWords.every(w => isAdjectiveOnly(w) || prepositions.has(w.toLowerCase()));
    if (allModifiers) {
      return { name: localName, extras: extras.length ? extras : undefined, type: 'none' };
    }
    return { name: suffix, leftover: (beforeSegments ? beforeSegments + ' ' : '') + leftover, type: 'note', extras: extras.length ? extras : undefined };
  }
  return null;
}

function extractComponents(text) {
  if (!text) return { tokens: [], description: '' };
  const units = 'г|гр|грамм|грам|мл|миллилитров|шт|штук|штуки|л|кг|кгр|мг|g|gr|gram|grams|ml|pcs|pc';
  let stripped = text.replace(/\([^)]*\)/g, ' ').replace(/\[.*?\]/g, ' ');
  stripped = stripped.replace(/(\d{1,3}(?:[.,]\d{1,3})?)\s*[/\\]\s*(\d{1,3})(?![\d.,])/g, (m, a, b) => {
    const val = parseFloat(a.replace(',', '.')) / parseFloat(b);
    return val.toFixed(3).replace(/\.?0+$/, '');
  });
  const decimalCommaRe = new RegExp('(\\d),(\\d+)(?=\\s*(?:' + units + '))', 'gi');
  const normalized = stripped.replace(decimalCommaRe, '$1.$2');
  const measureWords = 'щепотка|щепотки|ложка|ложки|ложечка|чайная|столовая|стакан|чашка|горсть|горсти|пучок|пучки|зубчик|зубчика|стручок|стручка|капля|капли|кусочек|кусочка|ломтик|ломтика|пластинка|пластинки|долька|дольки|половинка|половинки|четвертинка|четвертинки|пучочек|горошина|горошины|кружка|банка|пакет|пакетик';
  const measureRe = new RegExp('^\\s*(' + measureWords + ')(?![a-zA-Zа-яёЁ0-9])', 'i');
  const re = new RegExp('(\\d+(?:[.,]\\d+)?)(?:\\s*(' + units + '))?(?![a-zA-Zа-яёЁ])', 'gi');
  const tokens = [];
  const descriptionFrags = [];
  let lastIndex = 0;
  let match;
  while ((match = re.exec(normalized)) !== null) {
    if (match.index < lastIndex) break;
    const rawName = normalized.slice(lastIndex, match.index);
    let grams = parseFloat(match[1].replace(',', '.'));
    let unit = match[2] || '';
    let hasUnit = !!unit;
    let restAfter = normalized.slice(match.index + match[0].length).trim().replace(/[.,;:!?]+$/, '');
    let isEnd = restAfter.length === 0;
    let measure = '';
    if (!hasUnit && !isEnd) {
      const measureMatch = restAfter.match(measureRe);
      if (measureMatch) {
        measure = measureMatch[1];
        hasUnit = true;
        restAfter = restAfter.slice(measureMatch[0].length).trim().replace(/[.,;:!?]+$/, '');
        isEnd = restAfter.length === 0;
        re.lastIndex = match.index + match[0].length + measureMatch[0].length;
      } else {
        re.lastIndex = match.index + match[0].length;
        lastIndex = re.lastIndex;
        continue;
      }
    }
    let isCountUnit = /^(шт|штук|штуки|pcs|pc)$/i.test(unit);
    const parsed = findIngredientInPrefix(rawName);
    if (parsed && parsed.name) {
      if (parsed.extras) for (const ex of parsed.extras) tokens.push({ ingredient: ex, grams: 0, isCount: false });
      let ingredient = parsed.name;
      if (parsed.type === 'note' && parsed.leftover) {
        ingredient += ' (' + parsed.leftover + ')';
      } else if (parsed.type === 'instruction' && parsed.leftover) {
        descriptionFrags.push(parsed.leftover);
      }
      if (measure) {
        ingredient += ' (' + grams + ' ' + measure + ')';
        grams = 0;
        isCountUnit = false;
      }
      tokens.push({ ingredient, grams: isNaN(grams) ? 0 : grams, isCount: isCountUnit });
    } else if (rawName && rawName.trim() && (hasUnit || isEnd)) {
      const cleaned = cleanItemName(rawName);
      const fullInstr = (cleaned + ' ' + match[0]).trim();
      if (cleaned && hasInstructionWords(cleaned)) descriptionFrags.push(fullInstr);
      else if (cleaned && isLikelyNote(cleaned)) descriptionFrags.push(fullInstr);
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < normalized.length) {
    const tail = cleanItemName(normalized.slice(lastIndex));
    if (tail) {
      if (tokens.length && isLikelyNote(tail)) {
        const prev = tokens[tokens.length - 1];
        prev.ingredient = (prev.ingredient ? prev.ingredient + ' ' : '') + '(' + tail + ')';
      } else if (isLikelyIngredientName(tail)) {
        tokens.push({ ingredient: tail, grams: 0, isCount: false });
      } else if (hasInstructionWords(tail) || isLikelyNote(tail)) {
        descriptionFrags.push(tail);
      }
    }
  }
  if (!tokens.length) {
    if (descriptionFrags.length) return { tokens: [], description: descriptionFrags.filter(Boolean).join(' ').trim() };
    const fallback = normalized.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    if (fallback.length) return { tokens: fallback, description: '' };
  }
  const description = descriptionFrags.filter(Boolean).join(' ').trim();
  return { tokens, description };
}

function cleanItemName(str) {
  if (!str) return '';
  let s = str.trim();
  s = s.replace(/^(?:блюдо|название|наименование|позиция|товар|dish|name|title)[\s:—–-]+/i, '').trim();
  s = s.replace(/п\\ф/gi, 'п/ф').trim();
  s = s.replace(/^[-•–—*‣⁃◦\d.,;|)\]/+=!?_`"'‘’‚„“”‹›<>]+\s*/, '').trim();
  s = s.replace(/\s+\d+(?:[.,]\d+)?\s*(?:г|гр|грамм|грам|гр\.|мл|миллилитров|мл\.|шт|штук|штуки|л|кг|кгр|мг|g|gr|gram|grams|ml|pcs|pc)\s*[\).]*$/i, '').trim();
  s = s.replace(/[-.,:;|–—/_+=!?`"'‘’‚„“”‹›<>()]+\s*$/, '').trim();
  s = s.replace(/_/g, ' ').trim();
  s = s.replace(/(?<![A-Za-zА-Яа-яЁё])[Зз][A-ZА-ЯЁ]{1,5}(?![A-Za-zА-Яа-яЁё])/g, '').trim();
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function parseComponentToken(str) {
  if (str && typeof str === 'object') {
    return { ingredient: String(str.ingredient || ''), grams: parseFloat(str.grams) || 0, isCount: !!str.isCount };
  }
  if (!str) return null;
  let s = str.trim();
  s = s.replace(/^(?:[-•–—*‣⁃◦]+|\d+[.)\]])\s*/, '').trim();
  s = s.replace(/[-:;|–—/_+=!?"'‘’‚„“”‹›<>]+$/, '').trim();
  if (!s) return null;

  const units = '(?:г|гр|грамм|грам|мл|миллилитров|шт|штук|штуки|л|кг|кгр|мг|g|gr|gram|grams|ml|pcs|pc)';
  const countUnits = /^(шт|штук|штуки|pcs|pc)$/i;

  // percentage-only notes, e.g. "Сливки 20%" or "Сливки(20%)"
  const pctMatch = s.match(/^(.*?)\s*[\s(]*(\d+(?:[.,]\d+)?)\s*%[\s)]*(.*)$/);
  if (pctMatch) {
    const ingredient = cleanItemName(pctMatch[1].trim());
    const note = cleanItemName(pctMatch[3].trim());
    if (ingredient) {
      const name = note ? ingredient + ' ' + pctMatch[2] + '% (' + note + ')' : ingredient + ' ' + pctMatch[2] + '%';
      return { ingredient: name, grams: 0, isCount: false };
    }
  }

  const orphanMatch = s.match(new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*(' + units + ')\\s*[.)]*$', 'i'));
  if (orphanMatch) {
    const grams = parseFloat(orphanMatch[1].replace(',', '.'));
    const unit = orphanMatch[2] || '';
    const isCount = countUnits.test(unit);
    return { ingredient: '', grams: isNaN(grams) ? 0 : grams, isCount };
  }

  // "Ингредиент: количество" format (OCR screenshots with colons)
  const colonMatch = s.match(/^(.+?):\s*(.+)$/);
  if (colonMatch && !isDescriptionHeader(colonMatch[1])) {
    const ingredientName = cleanItemName(colonMatch[1].trim());
    const rest = colonMatch[2].trim();
    if (ingredientName && !/:/.test(rest)) {
      const weightMatch = rest.match(new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*(' + units + ')?\\s*(.*)$', 'i'));
      if (weightMatch) {
        const grams = parseFloat(weightMatch[1].replace(',', '.'));
        const unit = weightMatch[2] || '';
        const note = cleanItemName(weightMatch[3]);
        const isCount = countUnits.test(unit);
        let name = ingredientName;
        if (note && !/^\d/.test(note)) name += ' (' + note + ')';
        return { ingredient: name, grams: isNaN(grams) ? 0 : grams, isCount };
      }
      return { ingredient: ingredientName + (rest ? ' (' + rest + ')' : ''), grams: 0, isCount: false };
    }
  }

  const trailingMatch = s.match(new RegExp('^(.*?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(' + units + ')\\s*(?:\\([^)]*\\))?\\s*[.)]*$', 'i'));
  if (trailingMatch && trailingMatch[1].trim()) {
    const ingredient = cleanItemName(trailingMatch[1].trim());
    const grams = parseFloat(trailingMatch[2].replace(',', '.'));
    const isCount = countUnits.test(trailingMatch[3]);
    return { ingredient, grams: isNaN(grams) ? 0 : grams, isCount };
  }

  // bare measure lines like "1 щепотка"
  const measureWords2 = 'щепотка|щепотки|ложка|ложки|ложечка|чайная|столовая|стакан|чашка|горсть|горсти|пучок|пучки|зубчик|зубчика|стручок|стручка|капля|капли|кусочек|кусочка|ломтик|ломтика|пластинка|пластинки|долька|дольки|половинка|половинки|четвертинка|четвертинки|пучочек|горошина|горошины|кружка|банка|пакет|пакетик';
  const measureOnlyMatch = s.match(new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*(' + measureWords2 + ')\\s*$', 'i'));
  if (measureOnlyMatch) {
    return { ingredient: measureOnlyMatch[1] + ' ' + measureOnlyMatch[2].toLowerCase(), grams: 0, isCount: false };
  }

  const leadingMatch = s.match(new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*(' + units + ')\\s*[-–—:]\\s*(.+)$', 'i'));
  if (leadingMatch && leadingMatch[3].trim()) {
    const ingredient = cleanItemName(leadingMatch[3].trim());
    const grams = parseFloat(leadingMatch[1].replace(',', '.'));
    const isCount = countUnits.test(leadingMatch[2]);
    return { ingredient, grams: isNaN(grams) ? 0 : grams, isCount };
  }

  const noUnitMatch = s.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s*[.)]*$/);
  if (noUnitMatch && noUnitMatch[1].trim()) {
    const ingredient = cleanItemName(noUnitMatch[1].trim());
    if (ingredient && isLikelyIngredientName(ingredient)) {
      const grams = parseFloat(noUnitMatch[2].replace(',', '.'));
      return { ingredient, grams: isNaN(grams) ? 0 : grams, isCount: false };
    }
  }

  const leftover = cleanItemName(s);
  if (leftover && leftover.length >= 2) {
    return { ingredient: leftover, grams: 0, isCount: false };
  }
  return null;
}

function buildInfoText(name, components, showGrams = true) {
  const list = components.map(c => {
    if (c && typeof c === 'object') {
      if (!showGrams || !c.grams) return c.ingredient || '';
      const val = Number.isInteger(c.grams) ? c.grams : parseFloat(c.grams.toFixed(3));
      const suffix = c.isCount ? ' шт' : 'г';
      if (!c.ingredient) return `(${val}${suffix})`;
      return `${c.ingredient} (${val}${suffix})`;
    }
    return c || '';
  });
  return `Состав:\n• ${list.filter(Boolean).join('\n• ')}`;
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
  const descIdx = findHeaderIndex(headers, ['способ', 'приготовление', 'описание', 'рецепт', 'инструкция', 'description', 'instruction', 'method', 'preparation']);

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

    const item = { type: 'composition', name, correct: components, info_text: buildInfoText(name, components) };
    if (descIdx !== -1 && cols[descIdx]) item.description = cols[descIdx].trim();
    items.push(item);
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
    const idx = headers.findIndex(h => {
      if (h === c) return true;
      const words = h.split(/[^a-zA-Zа-яёЁ0-9]+/);
      return words.includes(c);
    });
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
  const out = {
    type: 'composition',
    name: item.name,
    correct: correct,
    info_text: item.info_text || buildInfoText(item.name, correct),
    image: item.image || null,
  };
  if (item.description) out.description = item.description;
  return out;
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
  state.editorDirty = true;
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

  const normalizedKey = name => name.toLowerCase().replace(/[\s_\-]+/g, '');
  const existingSection = venue.sections && venue.sections.find(s => normalizedKey(s.name) === normalizedKey(sectionName));
  const settingsKey = existingSection ? sectionSettingsKey(existingSection.id) : null;
  const showGrams = getSectionSettings(settingsKey).showGrams !== false;
  const sectionItems = items.map(item => {
    const correct = item.correct || [];
    const hasGrams = correct.some(c => typeof c === 'object' && (c.grams > 0 || c.isCount));
    const correctNames = correct.map(c => typeof c === 'object' ? c.ingredient : c);
    const distractors = shuffle(allComponentsArray.filter(c => !correctNames.includes(c))).slice(0, Math.min(6, Math.max(0, allComponentsArray.length - correctNames.length)));
    if (hasGrams) {
      const out = {
        type: 'composition',
        name: item.name,
        correct: correct,
        wrong: distractors,
        info_text: buildInfoText(item.name, correct, showGrams),
        image: item.image || null,
      };
      if (item.description) out.description = item.description;
      return out;
    } else {
      const pool = shuffle([...correctNames, ...distractors]);
      const out = {
        type: 'composition',
        name: item.name,
        correct: correctNames,
        pool: pool,
        info_text: buildInfoText(item.name, correctNames, showGrams),
        image: item.image || null,
      };
      if (item.description) out.description = item.description;
      return out;
    }
  });

  venue.sections = venue.sections || [];
  const existing = venue.sections.find(s => normalizedKey(s.name) === normalizedKey(sectionName));
  const section = existing || { id: generateId(), name: sectionName, items: [], createdAt: Date.now() };
  section.name = sectionName;
  section.items = sectionItems;
  section.createdAt = Date.now();
  if (!existing) venue.sections.push(section);
  // merge any accidental duplicate sections with the same normalized name, keeping the newest
  const bestByKey = new Map();
  for (const s of venue.sections) {
    const k = normalizedKey(s.name);
    if (!bestByKey.has(k) || (s.createdAt || 0) > (bestByKey.get(k).createdAt || 0)) {
      bestByKey.set(k, s);
    }
  }
  venue.sections = [...bestByKey.values()];

  state.platformDraft = null;
  saveProgress({ venue: venue });
  syncVenue();
  window.renderHome = renderOwnerHome;
  replaceScreen('home');
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
