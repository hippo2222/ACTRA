import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

describe('Task Import Studio — Block 3 & 4 (Serialization, State Sync & Stage 2 Draft Restoration)', () => {
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
                    'studio.stage2.committed_view_title': 'Задания успешно приняты в витрину ({count})',
                    'studio.stage2.type_quote_fmt': 'типа «{type}»',
                    'studio.stage2.tasks_found_suffix': 'найдено',
                    'studio.stage2.btn_commit_count': 'Принять задания ({count})',
                    'studio.stage3.preview_btn_tooltip': 'Просмотреть задание целиком',
                    'studio.stage3.collapse': 'Свернуть',
                    'studio.stage3.expand_text': 'Читать полностью',
                    'studio.stage3.more_options_fmt': 'ещё {n} вар.',
                };
                return dict[key] || fallback || key;
            },
            getLang: () => 'ru',
        };

        const jsPath = path.resolve(process.cwd(), 'frontend/Editor/task_import_studio.js');
        const jsCode = fs.readFileSync(jsPath, 'utf-8');

        dom.window.eval(jsCode);
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        Studio = window.__StudioInternal;
    });

    describe('Task Serialization to Text Format', () => {
        it('serializes TEST tasks with question, options (+/-) and explanation', () => {
            const task = {
                type: 'test',
                title: 'Диагностика аппендицита',
                options: [
                    { text: 'Симптом Щёткина-Блюмберга', is_correct: true },
                    { text: 'Симптом Кернига', is_correct: false },
                ],
                explanation: 'Симптом Кернига характерен для менингеального синдрома.',
            };

            const text = Studio.serializeTaskToText(task);
            expect(text).toContain('@TEST');
            expect(text).toContain('# Диагностика аппендицита');
            expect(text).toContain('+ Симптом Щёткина-Блюмберга');
            expect(text).toContain('- Симптом Кернига');
            expect(text).toContain('// Симптом Кернига характерен для менингеального синдрома.');
        });

        it('serializes OPEN_ANSWER tasks with question, standard answer (=) and criteria (//)', () => {
            const task = {
                type: 'open_answer',
                question: 'Опишите триаду Бека при тампонаде сердца',
                standard_answer: 'Гипотензия, глухие сердечные тоны, набухание яремных вен',
                criteria: 'Упоминание всех трех компонентов клинической триады',
            };

            const text = Studio.serializeTaskToText(task);
            expect(text).toContain('@OPEN_ANSWER');
            expect(text).toContain('# Опишите триаду Бека при тампонаде сердца');
            expect(text).toContain('= Гипотензия, глухие сердечные тоны, набухание яремных вен');
            expect(text).toContain('// Упоминание всех трех компонентов клинической триады');
        });

        it('serializes SEQUENCE tasks with numbered steps (1., 2., 3.)', () => {
            const task = {
                type: 'sequence',
                question: 'Алгоритм базовой СЛР',
                items: [
                    'Оценка безопасности и сознания',
                    'Вызов скорой помощи',
                    'Компрессии грудной клетки 30:2',
                ],
            };

            const text = Studio.serializeTaskToText(task);
            expect(text).toContain('@SEQUENCE');
            expect(text).toContain('# Алгоритм базовой СЛР');
            expect(text).toContain('1. Оценка безопасности и сознания');
            expect(text).toContain('2. Вызов скорой помощи');
            expect(text).toContain('3. Компрессии грудной клетки 30:2');
        });

        it('serializes CLICK_TEXT tasks with contrastive statements (+/-)', () => {
            const task = {
                type: 'click_text',
                question: 'Мифы о применении адреналина при анафилаксии',
                statements: [
                    { text: 'Адреналин вводится внутримышечно в переднебоковую поверхность бедра', is_correct: true },
                    { text: 'Антигистаминные препараты заменяют введение адреналина', is_correct: false },
                ],
            };

            const text = Studio.serializeTaskToText(task);
            expect(text).toContain('@CLICK_TEXT');
            expect(text).toContain('# Мифы о применении адреналина при анафилаксии');
            expect(text).toContain('+ Адреналин вводится внутримышечно в переднебоковую поверхность бедра');
            expect(text).toContain('- Антигистаминные препараты заменяют введение адреналина');
        });

        it('serializes CLICK_WORDS tasks with [bracketed errors] from error spans', () => {
            const task = {
                type: 'click_words',
                question: 'Ошибки в протоколе интубации',
                text: 'Преоксигенация проводится 100% азотом в течение 3 минут.',
                error_spans: [[31, 37]], // 'азотом'
            };

            const text = Studio.serializeTaskToText(task);
            expect(text).toContain('@CLICK_WORDS');
            expect(text).toContain('# Ошибки в протоколе интубации');
            expect(text).toContain('Преоксигенация проводится 100% [азотом] в течение 3 минут.');
        });

        it('serializes multiple tasks using serializeTasksToText with double newlines', () => {
            const tasks = [
                { type: 'test', title: 'Вопрос 1', options: [{ text: 'Да', is_correct: true }] },
                { type: 'test', title: 'Вопрос 2', options: [{ text: 'Нет', is_correct: true }] },
            ];

            const text = Studio.serializeTasksToText('TEST', tasks);
            expect(text).toContain('@TEST\n# Вопрос 1');
            expect(text).toContain('@TEST\n# Вопрос 2');
            expect(text.indexOf('@TEST\n# Вопрос 2')).toBeGreaterThan(text.indexOf('@TEST\n# Вопрос 1'));
        });
    });

    describe('State Synchronization & Reconstructed Type Drafts', () => {
        it('syncTypeDraftsWithAllTasks creates committed drafts and reconstructs responseText', () => {
            Studio.StudioState.allTasks = [
                {
                    type: 'test',
                    _studio_id: 't_t1',
                    title: 'Тест 1',
                    options: [{ text: 'A', is_correct: true }, { text: 'B', is_correct: false }],
                },
                {
                    type: 'open_answer',
                    _studio_id: 't_o1',
                    title: 'Открытый вопрос',
                    standard_answer: 'Ответ',
                },
            ];
            Studio.StudioState.typeDrafts = {};

            Studio.syncTypeDraftsWithAllTasks();

            // Check TEST draft
            const testDraft = Studio.StudioState.typeDrafts['TEST'];
            expect(testDraft).toBeDefined();
            expect(testDraft.isCommitted).toBe(true);
            expect(testDraft.parsedTasks.length).toBe(1);
            expect(testDraft.responseText).toContain('@TEST');
            expect(testDraft.responseText).toContain('# Тест 1');

            // Check OPEN_ANSWER draft
            const openDraft = Studio.StudioState.typeDrafts['OPEN_ANSWER'];
            expect(openDraft).toBeDefined();
            expect(openDraft.isCommitted).toBe(true);
            expect(openDraft.parsedTasks.length).toBe(1);
            expect(openDraft.responseText).toContain('@OPEN_ANSWER');
            expect(openDraft.responseText).toContain('# Открытый вопрос');
        });

        it('clears committed status if tasks of a type were completely deleted from allTasks', () => {
            Studio.StudioState.typeDrafts = {
                TEST: {
                    responseText: '@TEST\n# Было',
                    parsedTasks: [{ type: 'test', title: 'Было' }],
                    isCommitted: true,
                },
            };
            Studio.StudioState.allTasks = []; // tasks were deleted

            Studio.syncTypeDraftsWithAllTasks();

            const testDraft = Studio.StudioState.typeDrafts['TEST'];
            expect(testDraft.isCommitted).toBe(false);
            expect(testDraft.parsedTasks.length).toBe(0);
        });
    });

    describe('Stage 2 UI Restoration & Committed View Interactivity', () => {
        beforeEach(() => {
            Studio.StudioState.selectedModuleId = 'mod_icu';
            Studio.StudioState.selectedTopicId = 'top_shock';
        });

        it('setupStage2 syncs drafts, picks active type and renders committed view with mini-cards', () => {
            Studio.StudioState.allTasks = [
                {
                    type: 'test',
                    _studio_id: 't_t1',
                    title: 'Вопрос по антибиотикотерапии',
                    options: [
                        { text: 'Амоксициллин/клавуланат', is_correct: true },
                        { text: 'Ванкомицин', is_correct: false },
                        { text: 'Азитромицин', is_correct: false },
                        { text: 'Ципрофлоксацин', is_correct: false },
                    ],
                },
            ];

            Studio.setupStage2();

            expect(Studio.StudioState.activeGenerationType).toBe('TEST');
            expect(Studio.DOM.typeCommittedView.classList.contains('hidden')).toBe(false);
            expect(Studio.DOM.typeResponseInput.classList.contains('hidden')).toBe(true);

            // Raw code preview in details is populated
            expect(Studio.DOM.typeCommittedRawCode.textContent).toContain('@TEST');
            expect(Studio.DOM.typeCommittedRawCode.textContent).toContain('Амоксициллин/клавуланат');

            // Mini card is rendered
            const miniCards = Studio.DOM.typeCommittedCardsList.querySelectorAll('.studio-committed-mini-card');
            expect(miniCards.length).toBe(1);

            const card = miniCards[0];
            const titleEl = card.querySelector('.studio-task-card-title');
            expect(titleEl.textContent).toBe('Вопрос по антибиотикотерапии');

            // Preview icon button exists
            const previewBtn = card.querySelector('.btn-preview-committed-task');
            expect(previewBtn).not.toBeNull();
        });

        it('clicking preview button or card title in Stage 2 opens task preview modal', () => {
            const task = {
                type: 'test',
                _studio_id: 't_t1',
                title: 'Клинический сценарий инфаркта',
                options: [
                    { text: 'ЭКГ в 12 отведениях', is_correct: true },
                    { text: 'Флюорография', is_correct: false },
                ],
            };
            Studio.StudioState.allTasks = [task];
            Studio.setupStage2();

            const card = Studio.DOM.typeCommittedCardsList.querySelector('.studio-committed-mini-card');
            const previewBtn = card.querySelector('.btn-preview-committed-task');

            // Modal initially hidden
            expect(Studio.DOM.modalTaskPreview.classList.contains('hidden')).toBe(true);

            // Click preview button
            previewBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

            // Modal is now open and displays the task
            expect(Studio.DOM.modalTaskPreview.classList.contains('hidden')).toBe(false);
            expect(Studio.DOM.modalPreviewTitle.textContent).toBe('Клинический сценарий инфаркта');
        });

        it('switchToEditMode restores reconstructed response text in textarea and updates live counter', () => {
            Studio.StudioState.allTasks = [
                {
                    type: 'test',
                    _studio_id: 't_t1',
                    title: 'Вопрос 1',
                    options: [{ text: 'Вариант 1', is_correct: true }],
                },
            ];
            Studio.setupStage2();

            expect(Studio.DOM.typeCommittedView.classList.contains('hidden')).toBe(false);
            expect(Studio.DOM.typeResponseInput.classList.contains('hidden')).toBe(true);

            // Click edit button
            Studio.DOM.btnEditTypeTasks.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

            // Committed view hidden, textarea unhidden
            expect(Studio.DOM.typeCommittedView.classList.contains('hidden')).toBe(true);
            expect(Studio.DOM.typeResponseInput.classList.contains('hidden')).toBe(false);

            // Textarea populated with the serialized text
            expect(Studio.DOM.typeResponseInput.value).toContain('@TEST');
            expect(Studio.DOM.typeResponseInput.value).toContain('Вопрос 1');

            // Live parse counter is visible and shows count
            expect(Studio.DOM.liveParseCounter.classList.contains('hidden')).toBe(false);
            expect(Studio.DOM.liveParseCountText.textContent).toContain('1');
        });

        it('restoreSession restores session tasks, synchronizes drafts and allows navigating back to Stage 2', () => {
            const sessionData = {
                session_id: 'sess_123',
                module_id: 'mod_icu',
                topic_id: 'top_shock',
                tasks: [
                    {
                        type: 'test',
                        title: 'Сессионный тест',
                        options: [{ text: 'Правильно', is_correct: true }],
                    },
                ],
                human_summary: 'Обзор сессии',
                recommendations: [],
            };

            Studio.restoreSession(sessionData);

            // State tasks restored
            expect(Studio.StudioState.allTasks.length).toBe(1);

            // Drafts are already synchronized
            const draft = Studio.StudioState.typeDrafts['TEST'];
            expect(draft).toBeDefined();
            expect(draft.isCommitted).toBe(true);
            expect(draft.responseText).toContain('@TEST');

            // Step was switched to 3 because tasks exist
            expect(Studio.StudioState.currentStep).toBe(3);

            // Navigate back to Step 2
            Studio.switchStep(2);

            expect(Studio.StudioState.currentStep).toBe(2);
            expect(Studio.DOM.typeCommittedView.classList.contains('hidden')).toBe(false);
            expect(Studio.DOM.typeCommittedCardsList.children.length).toBe(1);
        });
    });
});
