const APP_KEY = 'ttk_academy_v2';

let state = {
    screen: 'home',
    section: null,
    sectionLabel: '',
    allData: [],
    lessons: [],
    currentLessonIdx: null,
    questions: [],
    currentQIdx: 0,
    hearts: 5,
    sessionXP: 0,
    sessionCorrect: 0,
    sessionTotal: 0,
    mistakeIds: [],
    feedbackShown: false,
    selectedOptions: new Set(),
    selectedChoice: null,
    isPractice: false,
};

function getState() { return state; }
function setState(newState) { Object.assign(state, newState); }

function loadProgress() {
    try {
        const raw = localStorage.getItem(APP_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}
function saveProgress(data) {
    const current = loadProgress();
    Object.assign(current, data);
    localStorage.setItem(APP_KEY, JSON.stringify(current));
}
function getProgress() { return loadProgress(); }

function getSectionProgress(section) {
    const p = getProgress();
    return p[section] || {};
}
function saveLessonComplete(section, lessonIdx, score, total) {
    const p = getProgress();
    if (!p[section]) p[section] = {};
    const key = `lesson_${lessonIdx}`;
    const prev = p[section][key] || { completed: false, crowns: 0, bestScore: 0 };
    prev.completed = true;
    prev.crowns = Math.min(5, prev.crowns + 1);
    prev.bestScore = Math.max(prev.bestScore, score);
    p[section][key] = prev;
    saveProgress(p);
}
function getGlobalStats() {
    const p = getProgress();
    return {
        totalXP: p.totalXP || 0,
        streak: p.streak || 0,
        lastDate: p.lastDate || null,
        totalLessons: p.totalLessons || 0,
    };
}
function addXP(amount) {
    const p = getProgress();
    p.totalXP = (p.totalXP || 0) + amount;
    const today = new Date().toDateString();
    if (p.lastDate !== today) {
        if (p.lastDate === new Date(Date.now() - 86400000).toDateString()) {
            p.streak = (p.streak || 0) + 1;
        } else if (p.lastDate !== today) {
            p.streak = 1;
        }
        p.lastDate = today;
    }
    p.totalLessons = (p.totalLessons || 0) + 1;
    saveProgress(p);
}

function recordAnswer(itemName, correct) {
    const p = getProgress();
    if (!p.itemStrength) p.itemStrength = {};
    const s = p.itemStrength[itemName] || { strength: 3, attempts: 0 };
    s.attempts++;
    if (correct) {
        s.strength = Math.min(5, s.strength + 1);
    } else {
        s.strength = Math.max(0, s.strength - 1.5);
    }
    s.lastSeen = Date.now();
    p.itemStrength[itemName] = s;
    saveProgress(p);
}
function getWeakItems(section) {
    const p = getProgress();
    if (!p.itemStrength) return [];
    const sectionData = state.allData;
    return sectionData
        .filter(d => {
            const s = p.itemStrength[d.name];
            return s && s.strength < 3;
        })
        .sort((a, b) => {
            const sa = (p.itemStrength[a.name] || {}).strength || 3;
            const sb = (p.itemStrength[b.name] || {}).strength || 3;
            return sa - sb;
        });
}

// ====================== UTILITIES ======================
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function showConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);
    const colors = ['#58CC02', '#1CB0F6', '#FFC800', '#FF9600', '#CE82FF', '#FF4B4B'];
    for (let i = 0; i < 50; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = Math.random() * 0.5 + 's';
        piece.style.animationDuration = (2 + Math.random() * 2) + 's';
        container.appendChild(piece);
    }
    setTimeout(() => container.remove(), 4000);
}

function showXPPopup(amount) {
    const popup = document.createElement('div');
    popup.className = 'xp-popup';
    popup.textContent = `+${amount} XP`;
    document.body.appendChild(popup);
    setTimeout(() => popup.remove(), 1600);
}

