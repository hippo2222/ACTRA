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
        writable: true,
    });
}

function setupDom() {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="import-modal"><div data-role="import-content"></div></div></body></html>', {
        url: 'http://localhost',
        runScripts: 'dangerously',
        resources: 'usable',
    });

    defineGlobal('window', dom.window);
    defineGlobal('document', dom.window.document);
    defineGlobal('HTMLElement', dom.window.HTMLElement);
    defineGlobal('Node', dom.window.Node);
    defineGlobal('navigator', dom.window.navigator);
    dom.window.fetch = vi.fn();
    defineGlobal('fetch', dom.window.fetch);

    dom.window.eval(loadScript('frontend/Editor/import_manager.js') + '\n;window.ImportManager = ImportManager;');
    return dom;
}

describe('ImportManager Step 2 UI/UX & Interaction Quality', () => {
    let dom;
    let manager;

    beforeEach(() => {
        dom = setupDom();
        const ImportManager = dom.window.ImportManager;
        manager = new ImportManager({
            catalog: [],
            closeModals: vi.fn(),
            loadCatalog: vi.fn(),
        });
        manager.currentStep = 2;
        manager.importMode = 'text';
    });

    it('renders hero editor on left (60%), syntax reference on right (40%), auto-detect banner, and primary paste CTA', () => {
        const html = manager.renderStep2Text();
        expect(html).toContain('import-split-grid-text');
        expect(html).toContain('data-role="editor-panel"');
        expect(html).toContain('data-role="import-cheatsheet-tabs"');

        // Verify column order: editor-panel comes FIRST in the markup (left column)
        const editorIndex = html.indexOf('data-role="editor-panel"');
        const cheatIndex = html.indexOf('data-role="import-cheatsheet-tabs"');
        expect(editorIndex).toBeGreaterThan(-1);
        expect(cheatIndex).toBeGreaterThan(-1);
        expect(editorIndex).toBeLessThan(cheatIndex);

        // Auto-detection highlights
        expect(html).toContain('data-role="auto-detect-banner"');
        expect(html).toContain('data-role="auto-detect-badge"');
        // Badge must NOT have broken 'hidden sm:inline-flex'
        expect(html).not.toMatch(/class="[^"]*hidden sm:inline-flex/);

        // Editor hero affordances (single primary CTA per visible zone: paste button is secondary)
        expect(html).toContain('data-role="import-paste-btn"');
        expect(html).toContain('bg-surface-2 text-text-main');
        expect(html).toContain('id="import-text-stats"');
        expect(html).toContain('id="import-live-counter"');
        expect(html).toContain('min-h-[90px]');

        // Cheatsheet assistant affordances
        expect(html).toContain('data-role="cheat-type-select"');
        expect(html).toContain('id="cheat-syntax-badges"');
        expect(html).toContain('id="cheat-copy-example-btn"');
        expect(html).toContain('data-role="cheat-copy-example"');
    });

    it('setCheatSheetTab performs instant localized DOM update without calling renderCurrentStep', () => {
        const contentArea = dom.window.document.querySelector('[data-role="import-content"]');
        contentArea.innerHTML = manager.renderStep2Text();

        const renderCurrentStepSpy = vi.spyOn(manager, 'renderCurrentStep');
        const updateCheatSheetPanelSpy = vi.spyOn(manager, 'updateCheatSheetPanel');

        // Initial state is 'test'
        expect(dom.window.document.getElementById('cheat-sheet-tag').textContent).toBe('@TEST');

        // Switch to sequence
        manager.setCheatSheetTab('sequence');

        expect(manager.cheatSheetTab).toBe('sequence');
        expect(updateCheatSheetPanelSpy).toHaveBeenCalledWith('sequence');
        expect(renderCurrentStepSpy).not.toHaveBeenCalled();

        // Tag badge and example are updated in place
        expect(dom.window.document.getElementById('cheat-sheet-tag').textContent).toBe('@SEQUENCE');
        expect(dom.window.document.getElementById('cheat-example-code').textContent).toContain('@SEQUENCE');

        // Dropdown value and syntax badges updated in place
        const selectEl = dom.window.document.getElementById('cheat-type-select');
        expect(selectEl.value).toBe('sequence');
        const badgesContainer = dom.window.document.getElementById('cheat-syntax-badges');
        expect(badgesContainer.textContent).toContain('element_N:');
    });

    it('updateHeaderStats keeps char & line stats reactive and toggles clear button', () => {
        const contentArea = dom.window.document.querySelector('[data-role="import-content"]');
        contentArea.innerHTML = manager.renderStep2Text();

        const statsEl = dom.window.document.getElementById('import-text-stats');
        const clearBtn = dom.window.document.getElementById('import-clear-btn');

        // Initially 0
        manager.updateHeaderStats('');
        expect(statsEl.textContent).toContain('0');
        expect(clearBtn.classList.contains('hidden')).toBe(true);

        // When text is provided
        const sampleText = '@SEQUENCE\nelement_1: A\nelement_2: B';
        manager.updateHeaderStats(sampleText);
        expect(statsEl.textContent).toContain(String(sampleText.length));
        expect(statsEl.textContent).toContain('3'); // 3 lines
        expect(clearBtn.classList.contains('hidden')).toBe(false);

        // Clearing
        manager.updateHeaderStats('');
        expect(clearBtn.classList.contains('hidden')).toBe(true);
    });

    it('_updateLiveCounter recognizes markers with structured count and total badge', () => {
        const contentArea = dom.window.document.querySelector('[data-role="import-content"]');
        contentArea.innerHTML = manager.renderStep2Text();

        const counterEl = dom.window.document.getElementById('import-live-counter');

        // Empty text
        manager._updateLiveCounter('');
        expect(counterEl.innerHTML).toContain('material-symbols-outlined');

        // Multi-format combined text
        const combined = '@TEST\n# Q1\n? Question?\n+ A\n- B\n\n@SEQUENCE\n# S1\nelement_1: 1\n\n@SEQUENCE\n# S2\nelement_1: 2';
        manager._updateLiveCounter(combined);

        expect(counterEl.innerHTML).toContain('Тест: 1');
        expect(counterEl.innerHTML).toContain('Последовательность: 2');
        expect(counterEl.innerHTML).toContain('Всего:');
        expect(counterEl.innerHTML).toContain('3');
    });

    it('auto-synchronizes cheatsheet to first detected marker when user has not locked choice', () => {
        const contentArea = dom.window.document.querySelector('[data-role="import-content"]');
        contentArea.innerHTML = manager.renderStep2Text();

        // Initially 'test'
        expect(manager.cheatSheetTab).toBe('test');
        expect(dom.window.document.getElementById('cheat-sheet-tag').textContent).toBe('@TEST');

        // Pasting sequence text
        const seqText = '@SEQUENCE\n# Steps\nelement_1: First\nelement_2: Second';
        manager._updateLiveCounter(seqText);

        expect(manager.cheatSheetTab).toBe('sequence');
        expect(dom.window.document.getElementById('cheat-sheet-tag').textContent).toBe('@SEQUENCE');
        const selectEl = dom.window.document.getElementById('cheat-type-select');
        expect(selectEl.value).toBe('sequence');

        // If user explicitly changes the tab, lock is engaged
        manager.setCheatSheetTab('open_answer', { fromUser: true });
        expect(manager.cheatSheetTab).toBe('open_answer');
        expect(manager._userSelectedCheatSheetTab).toBe(true);

        // Subsequent update with sequence text does NOT override user's manual choice
        manager._updateLiveCounter(seqText);
        expect(manager.cheatSheetTab).toBe('open_answer');

        // Clearing text resets lock
        manager.clearImportText();
        expect(manager._userSelectedCheatSheetTab).toBe(false);

        // Next input auto-syncs again
        manager._updateLiveCounter(seqText);
        expect(manager.cheatSheetTab).toBe('sequence');
    });

    it('copyCheatSheetExample writes text to clipboard via writeToClipboard', async () => {
        const writeSpy = vi.spyOn(manager, 'writeToClipboard').mockResolvedValue(true);
        const toastSpy = vi.spyOn(manager, 'showToast').mockImplementation(() => {});

        const contentArea = dom.window.document.querySelector('[data-role="import-content"]');
        contentArea.innerHTML = manager.renderStep2Text();

        await manager.copyCheatSheetExample('test');

        expect(writeSpy).toHaveBeenCalled();
        expect(writeSpy.mock.calls[0][0]).toContain('@TEST');
        expect(toastSpy).toHaveBeenCalled();
    });

    it('renders optional task title input on Step 2 and synchronizes importTaskTitle state', () => {
        manager.setImportTaskTitle('Базовая реанимация (протокол)');
        const html = manager.renderStep2Text();

        expect(html).toContain('data-role="import-title-group"');
        expect(html).toContain('data-role="import-task-title-input"');
        expect(html).toContain('value="Базовая реанимация (протокол)"');

        const contentArea = dom.window.document.querySelector('[data-role="import-content"]');
        contentArea.innerHTML = html;

        const inputEl = dom.window.document.getElementById('import-task-title-input');
        expect(inputEl).not.toBeNull();
        expect(inputEl.value).toBe('Базовая реанимация (протокол)');

        manager.setImportTaskTitle('Новое название протокола');
        expect(manager.importTaskTitle).toBe('Новое название протокола');
    });

    it('renders open direct title input on Step 3 preview card and reacts to updates', () => {
        manager.currentStep = 3;
        manager.parsedResult = {
            tasks: [
                {
                    index: 0,
                    name: 'Исходное название задания',
                    type: 'test',
                    status: 'valid',
                    data: {
                        prompt: 'Вопрос по анатомии',
                        name: 'Исходное название задания',
                        questions: [{ text: 'Вопрос', answers: [] }]
                    },
                    validation: { issues: [] }
                }
            ],
            summary: { total: 1, valid: 1, warnings: 0, errors: 0 }
        };

        const cardHtml = manager.renderTaskCard(manager.parsedResult.tasks[0], 0);

        // Open input must exist and not be hidden
        expect(cardHtml).toContain('data-role="task-title-edit-input"');
        expect(cardHtml).toContain('data-task-title-input="0"');
        expect(cardHtml).toContain('value="Исходное название задания"');
        expect(cardHtml).not.toContain('task-title-edit-wrap hidden');

        const contentArea = dom.window.document.querySelector('[data-role="import-content"]');
        contentArea.innerHTML = cardHtml;

        const titleInput = dom.window.document.querySelector('[data-task-title-input="0"]');
        expect(titleInput).not.toBeNull();
        expect(titleInput.value).toBe('Исходное название задания');

        // Test updateTaskName
        manager.updateTaskName(0, 'Скорректированное название');
        expect(manager.parsedResult.tasks[0].name).toBe('Скорректированное название');
        expect(manager.parsedResult.tasks[0].data.name).toBe('Скорректированное название');

        // Test startEditName focuses input
        const focusSpy = vi.spyOn(titleInput, 'focus');
        manager.startEditName(0);
        expect(focusSpy).toHaveBeenCalled();
    });
});
