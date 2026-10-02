import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Task Import Studio — Block 1 (Typing, Categorization & Error Badging)', () => {
    let Studio;

    beforeEach(() => {
        // Setup minimal browser DOM environment
        global.window = {
            __ACTRA_DEV_MODE__: true,
            i18n: {
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
                        'studio.stage3.errors_phrases_and_words_fmt': 'Ошибок: {phrases} фрагм. ({words} сл.)',
                        'studio.stage3.errors_count_fmt': 'Ошибок: {count}',
                        'studio.stage3.traps_errors_fmt': 'Ошибок: {count}',
                    };
                    return dict[key] || fallback || key;
                }
            },
            addEventListener: () => {},
        };
        global.document = {
            addEventListener: () => {},
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: (tag) => ({
                setAttribute: () => {},
                appendChild: () => {},
                addEventListener: () => {},
                classList: { add: () => {}, remove: () => {} },
            }),
        };

        const code = fs.readFileSync(path.resolve(process.cwd(), 'frontend/Editor/task_import_studio.js'), 'utf-8');
        // Execute in global scope to populate window.__StudioInternal
        const fn = new Function(code);
        fn();
        Studio = global.window.__StudioInternal;
    });

    it('normalizes string types correctly', () => {
        expect(Studio.normalizeTaskType('test')).toBe('TEST');
        expect(Studio.normalizeTaskType('sequence_assembly')).toBe('SEQUENCE');
        expect(Studio.normalizeTaskType('sequence')).toBe('SEQUENCE');
        expect(Studio.normalizeTaskType('open_answer')).toBe('OPEN_ANSWER');
        expect(Studio.normalizeTaskType('click_words')).toBe('CLICK_WORDS');
        expect(Studio.normalizeTaskType('text_errors')).toBe('CLICK_WORDS');
        expect(Studio.normalizeTaskType('click_text')).toBe('CLICK_TEXT');
        expect(Studio.normalizeTaskType('text_choice')).toBe('CLICK_TEXT');
        expect(Studio.normalizeTaskType('click')).toBe('CLICK');
        expect(Studio.normalizeTaskType('draw')).toBe('DRAW');
    });

    it('normalizes task objects with text_errors or text_choice to proper canonical types', () => {
        // Hippopotamus prod task 12 structure
        const textErrorsTask = {
            type: 'click',
            data: {
                mode: 'text_errors',
                text: 'text: Накопление массивного плеврального выпота...',
                error_spans: [{ start: 202, end: 203, is_correct: false }]
            }
        };
        expect(Studio.normalizeTaskType(textErrorsTask)).toBe('CLICK_WORDS');

        // Task with content.mode
        const contentErrorsTask = {
            type: 'click',
            content: {
                mode: 'text_errors',
                text: 'Sample error text',
                error_spans: []
            }
        };
        expect(Studio.normalizeTaskType(contentErrorsTask)).toBe('CLICK_WORDS');

        // Task with subtype error_detection
        const subtypeErrorsTask = {
            type: 'click',
            subtype: 'error_detection'
        };
        expect(Studio.normalizeTaskType(subtypeErrorsTask)).toBe('CLICK_WORDS');

        // Hippopotamus prod task 9 structure (text_choice)
        const textChoiceTask = {
            type: 'click',
            data: {
                mode: 'text_choice',
                prompt: 'Выберите верные и ложные утверждения',
                options: []
            }
        };
        expect(Studio.normalizeTaskType(textChoiceTask)).toBe('CLICK_TEXT');

        // Pure spatial image click task
        const imageClickTask = {
            type: 'click',
            data: {
                image: '/images/chest_xray.png',
                targets: [{ name: 'Синус' }]
            }
        };
        expect(Studio.normalizeTaskType(imageClickTask)).toBe('CLICK');
    });

    it('returns human-readable task type labels without technical slashes', () => {
        expect(Studio.getTaskTypeLabel('TEST')).toBe('Тест');
        expect(Studio.getTaskTypeLabel('CLICK_WORDS')).toBe('Поиск ошибок в тексте');
        expect(Studio.getTaskTypeLabel('CLICK_TEXT')).toBe('Контрастные утверждения');
        expect(Studio.getTaskTypeLabel('CLICK')).toBe('Клик по изображению');
        expect(Studio.getTaskTypeLabel('SEQUENCE')).toBe('Последовательность');
        expect(Studio.getTaskTypeLabel('OPEN_ANSWER')).toBe('Открытый ответ');
        expect(Studio.getTaskTypeLabel('DRAW')).toBe('Рисование');

        // Accepts task object
        const textErrorsTask = { type: 'click', data: { mode: 'text_errors' } };
        expect(Studio.getTaskTypeLabel(textErrorsTask)).toBe('Поиск ошибок в тексте');
    });

    it('correctly maps task types to showcase categories', () => {
        const categories = Studio.SHOWCASE_CATEGORIES;
        const clickWordsCat = categories.find((c) => c.key === 'CLICK_WORDS');
        expect(clickWordsCat).toBeDefined();
        expect(clickWordsCat.types).toContain('CLICK_WORDS');

        const clickTextCat = categories.find((c) => c.key === 'CLICK_TEXT');
        expect(clickTextCat).toBeDefined();
        expect(clickTextCat.types).toContain('CLICK_TEXT');

        const visualCat = categories.find((c) => c.key === 'VISUAL');
        expect(visualCat).toBeDefined();
        expect(visualCat.types).toContain('CLICK');
        expect(visualCat.types).toContain('DRAW');
        expect(visualCat.types).not.toContain('CLICK_WORDS');
        expect(visualCat.types).not.toContain('CLICK_TEXT');
    });

    it('accurately groups contiguous error spans into semantic phrases in getErrorAnalysis', () => {
        const text = 'У пациента с полной обструкцией развился ателектаз. Накопление массивного плеврального выпота приводит к смещению средостения в правую сторону, к затемнению. Плевральный выпот объемом более 1500 мл всегда является строго односторонним заполняет весь гемиторакс.';
        
        // 10 word spans forming 2 phrases
        const errorSpans = [
            // Phrase 1: "в правую сторону, к затемнению." (5 word spans)
            { start: 130, end: 131, is_correct: false }, // "в"
            { start: 132, end: 138, is_correct: false }, // "правую"
            { start: 139, end: 147, is_correct: false }, // "сторону,"
            { start: 148, end: 149, is_correct: false }, // "к"
            { start: 150, end: 162, is_correct: false }, // "затемнению."

            // Phrase 2: "строго односторонним заполняет весь гемиторакс." (5 word spans)
            { start: 219, end: 225, is_correct: false }, // "строго"
            { start: 226, end: 239, is_correct: false }, // "односторонним"
            { start: 240, end: 249, is_correct: false }, // "заполняет"
            { start: 250, end: 254, is_correct: false }, // "весь"
            { start: 255, end: 266, is_correct: false }, // "гемиторакс."
        ];

        const analysis = Studio.getErrorAnalysis(text, errorSpans, null);
        expect(analysis.phraseCount).toBe(2);
        expect(analysis.totalWords).toBe(10);
        expect(analysis.clusters).toHaveLength(2);
        expect(analysis.clusters[0].start).toBe(130);
        expect(analysis.clusters[0].end).toBe(162);
        expect(analysis.clusters[1].start).toBe(219);
        expect(analysis.clusters[1].end).toBe(266);
    });

    it('highlights error spans with HTML escaping in highlightErrorSpansInText', () => {
        const text = 'text: В норме правое легкое состоит из 2 долей, а не 3.';
        const clusters = [
            // "2 долей" starting at index 39
            { start: 39, end: 46 }
        ];

        const html = Studio.highlightErrorSpansInText(text, clusters);
        expect(html).not.toContain('text:'); // prefix stripped
        expect(html).toContain('<mark class="bg-amber-500/20');
        expect(html).toContain('2 долей</mark>');
    });

    it('escapes special characters to prevent XSS in highlighted text', () => {
        const text = 'У больного <script>alert(1)</script> & <b>test</b>.';
        const clusters = [{ start: 11, end: 36 }]; // the script tag
        const html = Studio.highlightErrorSpansInText(text, clusters);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&amp;');
    });

    it('renders clean error preview snippet on task card without mysterious traps label', () => {
        const task = {
            type: 'click',
            data: {
                mode: 'text_errors',
                text: 'text: Накопление плеврального выпота приводит к затемнению легочного поля.',
                error_spans: [
                    { start: 6, end: 17, is_correct: false }, // "Накопление"
                    { start: 18, end: 31, is_correct: false }, // "плеврального"
                ]
            }
        };

        const snippet = Studio.renderTaskPreviewSnippet(task);
        expect(snippet).toContain('Ошибок:');
        expect(snippet).not.toContain('Ловушек');
        expect(snippet).not.toContain('Пасток');
        expect(snippet).toContain('<mark class="bg-amber-500/20');
        expect(snippet).toContain('Накопление плеврального');
    });
});