// ====================== RENDERING ======================
function render() {
    const app = document.getElementById('app');
    if (!app) return;
    switch (state.screen) {
        case 'home': renderHome(); break;
        case 'path': renderPath(); break;
        case 'lesson': renderLesson(); break;
        case 'result': renderResult(); break;
    }
}

function renderHome() {
    const app = document.getElementById('app');
    const stats = getGlobalStats();
    app.innerHTML = `
        <div class="top-bar">
            <div class="top-bar-stat">
                <span class="icon">\uD83D\uDD25</span>
                <span class="streak-count">${stats.streak}</span>
            </div>
            <div class="top-bar-stat">
                <span class="icon">\u26A1</span>
                <span class="xp-count">${stats.totalXP} XP</span>
            </div>
            <div class="top-bar-stat">
                <span class="icon">\uD83D\uDCDA</span>
                <span style="color:var(--purple)">${stats.totalLessons}</span>
            </div>
        </div>
        <div class="home-screen">
            <div class="mascot-area">
                <span class="mascot">\uD83E\uDD89</span>
                <div class="app-title">\u0422\u0422\u041A \u0410\u043A\u0430\u0434\u0435\u043C\u0438\u044F</div>
                <div class="app-subtitle">\u0412\u044B\u0443\u0447\u0438 \u0441\u043E\u0441\u0442\u0430\u0432\u044B \u0431\u043B\u044E\u0434 \u043A\u0430\u043A \u0432 Duolingo!</div>
            </div>
            <button class="section-card card-kitchen" onclick="selectSection('kitchen')">
                <div class="card-icon">\uD83C\uDF73</div>
                <div class="card-info">\u041A\u0443\u0445\u043D\u044F</div>
                <div class="card-arrow">\u203A</div>
            </button>
            <button class="section-card card-desserts" onclick="selectSection('desserts')">
                <div class="card-icon">\uD83C\uDF70</div>
                <div class="card-info">\u0414\u0435\u0441\u0435\u0440\u0442\u044B</div>
                <div class="card-arrow">\u203A</div>
            </button>
            <button class="section-card card-drinks" onclick="selectSection('drinks')">
                <div class="card-icon">\uD83C\uDF79</div>
                <div class="card-info">\u041D\u0430\u043F\u0438\u0442\u043A\u0438</div>
                <div class="card-arrow">\u203A</div>
            </button>
        </div>
    `;
}

async function selectSection(section) {
    state.section = section;
    const labels = { kitchen: '\uD83C\uDF73 \u041A\u0443\u0445\u043D\u044F', desserts: '\uD83C\uDF70 \u0414\u0435\u0441\u0435\u0440\u0442\u044B', drinks: '\uD83C\uDF79 \u041D\u0430\u043F\u0438\u0442\u043A\u0438' };
    state.sectionLabel = labels[section] || section;

    const app = document.getElementById('app');
    app.innerHTML = `<div class="loading-screen"><div class="loader"></div><p>\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...</p></div>`;

    const fileName = (section === 'kitchen') ? 'dishes.json' : `${section}.json`;
    try {
        const response = await fetch(fileName);
        if (!response.ok) throw new Error('File not found');
        state.allData = await response.json();
        buildLessons();
        state.screen = 'path';
        render();
    } catch (e) {
        app.innerHTML = `
            <div class="loading-screen">
                <span style="font-size:60px">\uD83D\uDE14</span>
                <p>\u0424\u0430\u0439\u043B ${fileName} \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D</p>
                <button class="result-btn secondary" onclick="goHome()">\u041D\u0430\u0437\u0430\u0434</button>
            </div>
        `;
    }
}

function buildLessons() {
    const data = state.allData;
    const lessonSize = 8;
    state.lessons = [];
    for (let i = 0; i < data.length; i += lessonSize) {
        state.lessons.push(data.slice(i, i + lessonSize));
    }
}

