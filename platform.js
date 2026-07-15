// ====================== PLATFORM LAYER ======================
// Client-side owner / staff flow, TTK upload, course generation.
// No backend required: everything is stored in localStorage.

const VENUE_STYLES = [
  { id: 'modern', label: 'Современный', theme: 'dark', accent: '#58CC02', mood: 'modern minimalist coffee shop interior' },
  { id: 'classic', label: 'Классический', theme: 'light', accent: '#8B5E3C', mood: 'classic cozy european cafe interior' },
  { id: 'rustic', label: 'Лофт / Рустик', theme: 'dark', accent: '#FF9600', mood: 'rustic loft brick wall coffee shop' },
  { id: 'minimal', label: 'Минимализм', theme: 'light', accent: '#1CB0F6', mood: 'clean minimal white coffee shop' },
  { id: 'neon', label: 'Неон', theme: 'dark', accent: '#CE82FF', mood: 'neon cyberpunk bar interior' },
];

function generateVenueCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
  return ['roleSelect', 'ownerRegister', 'ownerSetup', 'courseEditor', 'ownerDashboard', 'sectionPicker', 'staffRegister', 'staffJoin'].includes(state.screen);
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
  delete venue.items;
  return venue;
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
      state.screen = (state.venue.sections && state.venue.sections.some(s => s.items && s.items.length)) ? 'home' : 'staffJoin';
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
}

