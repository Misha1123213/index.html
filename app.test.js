const {
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
} = require('./app');

const SAMPLE_DATA = [
    {
        name: "Dish A",
        type: "composition",
        correct: ["Ing1", "Ing2", "Ing3"],
        pool: ["Ing1", "Ing2", "Ing3", "Ing4", "Ing5"],
        info_text: "Info about Dish A"
    },
    {
        name: "Dish B",
        type: "allergen",
        correct: ["Allg1", "Allg2"],
        pool: ["Allg1", "Allg2", "Allg3", "Allg4"],
        info_text: "Info about Dish B"
    },
    {
        name: "Dish C",
        type: "composition",
        correct: ["Ing1", "Ing3", "Ing5"],
        pool: ["Ing1", "Ing2", "Ing3", "Ing4", "Ing5"],
        info_text: ""
    }
];

function generateSampleData(count) {
    const data = [];
    for (let i = 0; i < count; i++) {
        data.push({
            name: `Item ${i + 1}`,
            type: "composition",
            correct: ["A", "B", "C"],
            pool: ["A", "B", "C", "D", "E"],
            info_text: `Info ${i + 1}`
        });
    }
    return data;
}

function resetState() {
    setState({
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
    });
}

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    resetState();
    jest.restoreAllMocks();
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

// ====================== STATE ======================
describe('getState / setState', () => {
    test('returns current state', () => {
        const s = getState();
        expect(s.screen).toBe('home');
        expect(s.hearts).toBe(5);
    });

    test('merges partial state', () => {
        setState({ hearts: 2, screen: 'lesson' });
        const s = getState();
        expect(s.hearts).toBe(2);
        expect(s.screen).toBe('lesson');
        expect(s.allData).toEqual([]);
    });
});

// ====================== PERSISTENCE ======================
describe('loadProgress / saveProgress', () => {
    test('returns empty object when no data', () => {
        expect(loadProgress()).toEqual({});
    });

    test('saves and loads data', () => {
        saveProgress({ totalXP: 100, streak: 3 });
        const p = loadProgress();
        expect(p.totalXP).toBe(100);
        expect(p.streak).toBe(3);
    });

    test('merges with existing data', () => {
        saveProgress({ totalXP: 50 });
        saveProgress({ streak: 2 });
        const p = loadProgress();
        expect(p.totalXP).toBe(50);
        expect(p.streak).toBe(2);
    });

    test('handles corrupted localStorage gracefully', () => {
        localStorage.setItem(APP_KEY, 'not json');
        expect(loadProgress()).toEqual({});
    });
});

describe('getSectionProgress', () => {
    test('returns empty object for unknown section', () => {
        expect(getSectionProgress('kitchen')).toEqual({});
    });

    test('returns section data when available', () => {
        saveProgress({ kitchen: { lesson_0: { completed: true, crowns: 1, bestScore: 8 } } });
        const sp = getSectionProgress('kitchen');
        expect(sp.lesson_0.completed).toBe(true);
    });
});

describe('saveLessonComplete', () => {
    test('marks lesson as completed', () => {
        saveLessonComplete('kitchen', 0, 8, 10);
        const sp = getSectionProgress('kitchen');
        expect(sp.lesson_0.completed).toBe(true);
        expect(sp.lesson_0.crowns).toBe(1);
        expect(sp.lesson_0.bestScore).toBe(8);
    });

    test('increments crowns on repeated completions', () => {
        saveLessonComplete('kitchen', 0, 5, 10);
        saveLessonComplete('kitchen', 0, 7, 10);
        const sp = getSectionProgress('kitchen');
        expect(sp.lesson_0.crowns).toBe(2);
    });

    test('caps crowns at 5', () => {
        for (let i = 0; i < 7; i++) {
            saveLessonComplete('kitchen', 0, 8, 10);
        }
        const sp = getSectionProgress('kitchen');
        expect(sp.lesson_0.crowns).toBe(5);
    });

    test('keeps best score', () => {
        saveLessonComplete('kitchen', 0, 5, 10);
        saveLessonComplete('kitchen', 0, 3, 10);
        const sp = getSectionProgress('kitchen');
        expect(sp.lesson_0.bestScore).toBe(5);
    });
});

describe('getGlobalStats', () => {
    test('returns zeroes for fresh state', () => {
        const stats = getGlobalStats();
        expect(stats.totalXP).toBe(0);
        expect(stats.streak).toBe(0);
        expect(stats.lastDate).toBeNull();
        expect(stats.totalLessons).toBe(0);
    });
});

