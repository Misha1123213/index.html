// ====================== PLATFORM LAYER ======================
// Client-side owner / staff flow, TTK upload, course generation.
// No backend required: everything is stored in localStorage.

const VENUE_STYLES = [
  { id: 'modern', label: 'Современный', theme: 'dark', accent: '#58CC02' },
  { id: 'classic', label: 'Классический', theme: 'light', accent: '#8B5E3C' },
  { id: 'rustic', label: 'Лофт / Рустик', theme: 'dark', accent: '#FF9600' },
  { id: 'minimal', label: 'Минимализм', theme: 'light', accent: '#1CB0F6' },
  { id: 'neon', label: 'Неон', theme: 'dark', accent: '#CE82FF' },
];

function generateVenueCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateId() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function applyVenueStyle(styleId) {
  const style = VENUE_STYLES.find(s => s.id === styleId) || VENUE_STYLES[0];
  document.documentElement.style.setProperty('--venue-accent', style.accent);
  document.body.classList.remove('style-modern', 'style-classic', 'style-rustic', 'style-minimal', 'style-neon');
  document.body.classList.add('style-' + style.id);
  if (style.theme) {
    updateSetting('theme', style.theme);
    applyTheme(style.theme);
  }
}

function isPlatformScreen() {
  return ['roleSelect', 'ownerRegister', 'ownerSetup', 'ownerDashboard', 'staffRegister', 'staffJoin'].includes(state.screen);
}

function initPlatform() {
  const p = getProgress();
  state.auth = p.auth || null;
  state.venue = p.venue || null;
  state.staff = p.staff || null;

  if (state.auth && state.venue && state.venue.style) {
    applyVenueStyle(state.venue.style);
  }

  if (state.auth) {
    loadVenueIntoState();
    window.renderHome = renderPlatformHome;
    if (state.auth.role === 'owner') {
      state.screen = (state.venue && state.venue.items && state.venue.items.length) ? 'home' : 'ownerSetup';
    } else {
      state.screen = (state.venue && state.venue.items && state.venue.items.length) ? 'home' : 'staffJoin';
    }
  } else if (p.profile) {
    state.screen = 'home';
  } else {
    state.screen = 'roleSelect';
  }

  applyTheme(getSettings().theme);
  applyAnimationPref();
  checkAchievements();
  render();
  loadAvatarConfig().then(() => {
    if (!isPlatformScreen()) render();
  });
}

function loadVenueIntoState() {
  const venue = state.venue;
  if (!venue || !venue.items || !venue.items.length) return;
  state.allData = venue.items.map(normalizeItem);
  buildLessons();
  state.section = 'venue_progress';
  state.sectionLabel = venue.name || 'Меню заведения';
  state.isDrinksChapter = venue.items.some(it => it._hasGrams);
}

function selectRole(role) {
  state.platformDraft = { role };
  state.screen = role === 'owner' ? 'ownerRegister' : 'staffRegister';
  render();
}

function backToRoleSelect() {
  state.platformDraft = null;
  state.screen = 'roleSelect';
  render();
}

function updatePlatformDraft(key, value) {
  state.platformDraft = state.platformDraft || {};
  state.platformDraft[key] = value;
  render();
}

function selectVenueStyle(styleId) {
  updatePlatformDraft('style', styleId);
  applyVenueStyle(styleId);
}

