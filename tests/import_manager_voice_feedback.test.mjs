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
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
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

describe('ImportManager voice feedback on gate checks', () => {
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
    });

    it('uses voice feedback when AI mode misses module/topic', async () => {
        manager.importMode = 'ai';
        manager.currentStep = 1;
        manager.selectedModule = null;
        manager.selectedTopic = null;

        const voiceSpy = vi.spyOn(manager, 'showVoiceToast').mockImplementation(() => {});
        const toastSpy = vi.spyOn(manager, 'showToast').mockImplementation(() => {});

        await manager.handleNext();

        expect(voiceSpy).toHaveBeenCalledWith(expect.objectContaining({
            severity: 'warning',
        }));
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it('uses voice feedback when text mode misses module/topic', async () => {
        manager.importMode = 'text';
        manager.currentStep = 1;
        manager.selectedModule = null;
        manager.selectedTopic = null;

        const voiceSpy = vi.spyOn(manager, 'showVoiceToast').mockImplementation(() => {});
        const toastSpy = vi.spyOn(manager, 'showToast').mockImplementation(() => {});

        await manager.handleNext();

        expect(voiceSpy).toHaveBeenCalledWith(expect.objectContaining({
            severity: 'warning',
        }));
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it('uses voice feedback when step 2 text is empty', async () => {
        manager.importMode = 'text';
        manager.currentStep = 2;
        manager.sourceText = '   ';

        const voiceSpy = vi.spyOn(manager, 'showVoiceToast').mockImplementation(() => {});
        const toastSpy = vi.spyOn(manager, 'showToast').mockImplementation(() => {});

        await manager.handleNext();

        expect(voiceSpy).toHaveBeenCalledWith(expect.objectContaining({
            severity: 'warning',
        }));
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it('uses voice feedback when archive file is missing', async () => {
        manager.importMode = 'archive';
        manager.currentStep = 1;
        manager.uploadedFile = null;

        const voiceSpy = vi.spyOn(manager, 'showVoiceToast').mockImplementation(() => {});
        const toastSpy = vi.spyOn(manager, 'showToast').mockImplementation(() => {});

        await manager.handleNext();

        expect(voiceSpy).toHaveBeenCalledWith(expect.objectContaining({
            severity: 'warning',
        }));
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it('uses voice feedback when microcards create has no ai_run_id', async () => {
        manager.aiRunId = null;
        manager.analysisResult = null;

        const voiceSpy = vi.spyOn(manager, 'showVoiceToast').mockImplementation(() => {});
        const toastSpy = vi.spyOn(manager, 'showToast').mockImplementation(() => {});

        const result = await manager.createMicrocardsDeckFromCurrentAnalysis({ scope: 'all' });

        expect(result).toMatchObject({ ok: false, error: 'ai_run_id_required' });
        expect(voiceSpy).toHaveBeenCalledWith(expect.objectContaining({
            severity: 'warning',
        }));
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it('uses voice feedback when microcards append has no ai_run_id', async () => {
        manager.aiRunId = null;
        manager.analysisResult = null;

        const voiceSpy = vi.spyOn(manager, 'showVoiceToast').mockImplementation(() => {});
        const toastSpy = vi.spyOn(manager, 'showToast').mockImplementation(() => {});

        const result = await manager.appendMicrocardsToExistingDeckFromCurrentAnalysis({ scope: 'all' });

        expect(result).toMatchObject({ ok: false, error: 'ai_run_id_required' });
        expect(voiceSpy).toHaveBeenCalledWith(expect.objectContaining({
            severity: 'warning',
        }));
        expect(toastSpy).not.toHaveBeenCalled();
    });
});