describe('addXP', () => {
    test('adds XP to total', () => {
        addXP(25);
        expect(getGlobalStats().totalXP).toBe(25);
    });

    test('accumulates XP', () => {
        addXP(10);
        addXP(15);
        expect(getGlobalStats().totalXP).toBe(25);
    });

    test('starts streak at 1 for first play', () => {
        addXP(10);
        expect(getGlobalStats().streak).toBe(1);
    });

    test('increments totalLessons', () => {
        addXP(10);
        addXP(10);
        expect(getGlobalStats().totalLessons).toBe(2);
    });

    test('increments streak for consecutive day', () => {
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        saveProgress({ lastDate: yesterday, streak: 3 });
        addXP(10);
        expect(getGlobalStats().streak).toBe(4);
    });

    test('resets streak if not consecutive', () => {
        saveProgress({ lastDate: 'Mon Jan 01 2020', streak: 5 });
        addXP(10);
        expect(getGlobalStats().streak).toBe(1);
    });
});

describe('recordAnswer', () => {
    test('increases strength on correct answer', () => {
        recordAnswer('Dish A', true);
        const p = loadProgress();
        expect(p.itemStrength['Dish A'].strength).toBe(4);
    });

    test('decreases strength on wrong answer', () => {
        recordAnswer('Dish A', false);
        const p = loadProgress();
        expect(p.itemStrength['Dish A'].strength).toBe(1.5);
    });

    test('caps strength at 5', () => {
        recordAnswer('Dish A', true);
        recordAnswer('Dish A', true);
        recordAnswer('Dish A', true);
        const p = loadProgress();
        expect(p.itemStrength['Dish A'].strength).toBe(5);
    });

    test('does not go below 0', () => {
        recordAnswer('Dish A', false);
        recordAnswer('Dish A', false);
        recordAnswer('Dish A', false);
        const p = loadProgress();
        expect(p.itemStrength['Dish A'].strength).toBe(0);
    });

    test('tracks attempts', () => {
        recordAnswer('Dish A', true);
        recordAnswer('Dish A', false);
        const p = loadProgress();
        expect(p.itemStrength['Dish A'].attempts).toBe(2);
    });
});

describe('getWeakItems', () => {
    test('returns empty array when no itemStrength', () => {
        setState({ allData: SAMPLE_DATA });
        expect(getWeakItems('kitchen')).toEqual([]);
    });

    test('returns items with strength < 3', () => {
        setState({ allData: SAMPLE_DATA });
        saveProgress({ itemStrength: {
            'Dish A': { strength: 2, attempts: 3 },
            'Dish B': { strength: 4, attempts: 2 },
            'Dish C': { strength: 1, attempts: 5 },
        }});
        const weak = getWeakItems('kitchen');
        expect(weak.length).toBe(2);
        expect(weak[0].name).toBe('Dish C');
        expect(weak[1].name).toBe('Dish A');
    });

    test('returns empty when all items are strong', () => {
        setState({ allData: SAMPLE_DATA });
        saveProgress({ itemStrength: {
            'Dish A': { strength: 4, attempts: 3 },
            'Dish B': { strength: 5, attempts: 2 },
        }});
        expect(getWeakItems('kitchen')).toEqual([]);
    });
});

// ====================== UTILITIES ======================
describe('shuffle', () => {
    test('returns array with same elements', () => {
        const arr = [1, 2, 3, 4, 5];
        const result = shuffle(arr);
        expect(result.sort()).toEqual(arr.sort());
    });

    test('does not mutate original array', () => {
        const arr = [1, 2, 3, 4, 5];
        const copy = [...arr];
        shuffle(arr);
        expect(arr).toEqual(copy);
    });

    test('returns same length array', () => {
        expect(shuffle([1, 2, 3]).length).toBe(3);
    });

    test('handles empty array', () => {
        expect(shuffle([])).toEqual([]);
    });

    test('handles single element', () => {
        expect(shuffle([42])).toEqual([42]);
    });
});

describe('showConfetti', () => {
    test('creates confetti container element', () => {
        showConfetti();
        expect(document.querySelector('.confetti-container')).not.toBeNull();
    });

    test('creates 50 confetti pieces', () => {
        showConfetti();
        expect(document.querySelectorAll('.confetti-piece').length).toBe(50);
    });

    test('removes container after timeout', () => {
        showConfetti();
        jest.advanceTimersByTime(4000);
        expect(document.querySelector('.confetti-container')).toBeNull();
    });
});

