<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ТТК Duolingo</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Roboto, sans-serif; }
        body { background-color: #f0f2f5; display: flex; justify-content: center; min-height: 100vh; padding: 15px; }
        .app-container { background: white; width: 100%; max-width: 450px; border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.1); padding: 20px; display: flex; flex-direction: column; position: relative; }
        .progress-container { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
        .close-btn { font-size: 24px; color: #afafaf; cursor: pointer; border: none; background: none; }
        .progress-bar { background: #e5e5e5; height: 16px; flex-grow: 1; border-radius: 10px; overflow: hidden; }
        .progress-fill { background: #58cc02; height: 100%; width: 0%; transition: width 0.3s ease; border-radius: 10px; }
        .question-title { font-size: 20px; font-weight: bold; color: #3c3c3c; margin-bottom: 10px; text-align: center; }
        .dish-name { font-size: 22px; color: #1cb0f6; font-weight: 800; text-align: center; margin-bottom: 25px; }
        .preview-zone { min-height: 100px; border: 2px dashed #ccc; border-radius: 15px; padding: 15px; margin-bottom: 25px; display: flex; flex-direction: column; gap: 8px; background: #fafafa; }
        .preview-item { background: #e1f5fe; color: #0288d1; padding: 8px 12px; border-radius: 10px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; border: 1px solid #b3e5fc; font-size: 15px; }
        .ingredients-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: auto; }
        .ing-btn { background: white; border: 2px solid #e5e5e5; border-bottom: 4px solid #e5e5e5; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: bold; color: #4b4b4b; cursor: pointer; transition: all 0.1s; text-align: center; }
        .ing-btn:active { border-bottom-width: 2px; transform: translateY(2px); }
        .ing-btn.selected { background: #edeff2; border-color: #d3d3d3; color: #bcc3cd; border-bottom-width: 2px; transform: translateY(2px); pointer-events: none; }
        .check-panel { margin-top: 30px; }
        .main-action-btn { width: 100%; background: #58cc02; border: none; border-bottom: 4px solid #46a302; color: white; padding: 16px; border-radius: 14px; font-size: 18px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 0.8px; }
        .main-action-btn:active { border-bottom-width: 0px; transform: translateY(4px); }
        .main-action-btn:disabled { background: #e5e5e5; border-bottom: 4px solid #ccc; color: #afafaf; cursor: not-allowed; }
        .result-screen { display: none; position: absolute; bottom: 0; left: 0; right: 0; background: white; border-top-left-radius: 20px; border-top-right-radius: 20px; padding: 25px; box-shadow: 0 -8px 24px rgba(0,0,0,0.15); animation: slideUp 0.3s ease-out; }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .result-status { font-size: 24px; font-weight: bold; margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
        .result-status.success { color: #58cc02; }
        .result-status.error { color: #ea2b2b; }
        .result-details { font-size: 15px; color: #666; margin-bottom: 20px; line-height: 1.5; white-space: pre-line; }
    </style>
</head>
<body>

<div class="app-container">
    <div class="progress-container">
        <button class="close-btn" onclick="location.reload()">×</button>
        <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
    </div>

    <div class="question-title">Собери по порядку ингредиенты для:</div>
    <div class="dish-name" id="dish-title">Загрузка...</div>

    <div class="preview-zone" id="preview-zone"></div>
    <div class="ingredients-grid" id="ingredients-grid"></div>

    <div class="check-panel">
        <button class="main-action-btn" id="action-btn" disabled onclick="checkAnswer()">Проверить</button>
    </div>

    <div class="result-screen" id="result-screen">
        <div class="result-status" id="result-status"></div>
        <div class="result-details" id="result-details"></div>
        <button class="main-action-btn" id="next-btn" onclick="nextQuestion()">Дальше</button>
    </div>
</div>

<script>
    let DISHES_DB = [];
    let currentQuestionIndex = 0;
    let selectedIngredients = [];

    // Загрузка вопросов из отдельного файла
    async function loadDishes() {
        try {
            const response = await fetch('dishes.json');
            DISHES_DB = await response.json();
            initQuestion();
        } catch (error) {
            document.getElementById('dish-title').innerText = "Ошибка загрузки ТТК 😢";
            console.error(error);
        }
    }

    function shuffle(array) {
        return array.sort(() => Math.random() - 0.5);
    }

    function initQuestion() {
        if (!DISHES_DB.length) return;
        if (currentQuestionIndex >= DISHES_DB.length) {
            currentQuestionIndex = 0;
        }

        const dish = DISHES_DB[currentQuestionIndex];
        selectedIngredients = [];
        
        const progressPercent = (currentQuestionIndex / DISHES_DB.length) * 100;
        document.getElementById('progress').style.width = `${progressPercent}%`;

        document.getElementById('dish-title').innerText = dish.name;
        document.getElementById('result-screen').style.display = 'none';
        document.getElementById('action-btn').disabled = true;
        
        renderPreview();

        const grid = document.getElementById('ingredients-grid');
        grid.innerHTML = '';
        const shuffledPool = shuffle([...dish.pool]);
        
        shuffledPool.forEach(ing => {
            const btn = document.createElement('button');
            btn.className = 'ing-btn';
            btn.innerText = ing;
            btn.onclick = () => selectIngredient(ing, btn);
            grid.appendChild(btn);
        });
    }

    function selectIngredient(ing, btn) {
        selectedIngredients.push(ing);
        btn.classList.add('selected');
        btn.innerText += " ✅";
        document.getElementById('action-btn').disabled = false;
        renderPreview();
    }

    function renderPreview() {
        const zone = document.getElementById('preview-zone');
        zone.innerHTML = '';
        if (selectedIngredients.length === 0) {
            zone.innerHTML = '<span style="color:#aaa; text-align:center; font-size:14px; margin:auto;">Нажимай на ингредиенты ниже...</span>';
            return;
        }
        selectedIngredients.forEach((ing, index) => {
            const item = document.createElement('div');
            item.className = 'preview-item';
            item.innerHTML = `<span>${index + 1}. ${ing}</span>`;
            zone.appendChild(item);
        });
    }

    function checkAnswer() {
        const dish = DISHES_DB[currentQuestionIndex];
        const isCorrect = JSON.stringify(selectedIngredients) === JSON.stringify(dish.correct);
        const screen = document.getElementById('result-screen');
        const status = document.getElementById('result-status');
        const details = document.getElementById('result-details');
        const nextBtn = document.getElementById('next-btn');

        screen.style.display = 'block';

        if (isCorrect) {
            status.className = 'result-status success';
            status.innerText = '🎉 Потрясающе!';
            details.innerText = 'Вы абсолютно верно воспроизвели рецептуру блюда по ТТК.';
            nextBtn.style.background = '#58cc02';
            nextBtn.style.borderBottom = '4px solid #46a302';
            currentQuestionIndex++;
        } else {
            status.className = 'result-status error';
            status.innerText = '❌ Ошибка в рецепте';
            details.innerText = `Вы нарушили порядок или состав.\n\n${dish.recipe_text}`;
            nextBtn.style.background = '#ea2b2b';
            nextBtn.style.borderBottom = '4px solid #b31e1e';
        }
    }

    function nextQuestion() {
        initQuestion();
    }

    // Запуск
    loadDishes();
</script>
</body>
</html>