function renderPath() {
    const app = document.getElementById('app');
    const stats = getGlobalStats();
    const sp = getSectionProgress(state.section);
    const weakItems = getWeakItems(state.section);

    let firstIncomplete = state.lessons.length;
    for (let i = 0; i < state.lessons.length; i++) {
        const ld = sp[`lesson_${i}`];
        if (!ld || !ld.completed) {
            firstIncomplete = i;
            break;
        }
    }

    let nodesHTML = '';
    const offsets = [0, 40, 60, 40, 0, -40, -60, -40];

    for (let i = 0; i < state.lessons.length; i++) {
        const ld = sp[`lesson_${i}`] || {};
        let nodeClass = 'locked';
        let clickHandler = '';

        if (i < firstIncomplete) {
            nodeClass = 'completed';
            clickHandler = `onclick="startLesson(${i})"`;
        } else if (i === firstIncomplete) {
            nodeClass = 'available';
            clickHandler = `onclick="startLesson(${i})"`;
        }

        const offset = offsets[i % offsets.length];
        const crownHTML = ld.crowns > 0 ? `<span class="crown-badge">\uD83D\uDC51${ld.crowns > 1 ? ld.crowns : ''}</span>` : '';
        const connectorClass = i < firstIncomplete ? 'completed' : '';

        if (i > 0) {
            nodesHTML += `<div class="path-connector ${connectorClass}"></div>`;
        }

        nodesHTML += `
            <div class="path-row">
                <button class="lesson-node ${nodeClass}" ${clickHandler} style="margin-left:${offset}px">
                    ${crownHTML}
                    ${i + 1}
                    <span class="node-sub">${state.lessons[i].length} \u043A\u0430\u0440\u0442</span>
                </button>
            </div>
        `;
    }

    const practiceHTML = weakItems.length > 0 ? `
        <button class="practice-btn" onclick="startPractice()">
            \uD83C\uDFCB\uFE0F \u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u0441\u043B\u0430\u0431\u044B\u0445 \u043C\u0435\u0441\u0442 (${weakItems.length})
        </button>
    ` : '';

    app.innerHTML = `
        <div class="path-screen">
            <div class="path-header">
                <button class="back-btn" onclick="goHome()">\u2190</button>
                <div class="path-title">${state.sectionLabel}</div>
            </div>
            ${practiceHTML}
            <div class="path-container">
                ${nodesHTML}
            </div>
        </div>
    `;
}

function goHome() {
    state.screen = 'home';
    state.section = null;
    render();
}

// ====================== LESSON LOGIC ======================
function startLesson(idx) {
    state.currentLessonIdx = idx;
    state.isPractice = false;
    const lessonData = state.lessons[idx];
    state.questions = generateQuestions(lessonData);
    state.currentQIdx = 0;
    state.hearts = 5;
    state.sessionXP = 0;
    state.sessionCorrect = 0;
    state.sessionTotal = 0;
    state.mistakeIds = [];
    state.feedbackShown = false;
    state.selectedOptions = new Set();
    state.selectedChoice = null;
    state.screen = 'lesson';
    render();
}

function startPractice() {
    const weakItems = getWeakItems(state.section);
    if (weakItems.length === 0) return;
    state.isPractice = true;
    state.currentLessonIdx = -1;
    const practiceData = weakItems.slice(0, 15);
    state.questions = generateQuestions(practiceData);
    state.currentQIdx = 0;
    state.hearts = 5;
    state.sessionXP = 0;
    state.sessionCorrect = 0;
    state.sessionTotal = 0;
    state.mistakeIds = [];
    state.feedbackShown = false;
    state.selectedOptions = new Set();
    state.selectedChoice = null;
    state.screen = 'lesson';
    render();
}