describe('showXPPopup', () => {
    test('creates xp popup with correct text', () => {
        showXPPopup(25);
        const popup = document.querySelector('.xp-popup');
        expect(popup).not.toBeNull();
        expect(popup.textContent).toBe('+25 XP');
    });

    test('removes popup after timeout', () => {
        showXPPopup(10);
        jest.advanceTimersByTime(1600);
        expect(document.querySelector('.xp-popup')).toBeNull();
    });
});

// ====================== RENDERING ======================
describe('render', () => {
    test('calls renderHome for home screen', () => {
        setState({ screen: 'home' });
        render();
        expect(document.querySelector('.section-card')).not.toBeNull();
    });

    test('handles missing app element gracefully', () => {
        document.body.innerHTML = '';
        setState({ screen: 'home' });
        expect(() => render()).not.toThrow();
    });
});

describe('renderHome', () => {
    test('renders section cards', () => {
        renderHome();
        const cards = document.querySelectorAll('.section-card');
        expect(cards.length).toBe(3);
    });

    test('displays global stats', () => {
        saveProgress({ totalXP: 150, streak: 5, totalLessons: 10 });
        renderHome();
        const html = document.getElementById('app').innerHTML;
        expect(html).toContain('150 XP');
        expect(html).toContain('5');
    });
});

describe('selectSection', () => {
    test('uses dishes.json for kitchen', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(SAMPLE_DATA)
        });
        await selectSection('kitchen');
        expect(global.fetch).toHaveBeenCalledWith('dishes.json');
    });

    test('uses desserts.json for desserts', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([])
        });
        await selectSection('desserts');
        expect(global.fetch).toHaveBeenCalledWith('desserts.json');
    });

    test('uses drinks.json for drinks', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([])
        });
        await selectSection('drinks');
        expect(global.fetch).toHaveBeenCalledWith('drinks.json');
    });

    test('shows loading while fetching', async () => {
        let resolvePromise;
        const pending = new Promise(r => { resolvePromise = r; });
        global.fetch = jest.fn().mockReturnValue(pending);

        const promise = selectSection('kitchen');
        expect(document.getElementById('app').innerHTML).toContain('Загрузка');

        resolvePromise({ ok: true, json: () => Promise.resolve(SAMPLE_DATA) });
        await promise;
    });

    test('shows error on fetch failure', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('fail'));
        await selectSection('kitchen');
        expect(document.getElementById('app').innerHTML).toContain('dishes.json');
        expect(document.getElementById('app').innerHTML).toContain('не найден');
    });

    test('shows error on non-ok response', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false });
        await selectSection('kitchen');
        expect(document.getElementById('app').innerHTML).toContain('не найден');
    });

    test('sets section state and builds lessons', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(SAMPLE_DATA)
        });
        await selectSection('kitchen');
        const s = getState();
        expect(s.section).toBe('kitchen');
        expect(s.allData).toEqual(SAMPLE_DATA);
        expect(s.screen).toBe('path');
    });

    test('sets correct section label', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([])
        });
        await selectSection('desserts');
        expect(getState().sectionLabel).toContain('Десерты');
    });
});

describe('buildLessons', () => {
    test('splits data into lessons of 8', () => {
        setState({ allData: generateSampleData(20) });
        buildLessons();
        const s = getState();
        expect(s.lessons.length).toBe(3);
        expect(s.lessons[0].length).toBe(8);
        expect(s.lessons[1].length).toBe(8);
        expect(s.lessons[2].length).toBe(4);
    });

    test('handles empty data', () => {
        setState({ allData: [] });
        buildLessons();
        expect(getState().lessons).toEqual([]);
    });

    test('handles data smaller than lesson size', () => {
        setState({ allData: generateSampleData(5) });
        buildLessons();
        const s = getState();
        expect(s.lessons.length).toBe(1);
        expect(s.lessons[0].length).toBe(5);
    });
});

