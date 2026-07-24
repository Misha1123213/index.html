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
  state.mistakeIds = [];
  state.basicMistakeIds = [];
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
    <div class="platform-screen landing-layout">
      <div class="landing-hero">
        <div class="brand">Cognitio</div>
        <h1>Знания, которые создают качество сервиса</h1>
        <p>Обучайте сотрудников меню заведения за 10 минут в день. ТТК, тесты, прогресс.</p>
        <div class="landing-cta">
          <button class="onboarding-btn" style="flex:1;max-width:220px;" onclick="goToScreen('roleSelect', true)">Начать бесплатно</button>
          <button class="stats-btn" style="flex:1;max-width:220px;" onclick="goToScreen('roleSelect', true)">Смотреть демо</button>
        </div>
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
          <div class="platform-title">Cognitio</div>
          <div class="platform-subtitle">Войдите или зарегистрируйтесь</div>
          <button class="onboarding-btn" style="width:100%;margin-bottom:10px;" onclick="goToScreen('login', true)">Войти</button>
          <button class="stats-btn" style="width:100%;margin-bottom:16px;" onclick="goToScreen('roleSelect', true)">Регистрация</button>
          <button class="onboarding-btn" style="width:100%;margin-top:4px;" onclick="goToScreen('roleSelect', true)">Продолжить с Email</button>
          <div class="auth-privacy">Нажимая кнопку, вы соглашаетесь с политикой конфиденциальности</div>
          <button class="link-btn" style="margin-top:16px;" onclick="goToScreen('forgotPassword', { login: '' })">Забыли пароль?</button>
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
      <button class="stats-btn" style="${cementStyle()}" onclick="showOwnerStats()">Статистика</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="goToScreen('ownerSetup')">Загрузить ТТК</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="openVenueImages()">Фото заведения</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="exportVenueFile()">Экспортировать заведение</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="document.getElementById('venue-import-file').click()">Импортировать бэкап</button>
      <input type="file" id="venue-import-file" style="display:none" accept=".json,application/json" onchange="importVenueBackup(this.files[0])">
      <button class="stats-btn" style="${cementStyle()}" onclick="goLeaderboard()">Рейтинг</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="logoutPlatform()">Выйти из аккаунта</button>
    </div>
  `;
}

function sectionSettingsKey(sectionId) {
  return 'venue_' + sectionId;
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
      ${!isOwner && hasSections ? `<button class="stats-btn" style="${cementStyle()}" onclick="startMixedPractice()">Случайный тест</button>` : ''}
      <button class="stats-btn" style="${cementStyle()}" onclick="goLeaderboard()">Рейтинг</button>
      ${!isOwner ? `<button class="stats-btn" style="${cementStyle()}" onclick="showAchievements()">Достижения ${renderAchievementBadge()}</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="showStaffStats()">Моя статистика</button>
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
  state.editorDirty = true;
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
