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
    const dom = new JSDOM(
        '<!DOCTYPE html><html><body><div data-role="import-content"></div><div id="import-step-content"><button data-role="import-next"></button></div></body></html>',
        {
            url: 'http://localhost',
            runScripts: 'dangerously',
            resources: 'usable',
        }
    );

    defineGlobal('window', dom.window);
    defineGlobal('document', dom.window.document);
    defineGlobal('HTMLElement', dom.window.HTMLElement);
    defineGlobal('Node', dom.window.Node);
    defineGlobal('navigator', dom.window.navigator);
    defineGlobal('FormData', dom.window.FormData);
    defineGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0));
    dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    dom.window.fetch = vi.fn();
    defineGlobal('fetch', dom.window.fetch);

    dom.window.eval(loadScript('frontend/Editor/import_manager.js') + '\n;window.ImportManager = ImportManager;');
    return dom;
}

function makeMockStreamResponse(messages) {
    let index = 0;
    const encoder = new TextEncoder();
    return {
        ok: true,
        body: {
            getReader() {
                return {
                    async read() {
                        if (index < messages.length) {
                            const chunk = encoder.encode(JSON.stringify(messages[index++]) + '\n');
                            return { done: false, value: chunk };
                        }
                        return { done: true, value: undefined };
                    },
                };
            },
        },
    };
}

describe('ImportManager conflict resolution persistence and UX', () => {
    let dom;
    let manager;

    beforeEach(() => {
        dom = setupDom();
        const ImportManager = dom.window.ImportManager;
        manager = new ImportManager({
            catalog: [],
            closeModals: vi.fn(),
            closeImportModal: vi.fn(),
            loadCatalog: vi.fn(),
            loadWorkspaceLimits: vi.fn().mockResolvedValue({}),
        });
    });

    it('initializes with default conflictResolution skip and skipErrors true', () => {
        expect(manager.conflictResolution).toBe('skip');
        expect(manager.skipErrors).toBe(true);
    });

    it('renders step 3 archive with selected option matching state', () => {
        manager.importMode = 'archive';
        manager.parsedResult = {
            summary: { total: 1, valid: 1, warnings: 0, errors: 0 },
            conflicts: { duplicates: [], overwrites: [], broken_deps: [] },
            errors: [],
            tasks: [{ id: 'task_1', status: 'valid' }],
        };
        manager.conflictResolution = 'new_id';
        manager.skipErrors = false;

        const html = manager.renderStep3Archive();
        expect(html).toContain('value="new_id" selected');
        expect(html).not.toContain('id="skip-errors-checkbox" checked');
    });

    it('preserves conflict resolution and skipErrors across step transitions', () => {
        manager.importMode = 'archive';
        manager.currentStep = 3;
        manager.parsedResult = {
            summary: { total: 1, valid: 1, warnings: 0, errors: 0 },
            conflicts: { duplicates: [], overwrites: [], broken_deps: [] },
            errors: [],
            tasks: [{ id: 'task_1', status: 'valid' }],
        };

        const contentArea = document.querySelector('[data-role="import-content"]');
        contentArea.innerHTML = manager.renderStep3Archive();
        manager.attachStepEventListeners();

        const select = document.getElementById('conflict-resolution-select');
        const checkbox = document.getElementById('skip-errors-checkbox');
        expect(select).not.toBeNull();
        expect(checkbox).not.toBeNull();

        // User selects "new_id" and unchecks skip-errors
        select.value = 'new_id';
        select.dispatchEvent(new dom.window.Event('change'));
        checkbox.checked = false;
        checkbox.dispatchEvent(new dom.window.Event('change'));

        expect(manager.conflictResolution).toBe('new_id');
        expect(manager.skipErrors).toBe(false);

        // Move to step 4
        manager.goToStep(4);
        expect(manager.currentStep).toBe(4);
        expect(manager.conflictResolution).toBe('new_id');
        expect(manager.skipErrors).toBe(false);
    });

    it('displays selected conflict resolution in step 4 summary', () => {
        manager.importMode = 'archive';
        manager.parsedResult = {
            summary: { total: 1, valid: 1, warnings: 0, errors: 0 },
            conflicts: { duplicates: [], overwrites: [], broken_deps: [] },
            errors: [],
            tasks: [{ id: 'task_1', status: 'valid' }],
        };
        manager.conflictResolution = 'new_id';

        const html = manager.renderStep4();
        expect(html).toContain('Действие при конфликте:');
        expect(html).toContain('Создать копию (новый ID)');
    });

    it('sends preserved conflict resolution in handleImport even if element is absent from DOM', async () => {
        manager.importMode = 'archive';
        manager.currentStep = 4;
        manager.uploadedFile = new dom.window.File(['dummy'], 'test.zip', { type: 'application/zip' });
        manager.parsedResult = {
            summary: { total: 1, valid: 1, warnings: 0, errors: 0 },
            conflicts: { duplicates: [], overwrites: [], broken_deps: [] },
            errors: [],
            tasks: [{ id: 'task_1', status: 'valid' }],
        };
        manager.conflictResolution = 'new_id';
        manager.skipErrors = false;

        // Ensure conflict-resolution-select is NOT in DOM on step 4
        expect(document.getElementById('conflict-resolution-select')).toBeNull();

        let sentFormData = null;
        dom.window.fetch = vi.fn().mockImplementation((url, opts) => {
            if (url.includes('/api/editor/import/confirm')) {
                sentFormData = opts.body;
                return Promise.resolve(makeMockStreamResponse([
                    { type: 'result', data: { ok: true, imported: 1, skipped: 0, errors: 0 } },
                ]));
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        await manager.handleImport();

        expect(sentFormData).not.toBeNull();
        expect(sentFormData.get('conflict_resolution')).toBe('new_id');
        expect(sentFormData.get('skip_errors')).toBe('false');
    });

    it('resets conflict settings on resetImportModalState', async () => {
        manager.conflictResolution = 'new_id';
        manager.skipErrors = false;

        await manager.resetImportModalState();

        expect(manager.conflictResolution).toBe('skip');
        expect(manager.skipErrors).toBe(true);
    });

    it('shows warning voice toast when all tasks are skipped', async () => {
        manager.importMode = 'archive';
        manager.currentStep = 4;
        manager.uploadedFile = new dom.window.File(['dummy'], 'test.zip', { type: 'application/zip' });
        manager.parsedResult = {
            summary: { total: 1, valid: 1, warnings: 0, errors: 0 },
            conflicts: { duplicates: [], overwrites: [], broken_deps: [] },
            errors: [],
            tasks: [{ id: 'task_1', status: 'valid' }],
        };

        const voiceToastSpy = vi.spyOn(manager, 'showVoiceToast').mockImplementation(() => {});

        dom.window.fetch = vi.fn().mockImplementation((url) => {
            if (url.includes('/api/editor/import/confirm')) {
                return Promise.resolve(makeMockStreamResponse([
                    { type: 'result', data: { ok: true, imported: 0, skipped: 1, errors: 0 } },
                ]));
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        await manager.handleImport();

        expect(voiceToastSpy).toHaveBeenCalledWith(expect.objectContaining({
            severity: 'warning',
            next: expect.stringContaining('Все задания пропущены из-за совпадения ID'),
        }));
    });
});