describe('renderPath', () => {
    beforeEach(() => {
        setState({ allData: generateSampleData(20), section: 'kitchen', sectionLabel: 'Kitchen' });
        buildLessons();
    });

    test('renders lesson nodes', () => {
        renderPath();
        const nodes = document.querySelectorAll('.lesson-node');
        expect(nodes.length).toBe(3);
    });

    test('first node is available, rest locked', () => {
        renderPath();
        const nodes = document.querySelectorAll('.lesson-node');
        expect(nodes[0].classList.contains('available')).toBe(true);
        expect(nodes[1].classList.contains('locked')).toBe(true);
    });

    test('completed nodes are marked', () => {
        saveLessonComplete('kitchen', 0, 8, 8);
        renderPath();
        const nodes = document.querySelectorAll('.lesson-node');
        expect(nodes[0].classList.contains('completed')).toBe(true);
        expect(nodes[1].classList.contains('available')).toBe(true);
    });

    test('shows section label', () => {
        renderPath();
        expect(document.querySelector('.path-title').textContent).toBe('Kitchen');
    });

    test('shows practice button when weak items exist', () => {
        saveProgress({ itemStrength: { 'Item 1': { strength: 1, attempts: 5 } } });
        renderPath();
        expect(document.querySelector('.practice-btn')).not.toBeNull();
    });

    test('hides practice button when no weak items', () => {
        renderPath();
        expect(document.querySelector('.practice-btn')).toBeNull();
    });
});

describe('goHome', () => {
    test('sets screen to home and clears section', () => {
        setState({ screen: 'path', section: 'kitchen' });
        goHome();
        const s = getState();
        expect(s.screen).toBe('home');
        expect(s.section).toBeNull();
    });
});

// ====================== LESSON LOGIC ======================
describe('startLesson', () => {
    beforeEach(() => {
        setState({ allData: generateSampleData(20) });
        buildLessons();
    });

    test('initializes lesson state', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.1);
        startLesson(0);
        const s = getState();
        expect(s.currentLessonIdx).toBe(0);
        expect(s.isPractice).toBe(false);
        expect(s.currentQIdx).toBe(0);
        expect(s.hearts).toBe(5);
        expect(s.sessionXP).toBe(0);
        expect(s.screen).toBe('lesson');
        expect(s.questions.length).toBeGreaterThan(0);
    });

    test('resets session counters', () => {
        setState({ sessionCorrect: 5, sessionTotal: 8, mistakeIds: ['x'] });
        jest.spyOn(Math, 'random').mockReturnValue(0.1);
        startLesson(1);
        const s = getState();
        expect(s.sessionCorrect).toBe(0);
        expect(s.sessionTotal).toBe(0);
        expect(s.mistakeIds).toEqual([]);
    });
});

describe('generateQuestions', () => {
    test('generates questions for all items', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.1);
        const questions = generateQuestions(SAMPLE_DATA);
        expect(questions.length).toBe(SAMPLE_DATA.length);
    });

    test('generates select type questions when rand < 0.5', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.1);
        const questions = generateQuestions([SAMPLE_DATA[0]]);
        expect(questions[0].type).toBe('select');
        expect(questions[0].pool.length).toBe(SAMPLE_DATA[0].pool.length);
    });

    test('generates missing type for items with > 2 correct when 0.5 <= rand < 0.75', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.6);
        const questions = generateQuestions([SAMPLE_DATA[0]]);
        expect(questions[0].type).toBe('missing');
        expect(questions[0].shown.length).toBe(SAMPLE_DATA[0].correct.length - 1);
        expect(SAMPLE_DATA[0].correct).toContain(questions[0].missing);
    });

    test('generates truefalse type when rand >= 0.75', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.8);
        const questions = generateQuestions([SAMPLE_DATA[0]]);
        expect(questions[0].type).toBe('truefalse');
        expect(questions[0].ingredient).toBeDefined();
        expect(typeof questions[0].answer).toBe('boolean');
    });

    test('falls back to select when no wrong items for truefalse', () => {
        const item = { name: "X", type: "composition", correct: ["A", "B"], pool: ["A", "B"], info_text: "" };
        // rand >= 0.75 triggers truefalse path, then rand > 0.5 picks isTrue=false,
        // but no wrong items exist, so it falls back to select
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 0.8; // triggers truefalse
            return 0.3; // isTrue = false (0.3 <= 0.5)
        });
        const questions = generateQuestions([item]);
        expect(questions[0].type).toBe('select');
    });

    test('handles empty items', () => {
        const questions = generateQuestions([]);
        expect(questions).toEqual([]);
    });
});