function registerOwner() {
  const draft = state.platformDraft || {};
  const name = (draft.name || '').trim();
  const venueName = (draft.venueName || '').trim();
  const style = draft.style || 'modern';
  if (!name || !venueName) return;

  const code = generateVenueCode();
  const venue = {
    id: generateId(),
    name: venueName,
    style: style,
    code: code,
    items: [],
    staff: [],
    createdAt: Date.now(),
  };

  const auth = { role: 'owner', name: name, venueId: venue.id, code: code };
  state.profile = { nickname: name, avatar: cloneAvatar() };
  state.auth = auth;
  state.venue = venue;
  state.platformDraft = null;

  saveProgress({ auth: auth, venue: venue, profile: state.profile });
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

function joinStaffVenue() {
  const draft = state.platformDraft || {};
  const code = (draft.code || '').trim();
  const name = (draft.name || '').trim();
  if (!code || !name) return;

  // In localStorage mode, the venue is searched in the same storage.
  const p = getProgress();
  const venue = p.venue;
  if (!venue || venue.code !== code) {
    showPlatformToast('Код не найден на этом устройстве. Владелец и сотрудник должны использовать один браузер (до появления сервера).');
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
  applyVenueStyle(venue.style);
  loadVenueIntoState();
  window.renderHome = renderPlatformHome;
  state.screen = 'home';
  render();
  playSound('correct');
}

function startVenueCourse() {
  if (!state.venue || !state.venue.items.length) return;
  loadVenueIntoState();
  state.screen = 'path';
  render();
}

function logoutPlatform() {
  saveProgress({ auth: null, staff: null, profile: null });
  state.auth = null;
  state.staff = null;
  state.profile = null;
  state.screen = 'roleSelect';
  render();
}

function ownerDashboard() {
  state.screen = 'ownerDashboard';
  render();
}

function ownerBackToHome() {
  state.screen = 'home';
  render();
}

// ====================== RENDERERS ======================

function renderRoleSelect() {
  app.innerHTML = `
    <div class="platform-screen role-select">
      <div class="platform-mascot">☕</div>
      <div class="platform-title">MET Академия</div>
      <div class="platform-subtitle">Платформа для изучения составов блюд и напитков</div>
      <div class="role-cards">
        <button class="role-card" onclick="selectRole('owner')">
          <div class="role-icon">🏪</div>
          <div class="role-label">Я владелец</div>
          <div class="role-desc">Создам заведение, загружу ТТК и приглашу сотрудников</div>
        </button>
        <button class="role-card" onclick="selectRole('staff')">
          <div class="role-icon">👨‍🍳</div>
          <div class="role-label">Я сотрудник</div>
          <div class="role-desc">У меня есть код от владельца</div>
        </button>
      </div>
    </div>
  `;
}

function renderOwnerRegister() {
  const draft = state.platformDraft || {};
  const name = draft.name || '';
  const venueName = draft.venueName || '';
  const style = draft.style || 'modern';
  const valid = name.trim() && venueName.trim();
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="backToRoleSelect()">← Назад</button>
      </div>
      <div class="platform-title">🏪 Создать заведение</div>
      <div class="platform-form">
        <label class="platform-label">Ваше имя</label>
        <input class="platform-input" type="text" id="owner-name" value="${name}" placeholder="Иван" maxlength="30" oninput="updatePlatformDraft('name', this.value)">
        <label class="platform-label">Название заведения</label>
        <input class="platform-input" type="text" id="venue-name" value="${venueName}" placeholder="Кофейня 'Зерно'" maxlength="40" oninput="updatePlatformDraft('venueName', this.value)">
        <label class="platform-label">Стиль заведения</label>
        <div class="style-grid">
          ${VENUE_STYLES.map(s => `
            <button class="style-card ${style === s.id ? 'selected' : ''}" onclick="selectVenueStyle('${s.id}')">
              <div class="style-dot" style="background:${s.accent}"></div>
              <div class="style-label">${s.label}</div>
            </button>
          `).join('')}
        </div>
        <button class="onboarding-btn ${valid ? '' : 'disabled'}" onclick="registerOwner()">Создать заведение</button>
      </div>
    </div>
  `;
}

function renderOwnerSetup() {
  const venue = state.venue;
  const draft = state.platformDraft || {};
  const parsedCount = draft.parsedItems ? draft.parsedItems.length : 0;
  app.innerHTML = `
    <div class="platform-screen">
      <div class="platform-header">
        <button class="close-btn" onclick="logoutPlatform()">← Выйти</button>
      </div>
      <div class="platform-title">🍽️ ${venue.name}</div>
      <div class="platform-subtitle">Код для сотрудников: <span class="venue-code">${venue.code}</span></div>
      <div class="platform-form">
        <label class="platform-label">Загрузите ТТК заведения</label>
        <div class="upload-zone" onclick="document.getElementById('ttk-file').click()">
          <div class="upload-icon">📄</div>
          <div class="upload-text">Нажмите, чтобы выбрать файл</div>
          <div class="upload-hint">.txt, .md, .csv, .json, .docx</div>
        </div>
        <input type="file" id="ttk-file" style="display:none" accept=".txt,.md,.csv,.json,.docx" onchange="handleTTKFile(this.files[0])">

        <label class="platform-label">Или вставьте текст вручную</label>
        <textarea class="platform-textarea" id="ttk-paste" rows="6" placeholder="Блюдо: ингредиент 1, ингредиент 2\n\nНапиток:\n- компонент 10г\n- компонент 20г"></textarea>

        <div class="upload-actions">
          <button class="onboarding-btn secondary" onclick="parseTTKPaste()">Распознать текст</button>
          <button class="onboarding-btn ${parsedCount ? '' : 'disabled'}" onclick="saveVenueCourse()">Сохранить курс (${parsedCount})</button>
        </div>

        ${parsedCount ? `<div class="parsed-preview">Распознано позиций: <strong>${parsedCount}</strong></div>` : ''}

        <div class="demo-hint">Нет файла? <button class="link-btn" onclick="loadDemoVenue()">Загрузить демо-меню</button></div>
      </div>
    </div>
  `;
}

function renderOwnerDashboard() {
  const venue = state.venue;
  const itemCount = venue.items ? venue.items.length : 0;
  const staffCount = venue.staff ? venue.staff.length : 0;
  const hasItems = itemCount > 0;
  app.innerHTML = `
    <div class="top-bar">
      <button class="close-btn" onclick="ownerBackToHome()">← Назад</button>
      <div class="path-title">${venue.name}</div>
      <button class="settings-btn" onclick="logoutPlatform()" aria-label="Выйти">🚪</button>
    </div>
    <div class="platform-dashboard">
      <div class="dashboard-card">
        <div class="dashboard-label">Код для сотрудников</div>
        <div class="venue-code">${venue.code}</div>
        <div class="dashboard-hint">Сотрудник вводит этот код при регистрации</div>
      </div>
      <div class="dashboard-grid">
        <div class="dashboard-stat">
          <div class="dashboard-stat-value">${itemCount}</div>
          <div class="dashboard-stat-label">Позиций в меню</div>
        </div>
        <div class="dashboard-stat">
          <div class="dashboard-stat-value">${staffCount}</div>
          <div class="dashboard-stat-label">Сотрудников</div>
        </div>
      </div>
      <button class="stats-btn" style="${cementStyle()}" onclick="startVenueCourse()" ${hasItems ? '' : 'disabled'}>📚 Изучить курс</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="state.screen='ownerSetup'; render()">🔄 Загрузить ТТК заново</button>
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
      <div class="platform-title">👨‍🍳 Регистрация сотрудника</div>
      <div class="platform-form">
        <label class="platform-label">Ваше имя</label>
        <input class="platform-input" type="text" id="staff-name" value="${name}" placeholder="Анна" maxlength="30" oninput="updatePlatformDraft('name', this.value)">
        <button class="onboarding-btn ${name.trim() ? '' : 'disabled'}" onclick="registerStaff()">Далее</button>
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
      <div class="platform-title">🔑 Код заведения</div>
      <div class="platform-subtitle">Введите 6-значный код, который вам дал владелец</div>
      <div class="platform-form">
        <input class="platform-input code-input" type="text" id="venue-code" value="${code}" placeholder="123456" maxlength="6" oninput="updatePlatformDraft('code', this.value)">
        <button class="onboarding-btn ${code.trim().length === 6 ? '' : 'disabled'}" onclick="joinStaffVenue()">Присоединиться</button>
      </div>
    </div>
  `;
}

function renderPlatformHome() {
  const stats = getGlobalStats();
  const venue = state.venue;
  const isOwner = state.auth && state.auth.role === 'owner';
  const hasItems = venue && venue.items && venue.items.length;
  const itemCount = hasItems ? venue.items.length : 0;

  app.innerHTML = `
    <div class="top-bar">
      <button class="profile-chip" onclick="openAvatarEditor()">
        ${renderAvatar(state.profile && state.profile.avatar, 32)}
        <span>${state.profile && state.profile.nickname || 'Ты'}</span>
      </button>
      <div style="flex:1"></div>
      <div class="top-bar-stat">
        <span class="icon">🔥</span>
        <span class="streak-count">${stats.streak}</span>
      </div>
      <div class="top-bar-stat">
        <span class="icon">⚡</span>
        <span class="xp-count">${stats.totalXP} XP</span>
      </div>
      <button class="settings-btn" onclick="showSettings()" aria-label="Настройки">⚙️</button>
    </div>
    <div class="home-screen">
      <div class="mascot-area">
        <span class="mascot">${state.auth && state.auth.role === 'owner' ? '🏪' : '👨‍🍳'}</span>
        <div class="app-title">${venue ? venue.name : 'MET Академия'}</div>
        <div class="app-subtitle">${venue ? 'Изучай меню своего заведения' : 'Платформа обучения'}</div>
      </div>
      ${renderDailyGoalCard()}
      <div class="daily-stats">
        <div class="daily-stat-card" style="${cementStyle()}">
          <div class="stat-value streak-count">🔥 ${stats.streak}</div>
          <div class="stat-label">Серия дней</div>
        </div>
        <div class="daily-stat-card" style="${cementStyle()}">
          <div class="stat-value xp-count">⚡ ${stats.totalXP}</div>
          <div class="stat-label">Всего XP</div>
        </div>
        <div class="daily-stat-card" style="${cementStyle()}">
          <div class="stat-value" style="color:var(--green)">📚 ${stats.totalLessons}</div>
          <div class="stat-label">Уроков</div>
        </div>
      </div>
      <button class="stats-btn" style="${cementStyle()}" onclick="showLearningStats()">📊 Характеристика обучения</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="goLeaderboard()">🏆 Рейтинг</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="showAchievements()">🏅 Достижения ${renderAchievementBadge()}</button>
      <button class="section-card" style="${cementStyle()}" onclick="startVenueCourse()" ${hasItems ? '' : 'disabled'}>
        <div class="card-img-wrap">
          <div class="card-img-placeholder">${venue ? getVenueEmoji(venue.style) : '🍽️'}</div>
        </div>
        <div class="card-info">
          ${venue ? venue.name : 'Курс заведения'}
          <small>${hasItems ? `${itemCount} позиций • ${Math.ceil(itemCount / 8)} уроков` : 'Сначала загрузите ТТК'}</small>
        </div>
        <div class="card-arrow">›</div>
      </button>
      ${isOwner ? `<button class="section-card" style="${cementStyle()}" onclick="ownerDashboard()">
        <div class="card-img-wrap"><div class="card-img-placeholder">🏪</div></div>
        <div class="card-info">
          Управление заведением
          <small>Код, сотрудники, загрузка ТТК</small>
        </div>
        <div class="card-arrow">›</div>
      </button>` : ''}
      <button class="stats-btn" style="${cementStyle()}" onclick="logoutPlatform()">🚪 Выйти из аккаунта</button>
    </div>
  `;
}

function getVenueEmoji(style) {
  const map = { modern: '☕', classic: '🍷', rustic: '🍺', minimal: '🥛', neon: '🍸' };
  return map[style] || '🍽️';
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
    setParsedItems(items, file.name);
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
    mammoth.extractRawText({ arrayBuffer }).then(result => {
      const items = parseTTKText(result.value, 'txt');
      setParsedItems(items, file.name);
    }).catch(() => showPlatformToast('Не удалось извлечь текст из .docx'));
  });
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
      return parsed.map(normalizeParsedItem).filter(Boolean);
    } catch (e) {
      return [];
    }
  }
  if (format === 'csv') {
    return parseTTKCSV(text);
  }
  return parseTTKPlainText(text);
}

function parseTTKPaste() {
  const textarea = document.getElementById('ttk-paste');
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text) return;
  const items = parseTTKPlainText(text);
  setParsedItems(items, 'вставленный текст');
}

function parseTTKPlainText(text) {
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const items = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let name = lines[0];
    let components = [];
    if (name.includes(':')) {
      const [n, rest] = name.split(':', 2);
      name = n.trim();
      components = splitComponents(rest);
      if (!components.length) components = lines.slice(1).flatMap(splitComponents);
    } else if (name.includes(' - ')) {
      const [n, rest] = name.split(' - ', 2);
      name = n.trim();
      components = splitComponents(rest);
      if (!components.length) components = lines.slice(1).flatMap(splitComponents);
    } else {
      components = lines.slice(1).flatMap(splitComponents);
    }
    name = cleanName(name);
    components = components.map(cleanName).filter(Boolean);
    if (!name || components.length === 0) continue;
    items.push({ type: 'composition', name, correct: components, info_text: `💡 Точный состав по ТТК:\n• ${components.join('\n• ')}` });
  }
  return items;
}

function splitComponents(line) {
  return line.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
}

function cleanName(str) {
  return str.replace(/^[-•–—*•‣⁃◦\d.\s]+/, '').trim();
}

function parseTTKCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('название') || h.includes('блюдо') || h.includes('напиток'));
  const compIdx = headers.findIndex(h => h.includes('component') || h.includes('ingredient') || h.includes('ingr') || h.includes('состав') || h.includes('ингредиент'));
  const gramsIdx = headers.findIndex(h => h.includes('gram') || h.includes('гр') || h.includes('грам'));
  if (nameIdx === -1 || compIdx === -1) return [];

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const name = cleanName(cols[nameIdx] || '');
    const rawComponents = (cols[compIdx] || '').split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    if (!name || rawComponents.length === 0) continue;

    const grams = {};
    const hasGrams = gramsIdx !== -1 && cols[gramsIdx];
    let components = [];
    if (hasGrams) {
      const rawGrams = (cols[gramsIdx] || '').split(/[,;|]/).map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      components = rawComponents.map((c, idx) => {
        const g = rawGrams[idx];
        const componentName = cleanName(c);
        if (g !== undefined && !isNaN(g)) {
          grams[componentName] = g;
        }
        return componentName;
      });
    } else {
      components = rawComponents.map(cleanName).filter(Boolean);
    }
    if (!components.length) continue;
    const item = {
      type: 'composition',
      name,
      correct: hasGrams ? components.map(c => ({ ingredient: c, grams: grams[c] || 0 })) : components,
      info_text: `💡 Точный состав по ТТК:\n• ${components.map(c => hasGrams && grams[c] ? `${c} (${grams[c]}г)` : c).join('\n• ')}`,
    };
    if (hasGrams) item._grams = grams;
    items.push(item);
  }
  return items;
}

function parseCSVLine(line) {
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
    } else if (c === ',' && !inQuotes) {
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
  const correct = Array.isArray(item.correct) ? item.correct : (Array.isArray(item.components) ? item.components : []);
  if (!correct.length) return null;
  const hasGrams = correct[0] && typeof correct[0] === 'object';
  return {
    type: 'composition',
    name: item.name,
    correct: correct,
    info_text: item.info_text || `💡 Точный состав по ТТК:\n• ${correct.map(c => typeof c === 'object' ? c.ingredient : c).join('\n• ')}`,
    image: item.image || null,
  };
}

function setParsedItems(items, sourceName) {
  state.platformDraft = state.platformDraft || {};
  state.platformDraft.parsedItems = items;
  state.platformDraft.fileName = sourceName;
  if (items.length) {
    showPlatformToast(`Распознано ${items.length} позиций`);
  } else {
    showPlatformToast('Не удалось распознать структуру. Проверьте формат.');
  }
  render();
}

function saveVenueCourse() {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items.length) return;

  const venue = state.venue;
  const allComponents = new Set();
  items.forEach(it => {
    it.correct.forEach(c => {
      allComponents.add(typeof c === 'object' ? c.ingredient : c);
    });
  });
  const allComponentsArray = [...allComponents];

  venue.items = items.map(item => {
    const hasGrams = item.correct[0] && typeof item.correct[0] === 'object';
    const correctNames = item.correct.map(c => typeof c === 'object' ? c.ingredient : c);
    const distractors = shuffle(allComponentsArray.filter(c => !correctNames.includes(c))).slice(0, Math.min(6, allComponentsArray.length - correctNames.length));
    if (hasGrams) {
      return {
        type: 'composition',
        name: item.name,
        correct: item.correct,
        wrong: distractors,
        info_text: item.info_text,
        image: item.image || null,
      };
    } else {
      const pool = shuffle([...correctNames, ...distractors]);
      return {
        type: 'composition',
        name: item.name,
        correct: correctNames,
        pool: pool,
        info_text: item.info_text,
        image: item.image || null,
      };
    }
  });

  state.platformDraft = null;
  saveProgress({ venue: venue });
  loadVenueIntoState();
  state.screen = 'home';
  render();
  showPlatformToast('Курс сохранён!');
  playSound('correct');
}

function loadDemoVenue() {
  const demo = [
    { type: 'composition', name: 'Капучино', correct: ['Шот эспрессо', 'Молоко'], info_text: '💡 Точный состав по ТТК:\n• Шот эспрессо\n• Молоко' },
    { type: 'composition', name: 'Латте', correct: ['Шот эспрессо', 'Молоко'], info_text: '💡 Точный состав по ТТК:\n• Шот эспрессо\n• Молоко' },
    { type: 'composition', name: 'Раф', correct: ['Шот эспрессо', 'Молоко', 'Сливки 10%', 'Ванильный сахар'], info_text: '💡 Точный состав по ТТК:\n• Шот эспрессо\n• Молоко\n• Сливки 10%\n• Ванильный сахар' },
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
