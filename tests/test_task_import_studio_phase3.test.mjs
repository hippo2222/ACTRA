import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

describe('Task Import Studio — Phase 3 Remediation Logic', () => {
    let window;
    let document;
    let StudioInternal;

    beforeEach(() => {
        const html = fs.readFileSync(path.resolve(process.cwd(), 'frontend/Editor/Task_Import_Studio.html'), 'utf8');
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            url: 'http://localhost:8000/editor/import-studio',
            pretendToBeVisual: true,
        });

        window = dom.window;
        document = window.document;

        // Mock ACTRA dev mode
        window.__ACTRA_DEV_MODE__ = true;
        // Mock fetch
        window.fetch = async () => ({
            ok: true,
            json: async () => ({ ok: true, sessions: [], catalog: [] }),
            text: async () => ''
        });

        // Mock i18n
        window.i18n = {
            t: (k, fallback) => fallback,
            getLang: () => 'ru',
            updateDOM: () => {},
        };

        // Load studio script
        const jsCode = fs.readFileSync(path.resolve(process.cwd(), 'frontend/Editor/task_import_studio.js'), 'utf8');
        window.eval(jsCode);

        StudioInternal = window.__StudioInternal;
    });

    it('DEF-04: extractSequenceSteps strips leading numbers cleanly', () => {
        const rawTask = {
            type: 'SEQUENCE',
            data: {
                steps: [
                    '1. Первичный клинический осмотр',
                    '2) Оценка гемодинамики',
                    'Шаг 3: Снятие ЭКГ в 12 отведениях',
                    '4 - Катетеризация периферической вены',
                    '5. Эхокардиография прикроватная'
                ]
            }
        };

        const extracted = StudioInternal.extractSequenceSteps(rawTask);
        expect(extracted).toEqual([
            'Первичный клинический осмотр',
            'Оценка гемодинамики',
            'Снятие ЭКГ в 12 отведениях',
            'Катетеризация периферической вены',
            'Эхокардиография прикроватная'
        ]);
    });

    it('DEF-06: resolveTaskErrorSpans resolves target phrases from errors array', () => {
        const taskWithErrorsArray = {
            type: 'CLICK_WORDS',
            data: {
                text: 'Пациентке с анафилактическим шоком введено 10 мг адреналина в/в болюсно.',
                errors: [
                    { target: '10 мг адреналина в/в болюсно', correction: '0.3-0.5 мг в/м' }
                ]
            }
        };

        const spans = StudioInternal.resolveTaskErrorSpans(taskWithErrorsArray);
        expect(spans.length).toBe(1);
        expect(spans[0].target).toBe('10 мг адреналина в/в болюсно');
        expect(spans[0].start).toBe(43);
        expect(spans[0].end).toBe(71);

        // Audit didactics should mark it valid, NOT "Нет эталона!"
        const audit = StudioInternal.auditTaskDidactics(taskWithErrorsArray);
        expect(audit.status).toBe('valid');
        expect(audit.defects).toEqual([]);
    });

    it('DEF-06: evaluateSandboxAnswer returns 0% incorrect when error targets are missing (no false 100%)', () => {
        const brokenTask = {
            type: 'CLICK_WORDS',
            data: {
                text: 'Обычный текст без размеченных дефектов.',
                error_spans: [],
                errors: []
            }
        };

        StudioInternal.initSandboxSolveState(brokenTask);
        StudioInternal.evaluateSandboxAnswer(brokenTask, brokenTask.data, 'CLICK_WORDS');

        const state = StudioInternal.getSandboxSolveState();
        expect(state.score).toBe(0);
        expect(state.status).toBe('incorrect');
    });

    it('DEF-08: In-Place Quick Fix toggles is_correct, clears defects, and marks task selected', () => {
        const testTaskWithoutCorrect = {
            _studio_id: 'task_test_1',
            type: 'TEST',
            prompt: 'Какой препарат является препаратом первой линии при анафилаксии?',
            data: {
                prompt: 'Какой препарат является препаратом первой линии при анафилаксии?',
                options: [
                    { text: 'Эпинефрин (адреналин)', is_correct: false },
                    { text: 'Дифенгидрамин', is_correct: false },
                    { text: 'Преднизолон', is_correct: false }
                ]
            }
        };

        StudioInternal.StudioState.allTasks = [testTaskWithoutCorrect];
        StudioInternal.syncTypeDraftsWithAllTasks();

        // Initially it has a defect
        const initialAudit = StudioInternal.auditTaskDidactics(testTaskWithoutCorrect);
        expect(initialAudit.status).toBe('defect');
        expect(initialAudit.defects.length).toBeGreaterThan(0);

        // Open preview modal
        StudioInternal.openTaskPreviewModal(testTaskWithoutCorrect, 0);

        // Inspect option card exists and click it
        const optionCard = document.querySelector('.inspect-option-card[data-opt-idx="0"]');
        expect(optionCard).not.toBeNull();
        optionCard.click();

        // Option 0 should now be correct
        expect(testTaskWithoutCorrect.data.options[0].is_correct).toBe(true);
        expect(testTaskWithoutCorrect._selected_for_import).toBe(true);

        // Audit status should now be valid
        const updatedAudit = StudioInternal.auditTaskDidactics(testTaskWithoutCorrect);
        expect(updatedAudit.status).toBe('valid');
        expect(updatedAudit.defects).toEqual([]);
    });

    it('DEF-02: openImportGuardModal never produces negative count and disables exclude button if 0 clean tasks', () => {
        const defTask = {
            _studio_id: 'def_1',
            type: 'TEST',
            data: { options: [{ text: 'No correct answer', is_correct: false }] }
        };

        StudioInternal.StudioState.allTasks = [defTask];
        defTask._selected_for_import = true;

        // Open guard modal with only defective selected
        StudioInternal.openImportGuardModal([defTask], [defTask]);

        const label = document.getElementById('label-guard-exclude-and-import');
        const btn = document.getElementById('btn-guard-exclude-and-import');

        expect(label.textContent).toContain('(0)');
        expect(btn.disabled).toBe(true);
    });
});