describe('renderLesson', () => {
    beforeEach(() => {
        const questions = [{
            type: 'select',
            item: SAMPLE_DATA[0],
            pool: SAMPLE_DATA[0].pool
        }];
        setState({
            screen: 'lesson',
            questions: questions,
            currentQIdx: 0,
            hearts: 5,
            feedbackShown: false,
            selectedOptions: new Set(),
        });
    });

    test('renders select question UI', () => {
        renderLesson();
        const btns = document.querySelectorAll('.option-btn');
        expect(btns.length).toBe(SAMPLE_DATA[0].pool.length);
    });

    test('renders hearts display', () => {
        renderLesson();
        expect(document.getElementById('hearts-display')).not.toBeNull();
    });

    test('renders progress bar', () => {
        renderLesson();
        expect(document.querySelector('.progress-bar-fill')).not.toBeNull();
    });

    test('shows feedback when feedbackShown is true', () => {
        setState({
            feedbackShown: true,
            _lastItem: SAMPLE_DATA[0],
            _lastCorrect: true,
            questions: [{ type: 'select', item: SAMPLE_DATA[0], pool: SAMPLE_DATA[0].pool }],
            currentQIdx: 0,
            hearts: 5,
        });
        renderLesson();
        expect(document.querySelector('.feedback-banner')).not.toBeNull();
    });

    test('renders missing type question', () => {
        setState({
            questions: [{
                type: 'missing',
                item: SAMPLE_DATA[0],
                shown: ['Ing1', 'Ing2'],
                missing: 'Ing3',
                choices: ['Ing3', 'Ing4', 'Ing5', 'X']
            }],
            currentQIdx: 0,
            hearts: 5,
            feedbackShown: false,
            selectedChoice: null,
        });
        renderLesson();
        expect(document.querySelector('.missing-list')).not.toBeNull();
        expect(document.querySelectorAll('.choice-btn').length).toBe(4);
    });

    test('renders truefalse type question', () => {
        setState({
            questions: [{
                type: 'truefalse',
                item: SAMPLE_DATA[0],
                ingredient: 'Ing1',
                answer: true
            }],
            currentQIdx: 0,
            hearts: 5,
            feedbackShown: false,
        });
        renderLesson();
        expect(document.querySelectorAll('.tf-btn').length).toBe(2);
    });
});

describe('toggleOption', () => {
    beforeEach(() => {
        setState({
            screen: 'lesson',
            questions: [{ type: 'select', item: SAMPLE_DATA[0], pool: SAMPLE_DATA[0].pool }],
            currentQIdx: 0,
            hearts: 5,
            feedbackShown: false,
            selectedOptions: new Set(),
        });
    });

    test('adds option to selected set', () => {
        toggleOption(2);
        expect(getState().selectedOptions.has(2)).toBe(true);
    });

    test('removes option from selected set on second toggle', () => {
        toggleOption(2);
        toggleOption(2);
        expect(getState().selectedOptions.has(2)).toBe(false);
    });

    test('does nothing when feedback is shown', () => {
        setState({ feedbackShown: true });
        toggleOption(0);
        expect(getState().selectedOptions.size).toBe(0);
    });
});

describe('selectChoice', () => {
    test('sets selectedChoice', () => {
        setState({ feedbackShown: false, screen: 'lesson', questions: [{ type: 'missing', item: SAMPLE_DATA[0], shown: [], missing: 'X', choices: ['X', 'Y'] }], currentQIdx: 0, hearts: 5, selectedChoice: null });
        selectChoice(1);
        expect(getState().selectedChoice).toBe(1);
    });

    test('does nothing when feedback is shown', () => {
        setState({ feedbackShown: true, selectedChoice: null });
        selectChoice(0);
        expect(getState().selectedChoice).toBeNull();
    });
});

// ====================== ANSWER CHECKING ======================
describe('checkSelectAnswer', () => {
    test('correct answer processes as correct', () => {
        const q = { type: 'select', item: SAMPLE_DATA[0], pool: ['Ing1', 'Ing2', 'Ing3', 'Ing4', 'Ing5'] };
        setState({
            questions: [q],
            currentQIdx: 0,
            hearts: 5,
            selectedOptions: new Set([0, 1, 2]),
            sessionTotal: 0,
            sessionCorrect: 0,
            sessionXP: 0,
            mistakeIds: [],
            feedbackShown: false,
        });
        checkSelectAnswer();
        expect(getState().sessionCorrect).toBe(1);
        expect(getState()._lastCorrect).toBe(true);
    });

    test('wrong answer processes as incorrect', () => {
        const q = { type: 'select', item: SAMPLE_DATA[0], pool: ['Ing1', 'Ing2', 'Ing3', 'Ing4', 'Ing5'] };
        setState({
            questions: [q],
            currentQIdx: 0,
            hearts: 5,
            selectedOptions: new Set([0, 3]),
            sessionTotal: 0,
            sessionCorrect: 0,
            sessionXP: 0,
            mistakeIds: [],
            feedbackShown: false,
        });
        checkSelectAnswer();
        expect(getState().hearts).toBe(4);
        expect(getState()._lastCorrect).toBe(false);
    });
});

