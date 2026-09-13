import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

function loadScript(filePath) {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

function defineGlobal(name, value) {
    Object.defineProperty(global, name, {
        value,
        configurable: true,
        writable: true
    });
}

function setupGlobalDom() {
    const htmlContent = fs.readFileSync(
        path.resolve(process.cwd(), 'frontend/Editor/Open Answer Editor Textual Reasoning.html'),
        'utf8'
    );

    const dom = new JSDOM(htmlContent, {
        url: 'http://localhost',
        runScripts: 'dangerously',
        resources: 'usable'
    });

    defineGlobal('window', dom.window);
    defineGlobal('document', dom.window.document);
    defineGlobal('HTMLElement', dom.window.HTMLElement);
    defineGlobal('Node', dom.window.Node);
    defineGlobal('CustomEvent', dom.window.CustomEvent);
    defineGlobal('FormData', dom.window.FormData);
    defineGlobal('File', dom.window.File);
    defineGlobal('Blob', dom.window.Blob);
    defineGlobal('navigator', dom.window.navigator);
    defineGlobal('URL', dom.window.URL);

    dom.window.fetch = vi.fn();
    dom.window.alert = vi.fn();
    dom.window.confirm = vi.fn(() => true);
    dom.window.__OPEN_ANSWER_EDITOR_AUTO_INIT_DISABLED__ = true;

    // Load dependencies
    dom.window.eval(loadScript('frontend/Editor/undo_manager.js') + "\n;window.UndoManager = UndoManager;");
    dom.window.wt = (key, fallback) => fallback;
    dom.window.eval(loadScript('frontend/Editor/base_editor.js') + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript('frontend/Editor/autosave_manager.js') + "\n;window.AutoSaveManager = AutoSaveManager;");
    dom.window.eval(loadScript('frontend/Editor/open_answer_editor.js') + "\n;window.OpenAnswerEditor = OpenAnswerEditor;");

    return dom;
}

describe('OpenAnswerEditor Multi-Question Stage 2', () => {
    let dom;
    let editor;

    beforeEach(() => {
        dom = setupGlobalDom();
        dom.window.fetch = vi.fn();
        dom.window.localStorage.clear();

        const OpenAnswerEditor = dom.window.OpenAnswerEditor;
        const initSpy = vi.spyOn(OpenAnswerEditor.prototype, 'init').mockImplementation(() => {});
        editor = new OpenAnswerEditor();
        initSpy.mockRestore();
    });

    it('initializes from multi-question payload and renders cards with correct fields', () => {
        editor.task = {
            task_data: {
                name: 'Кейс: Острая пневмония',
                meta: { module: 'pulm', topic: 'acute' },
                content: {
                    case_text: 'Пациент 45 лет поступил с одышкой и кашлем.',
                    display_mode: 'sequential',
                    questions: [
                        {
                            id: 'q_diag',
                            question: 'Какой наиболее вероятный диагноз?',
                            reference_answer: 'Внебольничная правосторонняя пневмония',
                            keywords: ['пневмония', 'правосторонняя'],
                            levels: [1, 2, 3],
                            sequence_matters: true,
                            hint: 'Обратите внимание на аускультацию',
                        },
                        {
                            id: 'q_treat',
                            question: 'Какова тактика антибактериальной терапии?',
                            reference_answer: 'Амоксициллин с клавулановой кислотой перорально',
                            keywords: ['амоксициллин'],
                            levels: [2, 3],
                            sequence_matters: false,
                        }
                    ]
                }
            },
            metadata: { id: 'task_pneu_01', name: 'Кейс: Острая пневмония' }
        };

        editor.onTaskLoaded();

        // Check case text and display mode
        expect(document.querySelector('#case-textarea').value).toBe('Пациент 45 лет поступил с одышкой и кашлем.');
        expect(editor.displayMode).toBe('sequential');
        const checkedRadio = document.querySelector('input[name="display-mode"]:checked');
        expect(checkedRadio?.value).toBe('sequential');

        // Check rendered question cards
        const cards = document.querySelectorAll('.open-answer-question-card');
        expect(cards.length).toBe(2);

        // Card 0 checks
        expect(document.querySelector('#question-textarea').value).toBe('Какой наиболее вероятный диагноз?');
        expect(document.querySelector('#reference-textarea').value).toBe('Внебольничная правосторонняя пневмония');
        expect(document.querySelector('#hint-textarea').value).toBe('Обратите внимание на аускультацию');
        const q0Notices = cards[0].querySelector('.sequential-step-notice');
        expect(q0Notices.classList.contains('hidden')).toBe(false);

        // Card 1 checks
        expect(document.querySelector('#question-textarea-1').value).toBe('Какова тактика антибактериальной терапии?');
        expect(document.querySelector('#reference-textarea-1').value).toBe('Амоксициллин с клавулановой кислотой перорально');

        // Onboarding attributes preserved on Card 0
        expect(document.querySelector('#question-textarea').getAttribute('data-onboarding-target')).toBe('open-answer-question-text');
        expect(document.querySelector('#reference-textarea').getAttribute('data-onboarding-target')).toBe('open-answer-reference-text');
        expect(document.querySelector('#split-keywords-btn').getAttribute('data-onboarding-target')).toBe('open-answer-split-keywords');
        expect(document.querySelector('#keywords-container').getAttribute('data-onboarding-target')).toBe('open-answer-keywords-container');
    });

    it('adds a new question and sets defaults correctly', () => {
        editor.task = {
            task_data: {
                meta: { module: 'cardio', topic: 'chd' },
                content: {
                    question: 'Базовый вопрос',
                    reference_answer: 'Базовый эталон',
                    keywords: ['базовый'],
                }
            },
            metadata: { id: 'cardio_01' }
        };

        editor.onTaskLoaded();
        expect(editor.questions.length).toBe(1);

        editor.addQuestion();

        expect(editor.questions.length).toBe(2);
        expect(editor.questions[1].id).toBe('q_2');
        expect(editor.questions[1].levels).toEqual([1, 2, 3]);

        const cards = document.querySelectorAll('.open-answer-question-card');
        expect(cards.length).toBe(2);
        expect(document.querySelector('#question-textarea-1')).not.toBeNull();
    });

    it('deletes a question with undo capability', () => {
        editor.task = {
            task_data: {
                meta: { module: 'm', topic: 't' },
                content: {
                    questions: [
                        { id: 'q_1', question: 'Q1', reference_answer: 'A1', keywords: ['A1'], levels: [1] },
                        { id: 'q_2', question: 'Q2 to delete', reference_answer: 'A2', keywords: ['A2'], levels: [2] }
                    ]
                }
            },
            metadata: { id: 'm_01' }
        };

        editor.onTaskLoaded();
        expect(editor.questions.length).toBe(2);

        // Delete question at index 1
        editor.deleteQuestion(1);
        expect(editor.questions.length).toBe(1);
        expect(editor.questions[0].id).toBe('q_1');

        // Attempt to delete last remaining question should be prevented
        editor.deleteQuestion(0);
        expect(editor.questions.length).toBe(1);

        // Restore deleted question
        editor.restoreDeletedQuestion();
        expect(editor.questions.length).toBe(2);
        expect(editor.questions[1].id).toBe('q_2');
    });

    it('reorders questions with moveQuestion', () => {
        editor.task = {
            task_data: {
                meta: { module: 'm', topic: 't' },
                content: {
                    questions: [
                        { id: 'q_first', question: 'First', reference_answer: 'A', keywords: ['A'], levels: [1] },
                        { id: 'q_second', question: 'Second', reference_answer: 'B', keywords: ['B'], levels: [2] }
                    ]
                }
            },
            metadata: { id: 'm_01' }
        };

        editor.onTaskLoaded();
        expect(editor.questions[0].id).toBe('q_first');
        expect(editor.questions[1].id).toBe('q_second');

        editor.moveQuestion(0, 1);

        expect(editor.questions[0].id).toBe('q_second');
        expect(editor.questions[1].id).toBe('q_first');
    });

    it('toggles display mode and updates UI notices', () => {
        editor.task = {
            task_data: {
                meta: { module: 'm', topic: 't' },
                content: {
                    display_mode: 'simultaneous',
                    questions: [
                        { id: 'q_1', question: 'Q1', reference_answer: 'A1', keywords: ['A1'], levels: [1] }
                    ]
                }
            },
            metadata: { id: 'm_01' }
        };

        editor.onTaskLoaded();
        const notice = document.querySelector('.sequential-step-notice');
        expect(notice.classList.contains('hidden')).toBe(true);

        editor.displayMode = 'sequential';
        editor.updateDisplayModeUI();
        expect(notice.classList.contains('hidden')).toBe(false);

        editor.displayMode = 'simultaneous';
        editor.updateDisplayModeUI();
        expect(notice.classList.contains('hidden')).toBe(true);
    });

    it('validates question prompts, references, keywords, and difficulty levels', () => {
        editor.task = {
            task_data: {
                meta: { module: 'm', topic: 't' },
                content: {
                    questions: [
                        { id: 'q_1', question: '', reference_answer: 'Ans', keywords: ['Ans'], levels: [1] }
                    ]
                }
            },
            metadata: { id: 'm_01' }
        };

        editor.onTaskLoaded();

        // 1. Empty prompt
        let err = editor.validateTask();
        expect(err).toContain('поле вопроса не должно быть пустым');

        // Fix prompt, empty reference
        editor.questions[0].question = 'Valid question';
        editor.questions[0].reference_answer = '';
        editor.renderQuestions();
        err = editor.validateTask();
        expect(err).toContain('эталонный ответ не должен быть пустым');

        // Fix reference, empty keywords
        editor.questions[0].reference_answer = 'Valid reference';
        editor.questions[0].keywords = [];
        editor.renderQuestions();
        err = editor.validateTask();
        expect(err).toContain('ключевое слово');

        // Fix keywords, empty levels
        editor.questions[0].keywords = [{ text: 'Valid', normalized: 'valid', required: true }];
        editor.questions[0].levels = [];
        editor.renderQuestions();
        err = editor.validateTask();
        expect(err).toContain('уровень сложности');

        // All valid
        editor.questions[0].levels = [1, 2];
        editor.renderQuestions();
        err = editor.validateTask();
        expect(err).toBeNull();
    });

    it('builds canonical task data and preserves backward compatibility', () => {
        editor.task = {
            task_data: {
                meta: { module: 'm', topic: 't' },
                content: {
                    case_text: 'Общий кейс',
                    display_mode: 'sequential',
                    questions: [
                        {
                            id: 'q_1',
                            question: 'Вопрос 1',
                            reference_answer: 'Ответ 1',
                            hint: 'Подсказка 1',
                            keywords: [{ text: 'ключ1', normalized: 'ключ1', required: true }],
                            levels: [1, 2],
                            sequence_matters: true,
                        },
                        {
                            id: 'q_2',
                            question: 'Вопрос 2',
                            reference_answer: 'Ответ 2',
                            keywords: [{ text: 'ключ2', normalized: 'ключ2', required: true }],
                            levels: [3],
                            sequence_matters: false,
                        }
                    ]
                }
            },
            metadata: { id: 'm_01' }
        };

        editor.onTaskLoaded();
        const data = editor.buildTaskData();
        const content = data.content;

        // Root fields match Question 0 for legacy consumers
        expect(content.question).toBe('Вопрос 1');
        expect(content.prompt).toBe('Вопрос 1');
        expect(content.reference_answer).toBe('Ответ 1');
        expect(content.hint).toBe('Подсказка 1');
        expect(content.keywords).toEqual(['ключ1']);
        expect(content.sequence_matters).toBe(true);

        // Multi-question payload
        expect(content.case_text).toBe('Общий кейс');
        expect(content.display_mode).toBe('sequential');
        expect(content.questions.length).toBe(2);
        expect(content.questions[0].levels).toEqual([1, 2]);
        expect(content.questions[1].levels).toEqual([3]);
        expect(content.questions[1].keywords).toEqual(['ключ2']);
    });
});