function validatePlatformButton() {
  const draft = state.platformDraft || {};
  const btn = document.getElementById('platform-primary-btn');
  if (!btn) return;
  let valid = true;
  if (state.screen === 'ownerRegister') {
    valid = !!(draft.name && draft.name.trim() && draft.venueName && draft.venueName.trim());
  } else if (state.screen === 'staffRegister') {
    valid = !!(draft.name && draft.name.trim());
  } else if (state.screen === 'staffJoin') {
    valid = (draft.code || '').trim().length === 6;
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
    sections: [],
    staff: [],
    createdAt: Date.now(),
  };

  const auth = { role: 'owner', name: name, venueId: venue.id, code: code };
  state.profile = { nickname: name };
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

  const p = getProgress();
  let venue = normalizeVenue(p.venue || null);
  if (!venue || venue.code !== code) {
    showPlatformToast('Код не найден на этом устройстве. Владелец и сотрудник должны использовать один браузер (до появления сервера).');
    return;
  }

  const staff = { name, joinedAt: Date.now() };
  venue.staff = venue.staff || [];
  venue.staff.push(staff);

  const auth = { role: 'staff', name, venueId: venue.id, code: code };
  state.profile = { nickname: name };
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
        <input class="platform-input" type="text" id="owner-name" value="${name}" placeholder="Иван" maxlength="30" oninput="updatePlatformDraft('name', this.value); validatePlatformButton()">
        <label class="platform-label">Название заведения</label>
        <input class="platform-input" type="text" id="venue-name" value="${venueName}" placeholder="Кофейня 'Зерно'" maxlength="40" oninput="updatePlatformDraft('venueName', this.value); validatePlatformButton()">
        <label class="platform-label">Стиль заведения</label>
        <div class="style-grid">
          ${VENUE_STYLES.map(s => `
            <button class="style-card ${style === s.id ? 'selected' : ''}" data-style="${s.id}" onclick="selectVenueStyle('${s.id}')">
              <div class="style-dot" style="background:${s.accent}"></div>
              <div class="style-label">${s.label}</div>
            </button>
          `).join('')}
        </div>
        <button id="platform-primary-btn" class="onboarding-btn ${valid ? '' : 'disabled'}" onclick="registerOwner()">Создать заведение</button>
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
          ${parsedCount ? `<button class="onboarding-btn" onclick="openCourseEditor()">Редактор (${parsedCount})</button>` : ''}
        </div>

        ${parsedCount ? `<div class="parsed-preview">Распознано позиций: <strong>${parsedCount}</strong></div>` : ''}

        <div class="demo-hint">Нет файла? <button class="link-btn" onclick="loadDemoVenue()">Загрузить демо-меню</button></div>
      </div>
    </div>
  `;
}

function renderOwnerDashboard() {
  const venue = state.venue;
  const sections = getVenueSections();
  const itemCount = sections.reduce((sum, s) => sum + (s.items ? s.items.length : 0), 0);
  const staffCount = venue.staff ? venue.staff.length : 0;
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
          <div class="dashboard-stat-value">${sections.length}</div>
          <div class="dashboard-stat-label">Разделов</div>
        </div>
        <div class="dashboard-stat">
          <div class="dashboard-stat-value">${staffCount}</div>
          <div class="dashboard-stat-label">Сотрудников</div>
        </div>
      </div>
      <div class="section-management">
        <div class="platform-label">Разделы</div>
        ${sections.length ? sections.map(s => `
          <div class="section-row">
            <div>
              <div class="section-row-name">${s.name}</div>
              <div class="section-row-meta">${s.items ? s.items.length : 0} позиций • ${Math.ceil((s.items ? s.items.length : 0) / 8)} уроков</div>
            </div>
            <button class="section-row-action" onclick="editSection('${s.id}')">✎</button>
            <button class="section-row-action" onclick="deleteSection('${s.id}')">🗑</button>
          </div>
        `).join('') : '<div class="section-empty">Пока нет разделов</div>'}
        <button class="onboarding-btn secondary" onclick="promptNewSection()">+ Новый раздел</button>
      </div>
      <button class="stats-btn" style="${cementStyle()}" onclick="state.screen='ownerSetup'; render()">🔄 Загрузить ТТК</button>
      <button class="stats-btn" style="${cementStyle()}" onclick="generateVenueMoodImage()">✨ Сгенерировать фон заведения</button>
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
      <div class="platform-title">🔑 Код заведения</div>
      <div class="platform-subtitle">Введите 6-значный код, который вам дал владелец</div>
      <div class="platform-form">
        <input class="platform-input code-input" type="text" id="venue-code" value="${code}" placeholder="123456" maxlength="6" oninput="updatePlatformDraft('code', this.value); validatePlatformButton()">
        <button id="platform-primary-btn" class="onboarding-btn ${code.trim().length === 6 ? '' : 'disabled'}" onclick="joinStaffVenue()">Присоединиться</button>
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

  app.innerHTML = `
    <div class="top-bar">
      <div class="profile-chip">
        <span>${state.profile && state.profile.nickname || 'Ты'}</span>
      </div>
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
    <div class="home-screen" ${bgImage ? `style="--venue-bg:${bgImage}"` : ''}>
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
      ${hasSections ? sections.map(s => `
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
      `).join('') : `<div class="parsed-preview" style="background:rgba(255,255,255,0.05);color:var(--text-secondary)">${isOwner ? 'Загрузите ТТК, чтобы создать первый раздел' : 'Владелец ещё не загрузил меню'}</div>`}
      ${isOwner ? `<button class="section-card" style="${cementStyle()}" onclick="ownerDashboard()">
        <div class="card-img-wrap"><div class="card-img-placeholder">🏪</div></div>
        <div class="card-info">
          Управление заведением
          <small>Код, сотрудники, разделы, фон</small>
        </div>
        <div class="card-arrow">›</div>
      </button>` : ''}
      <button class="stats-btn" style="${cementStyle()}" onclick="logoutPlatform()">🚪 Выйти из аккаунта</button>
    </div>
  `;
}

function getSectionEmoji(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('кофе') || n.includes('напит')) return '☕';
  if (n.includes('бар')) return '🍸';
  if (n.includes('десерт') || n.includes('выпеч')) return '🍰';
  if (n.includes('кухн') || n.includes('блюд') || n.includes('завтрак') || n.includes('обед') || n.includes('ужин')) return '🍽️';
  if (n.includes('салат')) return '🥗';
  if (n.includes('суп')) return '🍲';
  return '📋';
}

function getVenueEmoji(style) {
  const map = { modern: '☕', classic: '🍷', rustic: '🍺', minimal: '🥛', neon: '🍸' };
  return map[style] || '🍽️';
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
      <div class="platform-title">📝 Редактор курса</div>
      <div class="platform-subtitle">Проверьте и отредактируйте распознанные позиции</div>
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
        <button id="platform-primary-btn" class="onboarding-btn" onclick="saveCourseFromEditor()">💾 Сохранить курс (${items.length})</button>
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
  const hasGrams = it.correct && it.correct[0] && typeof it.correct[0] === 'object';
  const components = (it.correct || []).map(c => typeof c === 'object' ? c.ingredient : c).join(', ');
  const grams = hasGrams ? (it.correct || []).map(c => c.grams || '').join(', ') : '';
  const image = it.image || '';
  return `
    <div class="editor-item" data-idx="${idx}">
      <div class="editor-item-header">
        <input class="platform-input editor-item-name" type="text" value="${escapeHtml(it.name)}" placeholder="Название позиции" oninput="updateParsedItem(${idx}, 'name', this.value)">
        <button class="editor-item-delete" onclick="deleteParsedItem(${idx})">🗑</button>
      </div>
      <label class="platform-label">Состав (через запятую)</label>
      <input class="platform-input" type="text" value="${escapeHtml(components)}" placeholder="Ингредиент 1, Ингредиент 2" oninput="updateParsedItemComponents(${idx}, this.value)">
      <label class="platform-label">Граммовки (через запятую, опционально)</label>
      <input class="platform-input" type="text" value="${escapeHtml(grams)}" placeholder="10, 20, 30" oninput="updateParsedItemGrams(${idx}, this.value)">
      <label class="platform-label">Фото (URL или загрузите файл)</label>
      <div class="editor-image-row">
        <input class="platform-input" type="text" value="${escapeHtml(image)}" placeholder="https://..." oninput="updateParsedItemImage(${idx}, this.value)">
        <input type="file" id="editor-img-${idx}" accept="image/*" style="display:none" onchange="handleEditorImage(${idx}, this.files[0])">
        <button class="editor-img-btn" onclick="document.getElementById('editor-img-${idx}').click()">📷</button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function updateParsedItem(idx, field, value) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  items[idx][field] = value.trim();
}