function generateQuestions(items) {
    const questions = [];
    const shuffled = shuffle(items);

    for (const item of shuffled) {
        const rand = Math.random();

        if (rand < 0.5) {
            questions.push({
                type: 'select',
                item: item,
                pool: shuffle(item.pool),
            });
        } else if (rand < 0.75 && item.correct.length > 2) {
            const missingIdx = Math.floor(Math.random() * item.correct.length);
            const missingIng = item.correct[missingIdx];
            const shown = item.correct.filter((_, i) => i !== missingIdx);
            const distractors = item.pool.filter(p => !item.correct.includes(p));
            const choices = shuffle([missingIng, ...shuffle(distractors).slice(0, 3)]);

            questions.push({
                type: 'missing',
                item: item,
                shown: shown,
                missing: missingIng,
                choices: choices,
            });
        } else {
            const isTrue = Math.random() > 0.5;
            let ingredient;
            if (isTrue) {
                ingredient = item.correct[Math.floor(Math.random() * item.correct.length)];
            } else {
                const wrong = item.pool.filter(p => !item.correct.includes(p));
                if (wrong.length === 0) {
                    questions.push({
                        type: 'select',
                        item: item,
                        pool: shuffle(item.pool),
                    });
                    continue;
                }
                ingredient = wrong[Math.floor(Math.random() * wrong.length)];
            }
            questions.push({
                type: 'truefalse',
                item: item,
                ingredient: ingredient,
                answer: isTrue,
            });
        }
    }

    return shuffle(questions);
}

// ====================== LESSON RENDERING ======================
function renderLesson() {
    const app = document.getElementById('app');
    if (state.feedbackShown) {
        renderFeedback();
        return;
    }

    const q = state.questions[state.currentQIdx];
    if (!q) {
        finishLesson();
        return;
    }

    const progress = (state.currentQIdx / state.questions.length) * 100;
    const heartsStr = '\u2764\uFE0F'.repeat(Math.max(0, state.hearts));

    let questionHTML = '';

    if (q.type === 'select') {
        const typeLabel = q.item.type === 'allergen' ? '\u0412\u044B\u0431\u0435\u0440\u0438 \u0430\u043B\u043B\u0435\u0440\u0433\u0435\u043D\u044B' : '\u0412\u044B\u0431\u0435\u0440\u0438 \u0441\u043E\u0441\u0442\u0430\u0432';
        const dishName = q.item.name;
        let optionsHTML = q.pool.map((ing, idx) => `
            <button class="option-btn ${state.selectedOptions.has(idx) ? 'selected' : ''}"
                    onclick="toggleOption(${idx})">${ing}</button>
        `).join('');

        questionHTML = `
            <div class="question-area">
                <div class="question-type-label">${typeLabel}</div>
                <div class="question-title">
                    \u0427\u0442\u043E \u0432\u0445\u043E\u0434\u0438\u0442 \u0432 <span class="question-dish-name">${dishName}</span>?
                </div>
                <div class="options-grid">${optionsHTML}</div>
            </div>
            <div class="bottom-area">
                <button class="check-btn ${state.selectedOptions.size > 0 ? 'active' : 'disabled'}"
                        onclick="${state.selectedOptions.size > 0 ? 'checkSelectAnswer()' : ''}">
                    \u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C
                </button>
            </div>
        `;
    } else if (q.type === 'missing') {
        const typeLabel = '\u041D\u0430\u0439\u0434\u0438 \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043D\u043E\u0435';
        const dishName = q.item.name;

        const shownHTML = q.shown.map(ing =>
            `<span class="missing-item">${ing}</span>`
        ).join('') + `<span class="missing-slot">\u2753</span>`;

        const choicesHTML = q.choices.map((c, idx) => `
            <button class="choice-btn ${state.selectedChoice === idx ? 'selected' : ''}"
                    onclick="selectChoice(${idx})">${c}</button>
        `).join('');

        questionHTML = `
            <div class="question-area">
                <div class="question-type-label">${typeLabel}</div>
                <div class="question-title">
                    \u041A\u0430\u043A\u043E\u0439 \u0438\u043D\u0433\u0440\u0435\u0434\u0438\u0435\u043D\u0442 \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D \u0432 <span class="question-dish-name">${dishName}</span>?
                </div>
                <div class="missing-list">${shownHTML}</div>
                <div class="choice-grid">${choicesHTML}</div>
            </div>
            <div class="bottom-area">
                <button class="check-btn ${state.selectedChoice !== null ? 'active' : 'disabled'}"
                        onclick="${state.selectedChoice !== null ? 'checkMissingAnswer()' : ''}">
                    \u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C
                </button>
            </div>
        `;
    } else if (q.type === 'truefalse') {
        const typeLabel = '\u0412\u0435\u0440\u043D\u043E \u0438\u043B\u0438 \u043D\u0435\u0442?';
        const verb = q.item.type === 'allergen' ? '\u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u0430\u043B\u043B\u0435\u0440\u0433\u0435\u043D' : '\u0432\u0445\u043E\u0434\u0438\u0442 \u0432 \u0441\u043E\u0441\u0442\u0430\u0432';
        const dishName = q.item.name;

        questionHTML = `
            <div class="question-area">
                <div class="question-type-label">${typeLabel}</div>
                <div class="question-title">
                    <span class="question-dish-name">${q.ingredient}</span>
                    <br>${verb}
                    <br><span class="question-dish-name">${dishName}</span>?
                </div>
                <div class="tf-buttons">
                    <button class="tf-btn tf-yes" onclick="checkTFAnswer(true)">\u2705 \u0414\u0430</button>
                    <button class="tf-btn tf-no" onclick="checkTFAnswer(false)">\u274C \u041D\u0435\u0442</button>
                </div>
            </div>
        `;
    }

    app.innerHTML = `
        <div class="lesson-screen">
            <div class="lesson-header">
                <button class="close-btn" onclick="confirmQuit()">\u2715</button>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width:${progress}%"></div>
                </div>
                <div class="hearts-display" id="hearts-display">${heartsStr}</div>
            </div>
            ${questionHTML}
        </div>
    `;
}