describe('checkMissingAnswer', () => {
    test('correct choice processes as correct', () => {
        const q = { type: 'missing', item: SAMPLE_DATA[0], shown: ['Ing1', 'Ing2'], missing: 'Ing3', choices: ['Ing3', 'Ing4', 'Ing5', 'X'] };
        setState({
            questions: [q],
            currentQIdx: 0,
            hearts: 5,
            selectedChoice: 0,
            sessionTotal: 0,
            sessionCorrect: 0,
            sessionXP: 0,
            mistakeIds: [],
            feedbackShown: false,
        });
        checkMissingAnswer();
        expect(getState().sessionCorrect).toBe(1);
    });

    test('wrong choice processes as incorrect', () => {
        const q = { type: 'missing', item: SAMPLE_DATA[0], shown: ['Ing1', 'Ing2'], missing: 'Ing3', choices: ['Ing3', 'Ing4', 'Ing5', 'X'] };
        setState({
            questions: [q],
            currentQIdx: 0,
            hearts: 5,
            selectedChoice: 1,
            sessionTotal: 0,
            sessionCorrect: 0,
            sessionXP: 0,
            mistakeIds: [],
            feedbackShown: false,
        });
        checkMissingAnswer();
        expect(getState().hearts).toBe(4);
    });
});

describe('checkTFAnswer', () => {
    test('correct true answer', () => {
        const q = { type: 'truefalse', item: SAMPLE_DATA[0], ingredient: 'Ing1', answer: true };
        setState({
            questions: [q],
            currentQIdx: 0,
            hearts: 5,
            sessionTotal: 0,
            sessionCorrect: 0,
            sessionXP: 0,
            mistakeIds: [],
            feedbackShown: false,
        });
        checkTFAnswer(true);
        expect(getState().sessionCorrect).toBe(1);
    });

    test('wrong answer decreases hearts', () => {
        const q = { type: 'truefalse', item: SAMPLE_DATA[0], ingredient: 'Ing1', answer: true };
        setState({
            questions: [q],
            currentQIdx: 0,
            hearts: 5,
            sessionTotal: 0,
            sessionCorrect: 0,
            sessionXP: 0,
            mistakeIds: [],
            feedbackShown: false,
        });
        checkTFAnswer(false);
        expect(getState().hearts).toBe(4);
    });
});

describe('processAnswer', () => {
    beforeEach(() => {
        setState({
            questions: [{ type: 'select', item: SAMPLE_DATA[0], pool: [] }],
            currentQIdx: 0,
            hearts: 5,
            sessionTotal: 0,
            sessionCorrect: 0,
            sessionXP: 0,
            mistakeIds: [],
            feedbackShown: false,
        });
    });

    test('correct answer: adds XP, increments correct count', () => {
        processAnswer(true, SAMPLE_DATA[0]);
        const s = getState();
        expect(s.sessionCorrect).toBe(1);
        expect(s.sessionXP).toBe(10);
        expect(s.sessionTotal).toBe(1);
        expect(s.feedbackShown).toBe(true);
    });

    test('wrong answer: decreases hearts, adds to mistakes', () => {
        processAnswer(false, SAMPLE_DATA[0]);
        const s = getState();
        expect(s.hearts).toBe(4);
        expect(s.mistakeIds).toContain('Dish A');
        expect(s.sessionTotal).toBe(1);
    });

    test('does not add duplicate to mistakeIds', () => {
        setState({ mistakeIds: ['Dish A'] });
        processAnswer(false, SAMPLE_DATA[0]);
        expect(getState().mistakeIds.filter(x => x === 'Dish A').length).toBe(1);
    });

    test('renders feedback when hearts reach 0', () => {
        setState({ hearts: 1 });
        processAnswer(false, SAMPLE_DATA[0]);
        expect(getState().hearts).toBe(0);
        expect(document.querySelector('.feedback-banner')).not.toBeNull();
    });
});