function updateParsedItemComponents(idx, value) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  const comps = value.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
  const oldCorrect = items[idx].correct || [];
  const hasGrams = oldCorrect[0] && typeof oldCorrect[0] === 'object';
  if (hasGrams) {
    items[idx].correct = comps.map((c, i) => ({ ingredient: c, grams: (oldCorrect[i] && oldCorrect[i].grams) || 0 }));
  } else {
    items[idx].correct = comps;
  }
  items[idx].info_text = `💡 Точный состав по ТТК:\n• ${items[idx].correct.map(c => typeof c === 'object' ? c.ingredient : c).join('\n• ')}`;
}

function updateParsedItemGrams(idx, value) {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items[idx]) return;
  const grams = value.split(/[,;|]/).map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
  const comps = (items[idx].correct || []).map(c => typeof c === 'object' ? c.ingredient : c);
  items[idx].correct = comps.map((c, i) => ({ ingredient: c, grams: grams[i] || 0 }));
  items[idx].info_text = `💡 Точный состав по ТТК:\n• ${items[idx].correct.map(c => `${c.ingredient} (${c.grams}г)`).join('\n• ')}`;
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
    correct: [],
    info_text: '💡 Точный состав по ТТК:\n• ',
  });
  render();
}

function saveCourseFromEditor() {
  const draft = state.platformDraft || {};
  const items = draft.parsedItems || [];
  if (!items.length) return;

  const validItems = items.filter(it => it.name && it.correct && it.correct.length);
  if (!validItems.length) {
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

  const allComponents = new Set();
  validItems.forEach(it => {
    it.correct.forEach(c => allComponents.add(typeof c === 'object' ? c.ingredient : c));
  });
  const allComponentsArray = [...allComponents];

  target.items = validItems.map(item => {
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
  render();
}

function generateVenueMoodImage() {
  const venue = state.venue;
  const style = VENUE_STYLES.find(s => s.id === venue.style) || VENUE_STYLES[0];
  const url = venueMoodImageUrl(style, venue.name);
  venue.bgImage = url;
  saveProgress({ venue: venue });
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
        if (g !== undefined && !isNaN(g)) grams[componentName] = g;
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
  state.platformDraft.sectionName = (state.platformDraft.sectionName || 'Основное меню');
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

  const validItems = items.filter(it => it.name && it.correct && it.correct.length);
  if (!validItems.length) return;

  const venue = state.venue;
  venue.sections = venue.sections || [];
  const sectionName = (draft.sectionName || 'Основное меню').trim();
  let target = venue.sections.find(s => s.name === sectionName);
  if (!target) {
    target = { id: generateId(), name: sectionName, items: [], createdAt: Date.now() };
    venue.sections.push(target);
  }

  const allComponents = new Set();
  validItems.forEach(it => {
    it.correct.forEach(c => allComponents.add(typeof c === 'object' ? c.ingredient : c));
  });
  const allComponentsArray = [...allComponents];

  target.items = validItems.map(item => {
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
  window.renderHome = renderPlatformHome;
  state.screen = 'home';
  render();
  showPlatformToast(`Курс «${target.name}» сохранён`);
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
