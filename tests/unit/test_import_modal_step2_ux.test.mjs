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

    it('renders format reference, auto-detect badge, copy CTA, and unified status bar in Step 2', () => {
        const html = manager.renderStep2Text();
        expect(html).toContain('data-role="import-cheatsheet-tabs"');
        expect(html).toContain('data-role="cheat-tabs-bar"');
        expect(html).toContain('id="cheat-copy-example-btn"');
        expect(html).toContain('data-role="cheat-copy-example"');
        expect(html).toContain('id="import-text-stats"');
        expect(html).toContain('id="import-live-counter"');
        expect(html).toContain('min-h-[160px]');
        expect(html).toContain('auto_awesome');
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

        // Active class shifted on buttons
        const seqBtn = dom.window.document.querySelector('button[data-tab-key="sequence"]');
        const testBtn = dom.window.document.querySelector('button[data-tab-key="test"]');
        expect(seqBtn.className).toContain('text-primary font-bold');
        expect(testBtn.className).not.toContain('text-primary font-bold');
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
});
