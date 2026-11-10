import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

describe('Task Import Studio — Phase 2: Acceptance Sandbox & Didactic Quality Verification', () => {
    let dom;
    let window;
    let document;
    let Studio;

    const ruLocalePath = path.resolve(process.cwd(), 'frontend/assets/locales/ru.json');
    const ruLocale = JSON.parse(fs.readFileSync(ruLocalePath, 'utf-8'));

    function resolveTranslation(key, fallback) {
        const parts = key.split('.');
        let cur = ruLocale;
        for (const p of parts) {
            if (cur && typeof cur === 'object' && p in cur) {
                cur = cur[p];
            } else {
                return fallback || key;
            }
        }
        return typeof cur === 'string' ? cur : (fallback || key);
    }

    beforeEach(() => {
        const htmlPath = path.resolve(process.cwd(), 'frontend/Editor/Task_Import_Studio.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

        dom = new JSDOM(htmlContent, {
            url: 'http://localhost/frontend/Editor/Task_Import_Studio.html',
            runScripts: 'outside-only',
        });

        window = dom.window;
        document = window.document;
        global.window = window;
        global.document = document;

        window.__ACTRA_DEV_MODE__ = true;
        window.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, sessions: [], modules: [] }),
            text: async () => '',
        });
        global.fetch = window.fetch;

        window.i18n = {
            t: (key, fallback) => resolveTranslation(key, fallback),
            getLang: () => 'ru',
        };

        const jsPath = path.resolve(process.cwd(), 'frontend/Editor/task_import_studio.js');
        const jsCode = fs.readFileSync(jsPath, 'utf-8');
        dom.window.eval(jsCode);
        document.dispatchEvent(new window.Event('DOMContentLoaded'));

        Studio = window.__StudioInternal;
    });

    it('initializes preview modal with inspect mode and Level 1 by default', () => {
        const testTask = {
            _studio_id: 'test-1',
            type: 'TEST',
            question: 'Каков основной рентгенологический признак ателектаза?',
            options: [
                { text: 'Смещение средостения в сторону поражения', is_correct: true },
                { text: 'Просветление легочного поля', is_correct: false },
            ],
            explanation: 'При ателектазе объем легкого уменьшается.',
        };

        Studio.StudioState.allTasks = [testTask];
        Studio.openTaskPreviewModal(testTask, 0);

        expect(Studio.getSandboxMode()).toBe('inspect');
        expect(Studio.getSandboxLevel()).toBe(1);

        const btnInspect = document.getElementById('btn-sandbox-mode-inspect');
        const btnSolve = document.getElementById('btn-sandbox-mode-solve');
        const btnL1 = document.getElementById('btn-sandbox-level-1');

        expect(btnInspect.classList.contains('studio-seg-btn--active')).toBe(true);
        expect(btnSolve.classList.contains('studio-seg-btn--active')).toBe(false);
        expect(btnL1.classList.contains('studio-seg-btn--active')).toBe(true);

        const container = document.getElementById('task-preview-content-container');
        expect(container.textContent).toContain('Каков основной рентгенологический признак ателектаза?');
        expect(container.textContent).toContain('Смещение средостения в сторону поражения');
    });

    it('switches between Inspect and Solve mode and updates toolbar styles', () => {
        const testTask = {
            _studio_id: 'test-1',
            type: 'TEST',
            question: 'Укажите норму сердечно-легочного индекса:',
            options: [
                { text: 'Менее 50%', is_correct: true },
                { text: 'Более 70%', is_correct: false },
            ],
        };

        Studio.StudioState.allTasks = [testTask];
        Studio.openTaskPreviewModal(testTask, 0);

        const btnSolve = document.getElementById('btn-sandbox-mode-solve');
        btnSolve.click();

        expect(Studio.getSandboxMode()).toBe('solve');
        expect(btnSolve.classList.contains('studio-seg-btn--active')).toBe(true);

        const container = document.getElementById('task-preview-content-container');
        expect(container.querySelector('#btn-sandbox-check-answer')).toBeTruthy();
        expect(container.querySelectorAll('.sandbox-choice-card').length).toBe(2);

        const btnInspect = document.getElementById('btn-sandbox-mode-inspect');
        btnInspect.click();

        expect(Studio.getSandboxMode()).toBe('inspect');
        expect(btnInspect.classList.contains('studio-seg-btn--active')).toBe(true);
    });

    it('transforms TEST into open text input mode on Level 2 difficulty', () => {
        const testTask = {
            _studio_id: 'test-l2',
            type: 'TEST',
            question: 'Симптом глубокого борозды характерен для:',
            options: [
                { text: 'Пневмоторакс', is_correct: true },
                { text: 'Пневмония', is_correct: false },
            ],
        };

        Studio.StudioState.allTasks = [testTask];
        Studio.openTaskPreviewModal(testTask, 0);
        Studio.setSandboxMode('solve');

        // Level 1 has choice cards
        let container = document.getElementById('task-preview-content-container');
        expect(container.querySelectorAll('.sandbox-choice-card').length).toBe(2);
        expect(container.querySelector('#sandbox-test-text-input')).toBeNull();

        // Switch to Level 2
        const btnL2 = document.getElementById('btn-sandbox-level-2');
        btnL2.click();

        expect(Studio.getSandboxLevel()).toBe(2);
        container = document.getElementById('task-preview-content-container');
        expect(container.querySelectorAll('.sandbox-choice-card').length).toBe(0);
        expect(container.querySelector('#sandbox-test-text-input')).toBeTruthy();
        expect(container.textContent).toContain(resolveTranslation('studio.sandbox.level_note_test_l2'));
    });

    it('renders didactic quality badges with defect for tasks missing standard answer or correct options', () => {
        const brokenTask = {
            _studio_id: 'bad-1',
            type: 'TEST',
            question: 'Вопрос без правильного ответа',
            options: [
                { text: 'Неверно 1', is_correct: false },
                { text: 'Неверно 2', is_correct: false },
            ],
        };

        Studio.StudioState.allTasks = [brokenTask];
        Studio.openTaskPreviewModal(brokenTask, 0);

        const badgesContainer = document.getElementById('sandbox-quality-badges');
        expect(badgesContainer.textContent).toContain(resolveTranslation('studio.sandbox.audit_defect'));
        expect(badgesContainer.textContent).toContain(resolveTranslation('studio.sandbox.badge_no_correct'));

        const validTask = {
            _studio_id: 'good-1',
            type: 'OPEN_ANSWER',
            prompt: 'Опишите характер изменений при гидротораксе:',
            standard_answer: 'Гомогенное затемнение с косой верхней границей по линии Дамуазо.',
            keywords: ['гомогенное затемнение', 'Дамуазо', 'синус'],
            hint: 'Вспомните классическую границу выпота.',
        };

        Studio.StudioState.allTasks = [validTask];
        Studio.openTaskPreviewModal(validTask, 0);

        expect(badgesContainer.textContent).toContain(resolveTranslation('studio.sandbox.audit_valid'));
        expect(badgesContainer.textContent).toContain(resolveTranslation('studio.sandbox.badge_std_present'));
        expect(badgesContainer.textContent).toContain(resolveTranslation('studio.sandbox.badge_keywords_count').replace('{count}', '3'));
        expect(badgesContainer.textContent).toContain(resolveTranslation('studio.sandbox.badge_hint_present'));
    });

    it('evaluates interactive TEST answering correctly and incorrectly in Level 1', () => {
        const testTask = {
            _studio_id: 'test-eval',
            type: 'TEST',
            question: 'Выберите признак напряженного пневмоторакса:',
            options: [
                { text: 'Смещение органов средостения в противоположную сторону', is_correct: true },
                { text: 'Сужение межреберных промежутков', is_correct: false },
            ],
        };

        Studio.StudioState.allTasks = [testTask];
        Studio.openTaskPreviewModal(testTask, 0);
        Studio.setSandboxMode('solve');

        const container = document.getElementById('task-preview-content-container');
        const cards = container.querySelectorAll('.sandbox-choice-card');

        // Select correct option (card 0)
        cards[0].click();
        const checkBtnAfterClick = document.getElementById('btn-sandbox-check-answer');
        checkBtnAfterClick.click();

        const resultBox = document.getElementById('sandbox-eval-result');
        expect(resultBox).toBeTruthy();
        expect(resultBox.textContent).toContain('100%');
        expect(resultBox.textContent).toContain(resolveTranslation('studio.sandbox.verdict_correct_short'));

        // Select incorrect option (card 1)
        const updatedCards = document.querySelectorAll('.sandbox-choice-card');
        updatedCards[1].click();
        document.getElementById('btn-sandbox-check-answer').click();

        const resultBoxBad = document.getElementById('sandbox-eval-result');
        expect(resultBoxBad.textContent).toContain('0%');
        expect(resultBoxBad.textContent).toContain(resolveTranslation('studio.sandbox.verdict_incorrect_short'));
    });

    it('evaluates interactive OPEN_ANSWER keyword matching with partial score breakdown', () => {
        const openTask = {
            _studio_id: 'open-eval',
            type: 'OPEN_ANSWER',
            prompt: 'Диагностические критерии острой пневмонии на КТ:',
            standard_answer: 'Участок консолидации легочной паренхимы с симптомом воздушной бронхографии.',
            keywords: ['консолидации', 'бронхографии'],
        };

        Studio.StudioState.allTasks = [openTask];
        Studio.openTaskPreviewModal(openTask, 0);
        Studio.setSandboxMode('solve');

        // Paste standard preset
        const pasteStdBtn = document.getElementById('btn-sandbox-paste-std');
        expect(pasteStdBtn).toBeTruthy();
        pasteStdBtn.click();

        const checkBtn = document.getElementById('btn-sandbox-check-answer');
        checkBtn.click();

        let resultBox = document.getElementById('sandbox-eval-result');
        expect(resultBox.textContent).toContain('100%');
        expect(resultBox.textContent).toContain(resolveTranslation('studio.sandbox.verdict_correct_short'));

        const contentContainer = document.getElementById('task-preview-content-container');
        expect(contentContainer.textContent).toContain('консолидации');
        expect(contentContainer.textContent).toContain('бронхографии');

        // Test partial keyword matching
        const state = Studio.getSandboxSolveState();
        state.textInput = 'Выявлена зона консолидации в нижней доле.';
        state.isEvaluated = false;
        Studio.evaluateSandboxAnswer(openTask, openTask, 'OPEN_ANSWER');

        expect(state.score).toBe(50);
        expect(state.status).toBe('partial');
        expect(state.matchedKeywords).toContain('консолидации');
        expect(state.missingKeywords).toContain('бронхографии');
    });

    it('allows reordering and evaluating steps in SEQUENCE simulator', () => {
        const seqTask = {
            _studio_id: 'seq-eval',
            type: 'SEQUENCE',
            prompt: 'Порядок проведения рентгенографии органов грудной клетки:',
            items: [
                '1. Инструктаж пациента по задержке дыхания',
                '2. Установка кассеты на уровне верхушек легких',
                '3. Экспозиция на глубоком вдохе',
            ],
        };

        Studio.StudioState.allTasks = [seqTask];
        Studio.openTaskPreviewModal(seqTask, 0);
        Studio.setSandboxMode('solve');

        const state = Studio.getSandboxSolveState();
        expect(state.steps.length).toBe(3);

        // Preset correct order
        const btnCorrect = document.getElementById('btn-sandbox-preset-correct');
        btnCorrect.click();

        const checkBtn = document.getElementById('btn-sandbox-check-answer');
        checkBtn.click();

        const resultBox = document.getElementById('sandbox-eval-result');
        expect(resultBox.textContent).toContain('100%');
        expect(resultBox.textContent).toContain(resolveTranslation('studio.sandbox.verdict_correct_short'));
    });

    it('navigates to Stage 2 with loaded task type when clicking Edit in Step 2', () => {
        const testTask = {
            _studio_id: 'jump-task',
            type: 'OPEN_ANSWER',
            prompt: 'Симптом «матового стекла» при вирусных пневмониях',
            standard_answer: 'Снижение прозрачности с сохранением визуализации сосудов.',
        };

        Studio.StudioState.selectedTopicId = 'topic-123';
        Studio.StudioState.allTasks = [testTask];
        Studio.openTaskPreviewModal(testTask, 0);

        const btnEditSource = document.getElementById('btn-preview-edit-source');
        expect(btnEditSource).toBeTruthy();

        btnEditSource.click();

        // Preview modal should close
        const modal = document.getElementById('modal-task-preview');
        expect(modal.classList.contains('hidden')).toBe(true);

        // Stage 2 should become active
        const stage2 = document.getElementById('stage-2');
        expect(stage2.getAttribute('data-active')).toBe('true');
    });
});