describe('renderFeedback', () => {
    test('shows correct feedback for correct answer', () => {
        setState({
            questions: [{ type: 'select', item: SAMPLE_DATA[0], pool: [] }],
            currentQIdx: 0,
            hearts: 5,
            _lastItem: SAMPLE_DATA[0],
            _lastCorrect: true,
            feedbackShown: true,
        });
        renderFeedback();
        expect(document.querySelector('.feedback-banner.correct')).not.toBeNull();
    });

    test('shows wrong feedback for wrong answer', () => {
        setState({
            questions: [{ type: 'select', item: SAMPLE_DATA[0], pool: [] }],
            currentQIdx: 0,
            hearts: 4,
            _lastItem: SAMPLE_DATA[0],
            _lastCorrect: false,
            feedbackShown: true,
        });
        renderFeedback();
        expect(document.querySelector('.feedback-banner.wrong')).not.toBeNull();
    });

    test('shows correct answer list for wrong answer', () => {
        setState({
            questions: [{ type: 'select', item: SAMPLE_DATA[0], pool: [] }],
            currentQIdx: 0,
            hearts: 4,
            _lastItem: SAMPLE_DATA[0],
            _lastCorrect: false,
            feedbackShown: true,
        });
        renderFeedback();
        const html = document.getElementById('app').innerHTML;
        expect(html).toContain('Ing1');
        expect(html).toContain('Ing2');
    });

    test('shows Results button when hearts are 0', () => {
        setState({
            questions: [{ type: 'select', item: SAMPLE_DATA[0], pool: [] }],
            currentQIdx: 0,
            hearts: 0,
            _lastItem: SAMPLE_DATA[0],
            _lastCorrect: false,
            feedbackShown: true,
        });
        renderFeedback();
        expect(document.querySelector('.feedback-continue-btn').textContent).toContain('Результаты');
    });
});

// ====================== NAVIGATION ======================
describe('nextQuestion', () => {
    test('goes to finishLesson when hearts are 0', () => {
        setState({
            hearts: 0,
            currentQIdx: 0,
            questions: [{ type: 'select', item: SAMPLE_DATA[0], pool: [] }],
            sessionXP: 10,
            sessionCorrect: 1,
            sessionTotal: 2,
            isPractice: false,
            currentLessonIdx: 0,
            section: 'kitchen',
            allData: SAMPLE_DATA,
            mistakeIds: [],
        });
        buildLessons();
        nextQuestion();
        expect(getState().screen).toBe('result');
    });

    test('advances to next question', () => {
        setState({
            hearts: 5,
            currentQIdx: 0,
            questions: [
                { type: 'select', item: SAMPLE_DATA[0], pool: SAMPLE_DATA[0].pool },
                { type: 'select', item: SAMPLE_DATA[1], pool: SAMPLE_DATA[1].pool }
            ],
            feedbackShown: true,
            selectedOptions: new Set([1, 2]),
            selectedChoice: 3,
            screen: 'lesson',
        });
        nextQuestion();
        const s = getState();
        expect(s.currentQIdx).toBe(1);
        expect(s.feedbackShown).toBe(false);
        expect(s.selectedOptions.size).toBe(0);
        expect(s.selectedChoice).toBeNull();
    });

    test('finishes when no more questions', () => {
        setState({
            hearts: 5,
            currentQIdx: 0,
            questions: [{ type: 'select', item: SAMPLE_DATA[0], pool: [] }],
            sessionXP: 10,
            sessionCorrect: 1,
            sessionTotal: 1,
            isPractice: false,
            currentLessonIdx: 0,
            section: 'kitchen',
            allData: SAMPLE_DATA,
            mistakeIds: [],
        });
        buildLessons();
        nextQuestion();
        expect(getState().screen).toBe('result');
    });
});

describe('finishLesson', () => {
    beforeEach(() => {
        setState({
            hearts: 5,
            sessionXP: 30,
            sessionCorrect: 3,
            sessionTotal: 5,
            isPractice: false,
            currentLessonIdx: 0,
            section: 'kitchen',
            allData: generateSampleData(10),
            mistakeIds: [],
        });
        buildLessons();
    });

    test('adds bonus XP when hearts > 0', () => {
        finishLesson();
        expect(getState()._finalXP).toBe(45);
    });

    test('no bonus XP when hearts = 0', () => {
        setState({ hearts: 0 });
        finishLesson();
        expect(getState()._finalXP).toBe(30);
    });

    test('saves lesson complete when not practice and hearts > 0', () => {
        finishLesson();
        const sp = getSectionProgress('kitchen');
        expect(sp.lesson_0.completed).toBe(true);
    });

    test('does not save lesson complete when practice', () => {
        setState({ isPractice: true });
        finishLesson();
        const sp = getSectionProgress('kitchen');
        expect(sp.lesson_0).toBeUndefined();
    });

    test('sets screen to result', () => {
        finishLesson();
        expect(getState().screen).toBe('result');
    });
});