function toggleOption(idx) {
    if (state.feedbackShown) return;
    if (state.selectedOptions.has(idx)) {
        state.selectedOptions.delete(idx);
    } else {
        state.selectedOptions.add(idx);
    }
    render();
}

function selectChoice(idx) {
    if (state.feedbackShown) return;
    state.selectedChoice = idx;
    render();
}

// ====================== ANSWER CHECKING ======================
function checkSelectAnswer() {
    const q = state.questions[state.currentQIdx];
    const selectedItems = [...state.selectedOptions].map(i => q.pool[i]);
    const correctSet = new Set(q.item.correct);
    const selectedSet = new Set(selectedItems);
    const isCorrect = correctSet.size === selectedSet.size && [...correctSet].every(c => selectedSet.has(c));

    processAnswer(isCorrect, q.item);
}

function checkMissingAnswer() {
    const q = state.questions[state.currentQIdx];
    const selected = q.choices[state.selectedChoice];
    const isCorrect = selected === q.missing;

    processAnswer(isCorrect, q.item);
}

function checkTFAnswer(userAnswer) {
    const q = state.questions[state.currentQIdx];
    const isCorrect = userAnswer === q.answer;

    processAnswer(isCorrect, q.item);
}

function processAnswer(isCorrect, item) {
    state.sessionTotal++;
    recordAnswer(item.name, isCorrect);

    if (isCorrect) {
        state.sessionCorrect++;
        state.sessionXP += 10;
        state._lastCorrect = true;
    } else {
        state.hearts--;
        state._lastCorrect = false;
        if (!state.mistakeIds.includes(item.name)) {
            state.mistakeIds.push(item.name);
        }
    }

    state._lastItem = item;
    state.feedbackShown = true;

    if (state.hearts <= 0) {
        renderFeedback();
        return;
    }

    renderFeedback();
}

