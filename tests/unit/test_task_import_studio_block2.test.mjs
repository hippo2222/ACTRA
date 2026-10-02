import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

describe('Task Import Studio — Block 2 (Card Expansion & Full Task Preview Modal)', () => {
    let dom;
    let window;
    let document;
    let Studio;

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
            t: (key, fallback) => {
                const dict = {
                    'studio.task_types.test': 'Тест',
                    'studio.task_types.open_answer': 'Открытый ответ',
                    'studio.task_types.sequence': 'Последовательность',
                    'studio.task_types.click_text': 'Контрастные утверждения',
                    'studio.task_types.click_words': 'Поиск ошибок в тексте',
                    'studio.task_types.click': 'Клик по изображению',
                    'studio.task_types.draw': 'Рисование',
                    'studio.stage3.group_test': 'Тестовые задания',
                    'studio.stage3.group_open_answer': 'Задания с открытым ответом',
                    'studio.stage3.group_sequence': 'Последовательности',
                    'studio.stage3.group_click_words': 'Поиск ошибок в тексте',
                    'studio.stage3.group_click_text': 'Контрастные утверждения',
                    'studio.stage3.group_visual': 'Интерактивные задания на изображениях',
                    'studio.stage3.group_other': 'Другие задания',
                    'studio.stage3.more_options_fmt': 'ещё {n} вар.',
                    'studio.stage3.more_steps_fmt': 'ещё {n} шаг.',
                    'studio.stage3.more_targets_fmt': 'ещё {n}',
                    'studio.stage3.collapse': 'Свернуть',
                    'studio.stage3.expand_text': 'Читать полностью',
                    'studio.stage3.preview_task': 'Просмотр задания',
                    'studio.modal.preview_title': 'Просмотр задания',
                    'studio.modal.preview_prev': 'Предыдущее задание',
                    'studio.modal.preview_next': 'Следующее задание',
                    'studio.modal.preview_select_for_import': 'Включить в импорт',
                    'studio.modal.preview_toggle_raw': 'JSON / Спецификация',
                    'studio.stage3.modal_prompt_label': 'Текст вопроса / задание:',
                    'studio.stage3.modal_options_label': 'Варианты ответов:',
                    'studio.stage3.correct_answer_badge': 'Правильный ответ',
                    'studio.stage3.standard_answer': 'Эталонный ответ:',
                    'studio.stage3.criteria_label': 'Критерии проверки:',
                    'studio.stage3.sequence_steps_label': 'Правильный порядок шагов:',
                    'studio.stage3.error_text_title': 'Клинический текст с ошибками:',
                    'studio.stage3.error_fragments_label': 'Ошибочные фрагменты (цели клика):',
                    'studio.stage3.statements_label': 'Утверждения (верные и мифы):',
                    'studio.stage3.true_statement': 'Верно',
                    'studio.stage3.false_statement': 'Ложь / Миф',
                    'studio.stage3.visual_image_note': 'Графическая подложка размечается в интерактивном редакторе.',
                    'studio.stage3.targets_label': 'Ориентиры / цели:',
                    'studio.stage3.explanation_label': 'Методическое пояснение:',
                    'studio.stage3.raw_spec_title': 'Спецификация задания (JSON):',
                    'studio.stage3.errors_count_fmt': 'Ошибок: {count}',
                    'studio.stage3.errors_phrases_and_words_fmt': 'Ошибок: {phrases} фрагм. ({words} сл.)',
                };
                return dict[key] || fallback || key;
            },
            getLang: () => 'ru',
        };

        const jsPath = path.resolve(process.cwd(), 'frontend/Editor/task_import_studio.js');
        const jsCode = fs.readFileSync(jsPath, 'utf-8');

        // Execute JS in the JSDOM window context
        dom.window.eval(jsCode);

        // Dispatch DOMContentLoaded to trigger app initialization
        document.dispatchEvent(new window.Event('DOMContentLoaded'));

        Studio = window.__StudioInternal;
    });

    it('expands and collapses TEST options snippet in showcase card', () => {
        const testTask = {
            type: 'test',
            _studio_id: 't_test1',
            _selected_for_import: true,
            data: {
                prompt: 'Каковы первые признаки септического шока?',
                options: [
                    { text: 'Гипотензия', is_correct: true },
                    { text: 'Тахикардия', is_correct: false },
                    { text: 'Олигурия', is_correct: false },
                    { text: 'Гипертермия', is_correct: false },
                    { text: 'Спутанность сознания', is_correct: false },
                ]
            }
        };

        const card = Studio.createShowcaseTaskCard(testTask, 0);
        document.body.appendChild(card);

        const extraOpts = card.querySelector('.task-extra-options');
        expect(extraOpts).not.toBeNull();
        expect(extraOpts.classList.contains('hidden')).toBe(true);

        const expandBtn = card.querySelector('.btn-expand-snippet');
        expect(expandBtn).not.toBeNull();
        expect(expandBtn.textContent).toContain('ещё 2 вар.');

        // Expand
        expandBtn.click();
        expect(extraOpts.classList.contains('hidden')).toBe(false);
        expect(expandBtn.textContent).toContain('Свернуть');
        expect(expandBtn.querySelector('.material-symbols-outlined').textContent).toBe('expand_less');

        // Collapse
        expandBtn.click();
        expect(extraOpts.classList.contains('hidden')).toBe(true);
        expect(expandBtn.textContent).toContain('ещё 2 вар.');
        expect(expandBtn.querySelector('.material-symbols-outlined').textContent).toBe('expand_more');
    });

    it('expands and collapses SEQUENCE steps snippet in showcase card', () => {
        const seqTask = {
            type: 'sequence',
            _studio_id: 't_seq1',
            _selected_for_import: true,
            data: {
                prompt: 'Укажите алгоритм первичной сердечно-лёгочной реанимации:',
                items: ['Безопасность', 'Оценка сознания', 'Вызов помощи', 'Компрессии грудной клетки', 'ИВЛ']
            }
        };

        const card = Studio.createShowcaseTaskCard(seqTask, 0);
        document.body.appendChild(card);

        const extraSteps = card.querySelector('.task-extra-steps');
        expect(extraSteps).not.toBeNull();
        expect(extraSteps.classList.contains('hidden')).toBe(true);

        const expandBtn = card.querySelector('.btn-expand-snippet');
        expect(expandBtn).not.toBeNull();
        expect(expandBtn.textContent).toContain('ещё 2 шаг.');

        // Expand
        expandBtn.click();
        expect(extraSteps.classList.contains('hidden')).toBe(false);
        expect(expandBtn.textContent).toContain('Свернуть');

        // Collapse
        expandBtn.click();
        expect(extraSteps.classList.contains('hidden')).toBe(true);
        expect(expandBtn.textContent).toContain('ещё 2 шаг.');
    });

    it('expands and collapses long CLICK_WORDS clinical text line-clamp in showcase card', () => {
        const longText = 'Пациент поступил в приёмное отделение с выраженными признаками дыхательной недостаточности. При аускультации слева дыхание резко ослаблено, перкуторно тимпанический звук. Рентгенография органов грудной клетки выявила смещение средостения вправо.';
        const wordsTask = {
            type: 'click',
            _studio_id: 't_words1',
            _selected_for_import: true,
            data: {
                mode: 'text_errors',
                text: longText,
                error_spans: [{ start: 60, end: 90, is_correct: false }]
            }
        };

        const card = Studio.createShowcaseTaskCard(wordsTask, 0);
        document.body.appendChild(card);

        const snippet = card.querySelector('.task-text-snippet');
        expect(snippet).not.toBeNull();
        expect(snippet.classList.contains('line-clamp-3')).toBe(true);

        const expandBtn = card.querySelector('.btn-expand-text');
        expect(expandBtn).not.toBeNull();
        expect(expandBtn.textContent).toContain('Читать полностью');

        // Expand
        expandBtn.click();
        expect(snippet.classList.contains('line-clamp-3')).toBe(false);
        expect(expandBtn.textContent).toContain('Свернуть');

        // Collapse
        expandBtn.click();
        expect(snippet.classList.contains('line-clamp-3')).toBe(true);
        expect(expandBtn.textContent).toContain('Читать полностью');
    });

    it('opens preview modal when clicking visibility button or card title', () => {
        const testTask = {
            type: 'test',
            _studio_id: 't_test1',
            _selected_for_import: true,
            data: {
                prompt: 'Какой препарат первого ряда при анафилаксии?',
                options: [
                    { text: 'Эпинефрин (адреналин)', is_correct: true },
                    { text: 'Преднизолон', is_correct: false }
                ]
            }
        };

        Studio.StudioState.allTasks = [testTask];
        const card = Studio.createShowcaseTaskCard(testTask, 0);
        document.body.appendChild(card);

        const modal = document.getElementById('modal-task-preview');
        expect(modal.classList.contains('hidden')).toBe(true);

        // Click eye button
        const previewBtn = card.querySelector('.btn-preview-task');
        expect(previewBtn).not.toBeNull();
        previewBtn.click();

        expect(modal.classList.contains('hidden')).toBe(false);
        expect(Studio.getCurrentPreviewIndex()).toBe(0);

        // Close modal
        Studio.closeTaskPreviewModal();
        expect(modal.classList.contains('hidden')).toBe(true);

        // Click card title
        const titleEl = card.querySelector('.studio-task-card-title');
        expect(titleEl).not.toBeNull();
        titleEl.click();

        expect(modal.classList.contains('hidden')).toBe(false);
        expect(Studio.getCurrentPreviewIndex()).toBe(0);
    });

    it('navigates between tasks with prev/next buttons and clamps out of bound indices', () => {
        const task1 = { type: 'test', _studio_id: 't1', data: { prompt: 'Вопрос 1' } };
        const task2 = { type: 'open_answer', _studio_id: 't2', data: { prompt: 'Вопрос 2', standard_answer: 'Ответ 2' } };
        const task3 = { type: 'sequence', _studio_id: 't3', data: { prompt: 'Вопрос 3', items: ['Шаг A', 'Шаг B'] } };

        Studio.StudioState.allTasks = [task1, task2, task3];

        Studio.openTaskPreviewModal(task1, 0);

        const prevBtn = document.getElementById('btn-preview-prev-task');
        const nextBtn = document.getElementById('btn-preview-next-task');
        const counter = document.getElementById('preview-task-counter');

        expect(counter.textContent).toBe('1 / 3');
        expect(prevBtn.disabled).toBe(true);
        expect(nextBtn.disabled).toBe(false);

        // Next to task 2
        nextBtn.click();
        expect(Studio.getCurrentPreviewIndex()).toBe(1);
        expect(counter.textContent).toBe('2 / 3');
        expect(prevBtn.disabled).toBe(false);
        expect(nextBtn.disabled).toBe(false);

        // Next to task 3
        nextBtn.click();
        expect(Studio.getCurrentPreviewIndex()).toBe(2);
        expect(counter.textContent).toBe('3 / 3');
        expect(prevBtn.disabled).toBe(false);
        expect(nextBtn.disabled).toBe(true);

        // Prev back to task 2
        prevBtn.click();
        expect(Studio.getCurrentPreviewIndex()).toBe(1);
        expect(counter.textContent).toBe('2 / 3');

        // Test index clamping
        Studio.openTaskPreviewModal(null, 100);
        expect(Studio.getCurrentPreviewIndex()).toBe(2);

        Studio.openTaskPreviewModal(null, -5);
        expect(Studio.getCurrentPreviewIndex()).toBe(0);
    });

    it('renders rich preview for CLICK_TEXT with true/false statement badges', () => {
        const clickTextTask = {
            type: 'click',
            _studio_id: 't_ct1',
            data: {
                mode: 'text_choice',
                prompt: 'Выберите утверждения о лечении анафилаксии:',
                options: [
                    { text: 'Эпинефрин вводится внутримышечно в бедро', is_correct: true },
                    { text: 'Антигистаминные заменяют адреналин при лёгких симптомах', is_correct: false },
                ]
            }
        };

        Studio.StudioState.allTasks = [clickTextTask];
        Studio.openTaskPreviewModal(clickTextTask, 0);

        const container = document.getElementById('task-preview-content-container');
        expect(container.innerHTML).toContain('Эпинефрин вводится внутримышечно в бедро');
        expect(container.innerHTML).toContain('Антигистаминные заменяют адреналин при лёгких симптомах');
        expect(container.innerHTML).toContain('check_circle');
        expect(container.innerHTML).toContain('Верно');
        expect(container.innerHTML).toContain('cancel');
        expect(container.innerHTML).toContain('Ложь / Миф');
    });

    it('renders rich preview for CLICK_WORDS with highlighted error spans and fragments list', () => {
        const text = 'У пациента с гипертоническим кризом систолическое давление снижено до 60 мм рт. ст.';
        const targetWord = 'снижено';
        const startIdx = text.indexOf(targetWord);
        const endIdx = startIdx + targetWord.length;

        const wordsTask = {
            type: 'click',
            _studio_id: 't_cw1',
            data: {
                mode: 'text_errors',
                prompt: 'Найдите ошибки в анамнезе:',
                text: text,
                error_spans: [{ start: startIdx, end: endIdx, is_correct: false }]
            }
        };

        Studio.StudioState.allTasks = [wordsTask];
        Studio.openTaskPreviewModal(wordsTask, 0);

        const container = document.getElementById('task-preview-content-container');
        expect(container.innerHTML).toContain('<mark class="bg-amber-500/20');
        expect(container.innerHTML).toContain('снижено');
        expect(container.innerHTML).toContain('Ошибочные фрагменты (цели клика):');
    });

    it('toggles raw JSON spec view and back to rich preview', () => {
        const task = {
            type: 'test',
            _studio_id: 't_spec1',
            data: { prompt: 'Тестовый вопрос', options: [{ text: 'А', is_correct: true }] }
        };

        Studio.StudioState.allTasks = [task];
        Studio.openTaskPreviewModal(task, 0);

        const toggleBtn = document.getElementById('btn-preview-toggle-raw');
        const container = document.getElementById('task-preview-content-container');

        // Toggle to raw JSON
        toggleBtn.click();
        expect(container.querySelector('pre')).not.toBeNull();
        expect(container.innerHTML).toContain('Спецификация задания (JSON):');
        expect(container.innerHTML).toContain('Тестовый вопрос');
        expect(toggleBtn.classList.contains('studio-btn--primary')).toBe(true);

        // Toggle back to rich preview
        toggleBtn.click();
        expect(container.querySelector('pre')).toBeNull();
        expect(container.innerHTML).toContain('Текст вопроса / задание:');
        expect(toggleBtn.classList.contains('studio-btn--secondary')).toBe(true);
    });

    it('synchronizes modal import selection checkbox with task state', () => {
        const task = {
            type: 'test',
            _studio_id: 't_sel1',
            _selected_for_import: true,
            data: { prompt: 'Вопрос' }
        };

        Studio.StudioState.allTasks = [task];
        Studio.openTaskPreviewModal(task, 0);

        const cb = document.getElementById('preview-task-select-checkbox');
        expect(cb.checked).toBe(true);

        // Uncheck
        cb.checked = false;
        cb.dispatchEvent(new window.Event('change'));
        expect(task._selected_for_import).toBe(false);

        // Check again
        cb.checked = true;
        cb.dispatchEvent(new window.Event('change'));
        expect(task._selected_for_import).toBe(true);
    });

    it('snaps mid-word clusters to full word boundaries in CLICK_WORDS', () => {
        const text = 'У пациента выраженная легочная гипертензия.';
        // 'легочная' is at [21, 29]
        // Simulate AI returning mid-word indices [23, 27] ('гочн')
        const midWordClusters = [{ start: 23, end: 27 }];
        const snapped = Studio.snapClustersToWordBoundaries(text, midWordClusters);

        expect(snapped.length).toBe(1);
        expect(snapped[0].start).toBe(22);
        expect(snapped[0].end).toBe(30);
        expect(text.slice(snapped[0].start, snapped[0].end)).toBe('легочная');

        const html = Studio.highlightErrorSpansInText(text, midWordClusters);
        expect(html).toContain('<mark class="bg-amber-500/20 text-amber-900 dark:text-amber-200 px-0.5 rounded font-semibold underline decoration-amber-500/40">легочная</mark>');
        expect(html).not.toContain('ле<mark');
    });
});
