import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

describe('Task Import Studio — Phase 3: Batch Didactic Audit, Quality Gate & Pre-Import Guard', () => {
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

    const sampleTasks = [
        {
            _studio_id: 'task-valid-test',
            type: 'TEST',
            question: 'Признак гемоторакса на рентгенограмме:',
            options: [
                { text: 'Гомогенное затемнение нижнего отдела', is_correct: true },
                { text: 'Просветление легочного поля', is_correct: false },
            ],
            explanation: 'Кровь скапливается в плевральной полости.',
            _selected_for_import: true,
        },
        {
            _studio_id: 'task-warning-open',
            type: 'OPEN_ANSWER',
            prompt: 'Симптоматика отека легких:',
            standard_answer: 'Симптом крыльев бабочки, расширение корней легких.',
            keywords: [], // No keywords -> warning
            _selected_for_import: true,
        },
        {
            _studio_id: 'task-defect-test',
            type: 'TEST',
            question: 'Вопрос без правильного ответа (ошибка генератора):',
            options: [
                { text: 'Вариант 1', is_correct: false },
                { text: 'Вариант 2', is_correct: false },
            ],
            _selected_for_import: true,
        },
    ];

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
            json: async () => ({ ok: true, imported: 2 }),
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
        Studio.StudioState.selectedModuleId = 'mod-1';
        Studio.StudioState.selectedTopicId = 'top-1';
    });

    it('renders quality filter pills with live counts for valid, warning, and defect tasks', () => {
        Studio.StudioState.allTasks = JSON.parse(JSON.stringify(sampleTasks));
        Studio.renderShowcase();

        const pillsContainer = document.getElementById('showcase-quality-filter-pills');
        expect(pillsContainer).toBeTruthy();
        expect(pillsContainer.children.length).toBe(4);

        const pillTexts = Array.from(pillsContainer.children).map((el) => el.textContent);
        expect(pillTexts.some((txt) => txt.includes('Все качества (3)'))).toBe(true);
        expect(pillTexts.some((txt) => txt.includes('Готовые (1)'))).toBe(true);
        expect(pillTexts.some((txt) => txt.includes('Требуют внимания (1)'))).toBe(true);
        expect(pillTexts.some((txt) => txt.includes('С дефектами (1)'))).toBe(true);
    });

    it('filters showcase grid cards by didactic quality status', () => {
        Studio.StudioState.allTasks = JSON.parse(JSON.stringify(sampleTasks));
        Studio.renderShowcase();

        // Default ALL: 3 cards rendered
        let cards = document.querySelectorAll('.studio-task-card');
        expect(cards.length).toBe(3);

        // Filter: DEFECT only
        Studio.setShowcaseQualityFilter('DEFECT');
        cards = document.querySelectorAll('.studio-task-card');
        expect(cards.length).toBe(1);
        expect(cards[0].textContent).toContain('Вопрос без правильного ответа');

        // Filter: VALID only
        Studio.setShowcaseQualityFilter('VALID');
        cards = document.querySelectorAll('.studio-task-card');
        expect(cards.length).toBe(1);
        expect(cards[0].textContent).toContain('Признак гемоторакса');

        // Filter: ALL back
        Studio.setShowcaseQualityFilter('ALL');
        cards = document.querySelectorAll('.studio-task-card');
        expect(cards.length).toBe(3);
    });

    it('renders mini didactic status badge on showcase task cards and triggers preview modal on click', () => {
        Studio.StudioState.allTasks = JSON.parse(JSON.stringify(sampleTasks));
        Studio.renderShowcase();

        const cards = document.querySelectorAll('.studio-task-card');
        // Grouped by category: TEST section has cards[0] and cards[1], OPEN_ANSWER section has cards[2]
        const badge0 = cards[0].querySelector('.btn-card-audit-badge');
        const badge1 = cards[1].querySelector('.btn-card-audit-badge');
        const badge2 = cards[2].querySelector('.btn-card-audit-badge');

        expect(badge0.textContent).toContain(resolveTranslation('studio.sandbox.badge_valid_short'));
        expect(badge1.textContent).toContain(resolveTranslation('studio.sandbox.badge_defect_short'));
        expect(badge2.textContent).toContain(resolveTranslation('studio.sandbox.badge_warning_short'));

        // Clicking the badge opens preview modal
        badge1.click();
        const modal = document.getElementById('modal-task-preview');
        expect(modal.classList.contains('hidden')).toBe(false);

        const previewTitle = document.getElementById('modal-preview-title');
        expect(previewTitle.title || previewTitle.textContent).toContain('Вопрос без правильного ответа');
    });

    it('selects only valid tasks when clicking "Только готовые"', () => {
        Studio.StudioState.allTasks = JSON.parse(JSON.stringify(sampleTasks));
        Studio.renderShowcase();

        const btnSelectValidOnly = document.getElementById('btn-select-valid-only');
        expect(btnSelectValidOnly).toBeTruthy();
        btnSelectValidOnly.click();

        const tasks = Studio.StudioState.allTasks;
        expect(tasks[0]._selected_for_import).toBe(true); // Valid test
        expect(tasks[1]._selected_for_import).toBe(false); // Warning open answer
        expect(tasks[2]._selected_for_import).toBe(false); // Defective test
    });

    it('deselects defective tasks when clicking "Исключить дефекты"', () => {
        Studio.StudioState.allTasks = JSON.parse(JSON.stringify(sampleTasks));
        Studio.renderShowcase();

        const btnDeselectDefects = document.getElementById('btn-deselect-defects');
        expect(btnDeselectDefects).toBeTruthy();
        btnDeselectDefects.click();

        const tasks = Studio.StudioState.allTasks;
        expect(tasks[0]._selected_for_import).toBe(true); // Valid
        expect(tasks[1]._selected_for_import).toBe(true); // Warning (retained)
        expect(tasks[2]._selected_for_import).toBe(false); // Defect (uncheck)
    });

    it('triggers Pre-Import Verification Guard Modal when attempting to import defective tasks', async () => {
        Studio.StudioState.allTasks = JSON.parse(JSON.stringify(sampleTasks));
        Studio.renderShowcase();

        const btnExecuteImport = document.getElementById('btn-execute-import');
        expect(btnExecuteImport).toBeTruthy();

        // Click import with defective task selected
        await Studio.executeImport();

        // Modal should open
        const modalGuard = document.getElementById('modal-import-guard');
        expect(modalGuard.classList.contains('hidden')).toBe(false);

        const msg = document.getElementById('import-guard-message');
        expect(msg.textContent).toContain('1 с критическими дефектами');

        const defectsList = document.getElementById('import-guard-defects-list');
        expect(defectsList.textContent).toContain('Вопрос без правильного ответа');
        expect(defectsList.textContent).toContain(resolveTranslation('studio.sandbox.badge_no_correct'));

        // Exclude defects and import button
        const btnExcludeAndImport = document.getElementById('btn-guard-exclude-and-import');
        btnExcludeAndImport.click();

        // Defective task should now be deselected
        const tasks = Studio.StudioState.allTasks;
        expect(tasks.find((t) => t._studio_id === 'task-defect-test')._selected_for_import).toBe(false);

        // Guard modal should close
        expect(modalGuard.classList.contains('hidden')).toBe(true);
    });
});