function renderFeedback() {
    const app = document.getElementById('app');
    const q = state.questions[state.currentQIdx];
    const item = state._lastItem;
    const isCorrect = state._lastCorrect;
    const progress = ((state.currentQIdx + 1) / state.questions.length) * 100;
    const heartsStr = '\u2764\uFE0F'.repeat(Math.max(0, state.hearts));

    const feedbackClass = isCorrect ? 'correct' : 'wrong';
    const icon = isCorrect ? '\uD83C\uDF89' : '\uD83D\uDE1E';
    const text = isCorrect ? '\u041E\u0442\u043B\u0438\u0447\u043D\u043E!' : '\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u043E';
    const infoText = item.info_text || '';
    const correctList = item.correct.join(', ');

    const detailHTML = isCorrect
        ? `<div class="info-box">${infoText}</div>`
        : `<div class="feedback-detail">\u041F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u044B\u0439 \u043E\u0442\u0432\u0435\u0442: ${correctList}</div><div class="info-box">${infoText}</div>`;

    const btnText = state.hearts <= 0 ? '\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B' : '\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C';

    app.innerHTML = `
        <div class="lesson-screen">
            <div class="lesson-header">
                <button class="close-btn" onclick="confirmQuit()">\u2715</button>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width:${progress}%"></div>
                </div>
                <div class="hearts-display" id="hearts-display">${heartsStr}</div>
            </div>
            <div class="question-area" style="flex:1;overflow-y:auto;">
                <div style="flex:1"></div>
            </div>
            <div class="feedback-banner ${feedbackClass}">
                <div class="feedback-header">
                    <span class="feedback-icon">${icon}</span>
                    <span class="feedback-text">${text}</span>
                </div>
                ${detailHTML}
                <button class="feedback-continue-btn" onclick="nextQuestion()">${btnText}</button>
            </div>
        </div>
    `;

    if (!isCorrect) {
        const display = document.getElementById('hearts-display');
        if (display) display.classList.add('heart-break');
    }
}

function nextQuestion() {
    if (state.hearts <= 0) {
        finishLesson();
        return;
    }

    state.currentQIdx++;
    state.feedbackShown = false;
    state.selectedOptions = new Set();
    state.selectedChoice = null;

    if (state.currentQIdx >= state.questions.length) {
        finishLesson();
    } else {
        render();
    }
}

function finishLesson() {
    const xpEarned = state.sessionXP + (state.hearts > 0 ? 15 : 0);
    addXP(xpEarned);

    if (!state.isPractice && state.currentLessonIdx >= 0 && state.hearts > 0) {
        saveLessonComplete(state.section, state.currentLessonIdx, state.sessionCorrect, state.sessionTotal);
    }

    state.screen = 'result';
    state._finalXP = xpEarned;
    render();

    if (state.sessionCorrect === state.sessionTotal && state.sessionTotal > 0) {
        setTimeout(showConfetti, 300);
    }
    setTimeout(() => showXPPopup(xpEarned), 500);
}