describe('renderResult', () => {
    test('shows accuracy and XP', () => {
        setState({
            sessionCorrect: 8,
            sessionTotal: 10,
            _finalXP: 95,
            mistakeIds: [],
            hearts: 3,
        });
        renderResult();
        const html = document.getElementById('app').innerHTML;
        expect(html).toContain('8');
        expect(html).toContain('95');
    });

    test('shows retry mistakes button when mistakes exist', () => {
        setState({
            sessionCorrect: 3,
            sessionTotal: 5,
            _finalXP: 30,
            mistakeIds: ['Dish A', 'Dish B'],
            hearts: 2,
        });
        renderResult();
        expect(document.getElementById('app').innerHTML).toContain('Повторить ошибки');
    });

    test('hides retry button when no mistakes', () => {
        setState({
            sessionCorrect: 5,
            sessionTotal: 5,
            _finalXP: 65,
            mistakeIds: [],
            hearts: 5,
        });
        renderResult();
        expect(document.getElementById('app').innerHTML).not.toContain('Повторить ошибки');
    });

    test('100% accuracy shows trophy emoji', () => {
        setState({
            sessionCorrect: 5,
            sessionTotal: 5,
            _finalXP: 65,
            mistakeIds: [],
            hearts: 5,
        });
        renderResult();
        expect(document.getElementById('app').innerHTML).toContain('Идеально');
    });
});

describe('returnToPath', () => {
    test('sets screen to path', () => {
        setState({ screen: 'result' });
        returnToPath();
        expect(getState().screen).toBe('path');
    });
});

describe('retryMistakes', () => {
    test('starts practice with mistake items', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.1);
        setState({
            allData: SAMPLE_DATA,
            mistakeIds: ['Dish A', 'Dish C'],
            screen: 'result',
            hearts: 5,
        });
        retryMistakes();
        const s = getState();
        expect(s.isPractice).toBe(true);
        expect(s.screen).toBe('lesson');
        expect(s.questions.length).toBe(2);
    });

    test('returns to path when no mistake items found', () => {
        setState({
            allData: SAMPLE_DATA,
            mistakeIds: ['Nonexistent'],
            screen: 'result',
            section: 'kitchen',
            lessons: [],
        });
        retryMistakes();
        expect(getState().screen).toBe('path');
    });
});

// ====================== QUIT ======================
describe('confirmQuit', () => {
    test('creates modal overlay', () => {
        confirmQuit();
        expect(document.querySelector('.modal-overlay')).not.toBeNull();
    });

    test('modal contains quit text', () => {
        confirmQuit();
        expect(document.querySelector('.modal-content').innerHTML).toContain('Выйти из урока');
    });
});

describe('quitLesson', () => {
    test('removes modal and goes to path', () => {
        setState({ screen: 'lesson', section: 'kitchen', allData: generateSampleData(10) });
        buildLessons();
        confirmQuit();
        quitLesson();
        expect(document.querySelector('.modal-overlay')).toBeNull();
        expect(getState().screen).toBe('path');
    });
});

// ====================== INTEGRATION ======================
describe('integration: full lesson flow', () => {
    test('plays through a lesson with all correct answers', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.1);
        const data = generateSampleData(8);
        setState({ allData: data, section: 'kitchen' });
        buildLessons();
        startLesson(0);

        const s = getState();
        const numQ = s.questions.length;

        for (let i = 0; i < numQ; i++) {
            const q = getState().questions[getState().currentQIdx];
            const correctIndices = [];
            q.pool.forEach((ing, idx) => {
                if (q.item.correct.includes(ing)) correctIndices.push(idx);
            });
            setState({ selectedOptions: new Set(correctIndices) });
            checkSelectAnswer();
            nextQuestion();
        }

        expect(getState().screen).toBe('result');
        expect(getState().sessionCorrect).toBe(numQ);
        expect(getState().hearts).toBe(5);
    });

    test('game over when all answers wrong', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.1);
        const data = generateSampleData(8);
        setState({ allData: data, section: 'kitchen' });
        buildLessons();
        startLesson(0);

        for (let i = 0; i < 5; i++) {
            setState({ selectedOptions: new Set([4]) });
            checkSelectAnswer();
            if (getState().hearts > 0) {
                nextQuestion();
            }
        }

        expect(getState().hearts).toBe(0);
    });
});