function renderResult() {
    const app = document.getElementById('app');
    const accuracy = state.sessionTotal > 0
        ? Math.round((state.sessionCorrect / state.sessionTotal) * 100)
        : 0;

    const barColor = accuracy >= 80 ? 'var(--green)' : accuracy >= 50 ? 'var(--gold)' : 'var(--red)';
    const resultEmoji = accuracy === 100 ? '\uD83C\uDFC6' : accuracy >= 80 ? '\uD83C\uDF1F' : accuracy >= 50 ? '\uD83D\uDC4D' : '\uD83D\uDCAA';
    const resultTitle = accuracy === 100 ? '\u0418\u0434\u0435\u0430\u043B\u044C\u043D\u043E!' :
                        accuracy >= 80 ? '\u041E\u0442\u043B\u0438\u0447\u043D\u0430\u044F \u0440\u0430\u0431\u043E\u0442\u0430!' :
                        accuracy >= 50 ? '\u041D\u0435\u043F\u043B\u043E\u0445\u043E!' : '\u041D\u0443\u0436\u043D\u043E \u0435\u0449\u0451 \u043F\u043E\u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C\u0441\u044F';

    app.innerHTML = `
        <div class="result-screen">
            <div class="result-mascot">${resultEmoji}</div>
            <div class="result-title">${resultTitle}</div>
            <div class="result-stats">
                <div class="result-stat">
                    <div class="result-stat-value" style="color:var(--green)">${state.sessionCorrect}</div>
                    <div class="result-stat-label">\u0412\u0435\u0440\u043D\u043E</div>
                </div>
                <div class="result-stat">
                    <div class="result-stat-value" style="color:var(--red)">${state.sessionTotal - state.sessionCorrect}</div>
                    <div class="result-stat-label">\u041E\u0448\u0438\u0431\u043E\u043A</div>
                </div>
                <div class="result-stat">
                    <div class="result-stat-value" style="color:var(--gold)">${state._finalXP}</div>
                    <div class="result-stat-label">XP</div>
                </div>
            </div>
            <button class="result-btn primary" onclick="returnToPath()">\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C</button>
            ${state.mistakeIds.length > 0 ? `<button class="result-btn secondary" onclick="retryMistakes()">\uD83D\uDD04 \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C \u043E\u0448\u0438\u0431\u043A\u0438 (${state.mistakeIds.length})</button>` : ''}
        </div>
    `;
}

function returnToPath() {
    state.screen = 'path';
    render();
}

function retryMistakes() {
    const mistakeItems = state.allData.filter(d => state.mistakeIds.includes(d.name));
    if (mistakeItems.length === 0) {
        returnToPath();
        return;
    }
    state.isPractice = true;
    state.questions = generateQuestions(mistakeItems);
    state.currentQIdx = 0;
    state.hearts = 5;
    state.sessionXP = 0;
    state.sessionCorrect = 0;
    state.sessionTotal = 0;
    state.mistakeIds = [];
    state.feedbackShown = false;
    state.selectedOptions = new Set();
    state.selectedChoice = null;
    state.screen = 'lesson';
    render();
}

// ====================== QUIT CONFIRMATION ======================
function confirmQuit() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-content">
            <div class="modal-title">\u0412\u044B\u0439\u0442\u0438 \u0438\u0437 \u0443\u0440\u043E\u043A\u0430?</div>
            <div class="modal-text">\u0422\u0432\u043E\u0439 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0432 \u044D\u0442\u043E\u043C \u0443\u0440\u043E\u043A\u0435 \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F.</div>
            <button class="modal-btn primary" onclick="this.closest('.modal-overlay').remove()">\u041E\u0441\u0442\u0430\u0442\u044C\u0441\u044F</button>
            <button class="modal-btn secondary" onclick="quitLesson()">\u0412\u044B\u0439\u0442\u0438</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

function quitLesson() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
    state.screen = 'path';
    render();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getState,
        setState,
        loadProgress,
        saveProgress,
        getProgress,
        getSectionProgress,
        saveLessonComplete,
        getGlobalStats,
        addXP,
        recordAnswer,
        getWeakItems,
        shuffle,
        showConfetti,
        showXPPopup,
        render,
        renderHome,
        selectSection,
        buildLessons,
        renderPath,
        goHome,
        startLesson,
        startPractice,
        generateQuestions,
        renderLesson,
        toggleOption,
        selectChoice,
        checkSelectAnswer,
        checkMissingAnswer,
        checkTFAnswer,
        processAnswer,
        renderFeedback,
        nextQuestion,
        finishLesson,
        renderResult,
        returnToPath,
        retryMistakes,
        confirmQuit,
        quitLesson,
        APP_KEY
    };
}
