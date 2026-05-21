import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
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
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
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

    // Load dependencies in order via eval
    dom.window.eval(loadScript('frontend/Editor/undo_manager.js') + "\n;window.UndoManager = UndoManager;");
    dom.window.wt = (key, fallback) => fallback;
    dom.window.eval(loadScript('frontend/Editor/base_editor.js') + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript('frontend/Editor/autosave_manager.js') + "\n;window.AutoSaveManager = AutoSaveManager;");
    dom.window.eval(loadScript('frontend/Editor/open_answer_editor.js') + "\n;window.OpenAnswerEditor = OpenAnswerEditor;");

    return dom;
}

let dom = setupGlobalDom();
const OpenAnswerEditor = dom.window.OpenAnswerEditor;
const ADD_IMAGE_LABEL = 'Add image';
const SAMPLE_QUESTION = 'Question text';
const SAMPLE_REFERENCE = 'Reference answer';
const SAMPLE_HINT = 'Helpful hint';
const SAMPLE_KEYWORDS = ['alpha', 'beta'];
const SHORT_QUESTION = 'Short prompt';
const SHORT_REFERENCE = 'Short reference';
const SHORT_KEYWORDS = ['gamma'];
const DRAFT_QUESTION = 'Draft question';
const DRAFT_PROMPT = 'Draft prompt';
const DRAFT_REFERENCE = 'Draft reference';
const DRAFT_HINT = 'Draft hint';
const SAVED_QUESTION = 'Saved question';
const SAVED_REFERENCE = 'Saved reference';

function mountEditorDom() {
    document.body.innerHTML = `
        <header>
            <button id="back-to-dashboard-btn"></button>
            <h2 id="editor-title"></h2>
            <button id="save-task-btn"></button>
        </header>
        <button id="split-keywords-btn"></button>
        <div id="keywords-section">
            <div id="keywords-container"></div>
            <span id="selected-count-badge"></span>
        </div>
        <textarea id="question-textarea"></textarea>
        <textarea id="reference-textarea"></textarea>
        <textarea id="hint-textarea"></textarea>
        <input id="max-length-input" type="number" />
        <input id="sequence-order-check" type="checkbox" />
        <div id="images-container">
            <button id="add-image-btn"><span class="add-image-label">${ADD_IMAGE_LABEL}</span></button>
        </div>
        <input id="image-upload-input" type="file" multiple />
        <div id="image-preview-overlay" class="hidden">
            <div id="image-preview-container"></div>
            <img id="image-preview-img" />
            <button id="image-preview-close" type="button"></button>
        </div>
    `;
}

function createEditorInstance() {
    const initSpy = vi.spyOn(OpenAnswerEditor.prototype, 'init').mockImplementation(() => {});
    const instance = new OpenAnswerEditor();
    initSpy.mockRestore();
    return instance;
}

describe('OpenAnswerEditor image handling and saving', () => {
    let editor;

    beforeEach(() => {
        mountEditorDom();
        dom.window.alert = vi.fn();
        dom.window.fetch = vi.fn();
        dom.window.localStorage.clear();
        editor = createEditorInstance();
        editor.task = {
            task_data: {
                meta: { module: 'module_01', topic: 'topic_01' },
                content: {
                    question: '',
                    reference_answer: '',
                    hint: '',
                    max_length: 500,
                    sequence_matters: false,
                    keywords: [],
                    images: []
                }
            },
            metadata: { id: 'task_001' }
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders empty image state and enables add button when no images', () => {
        editor.renderImages();

        const emptyState = document.querySelector('.images-empty-state');
        expect(emptyState).not.toBeNull();
        expect(document.querySelector('#add-image-btn').disabled).toBe(false);
    });

    it('uploads images until limit and updates UI', async () => {
        const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' });
        dom.window.fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true, path: 'modules/module_01/image_1.png' })
        });

        await editor.handleImageUpload({ target: { files: [file], value: '' } });

        expect(dom.window.fetch).toHaveBeenCalledTimes(1);
        expect(editor.task.task_data.content.images).toHaveLength(1);
        expect(document.querySelectorAll('.open-answer-image-card')).toHaveLength(1);
        expect(document.querySelector('#add-image-btn').disabled).toBe(false);
    });

    it('prevents uploads above the image limit and shows warning toast', async () => {
        editor.task.task_data.content.images = ['1.png', '2.png', '3.png'];
        const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});

        await editor.handleImageUpload({ target: { files: [new File([1], 'extra.png')], value: '' } });

        expect(toastSpy).toHaveBeenCalledWith('Можно загрузить не более 3 изображений.', 'warning');
        expect(dom.window.fetch).not.toHaveBeenCalled();
    });

    it('saves normalized task payload and sends POST request', async () => {
        document.querySelector('#question-textarea').value = SAMPLE_QUESTION;
        document.querySelector('#reference-textarea').value = SAMPLE_REFERENCE;
        document.querySelector('#hint-textarea').value = SAMPLE_HINT;
        document.querySelector('#max-length-input').value = '600';
        document.querySelector('#sequence-order-check').checked = true;

        editor.sequenceMatters = true;
        editor.keywords = [
            { text: SAMPLE_KEYWORDS[0], required: true },
            { text: SAMPLE_KEYWORDS[1], required: true }
        ];
        editor.task.task_data.content.images = ['img1.png'];

        dom.window.fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true })
        });

        await editor.saveTask();

        expect(dom.window.fetch).toHaveBeenCalledTimes(1);
        const [, options] = dom.window.fetch.mock.calls[0];
        const payload = JSON.parse(options.body);

        expect(payload.content.question).toBe(SAMPLE_QUESTION);
        expect(payload.content.reference_answer).toBe(SAMPLE_REFERENCE);
        expect(payload.content.hint).toBe(SAMPLE_HINT);
        expect(payload.content.max_length).toBe(600);
        expect(payload.content.min_keywords).toBeUndefined();
        expect(payload.content.require_all_keywords).toBeUndefined();
        expect(payload.content.sequence_matters).toBe(true);
        expect(payload.content.keywords).toEqual(SAMPLE_KEYWORDS);
        expect(payload.content.images).toEqual(['img1.png']);
        expect(payload.settings.max_length).toBe(600);

        expect(dom.window.alert).not.toHaveBeenCalled();
    });

    it('clears answer length limit when the field is left empty', async () => {
        editor.task.task_data.settings = { max_length: 500 };
        document.querySelector('#question-textarea').value = SHORT_QUESTION;
        document.querySelector('#reference-textarea').value = SHORT_REFERENCE;
        document.querySelector('#max-length-input').value = '';
        editor.keywords = [
            { text: SHORT_KEYWORDS[0], required: true }
        ];

        dom.window.fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true })
        });

        await editor.saveTask();

        const [, options] = dom.window.fetch.mock.calls[0];
        const payload = JSON.parse(options.body);

        expect(payload.content.max_length).toBeUndefined();
        expect(payload.settings.max_length).toBeUndefined();
    });

    it('auto-restores unsaved changes during reload recovery flow', () => {
        const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});
        editor.initTheoryGroundingPanel = vi.fn();
        editor.bootstrapTheoryGroundingPanel = vi.fn(() => Promise.resolve());
        editor.shouldAutoRestoreDraft = vi.fn(() => true);
        editor.autoSaveManager = {
            hasFresherDraft: vi.fn(() => true),
            loadDraft: vi.fn(() => ({
                timestamp: '2026-03-12T10:35:00.000Z',
                data: {
                    content: {
                        question: DRAFT_QUESTION,
                        prompt: DRAFT_PROMPT,
                        reference_answer: DRAFT_REFERENCE,
                        hint: DRAFT_HINT,
                        sequence_matters: true,
                        keywords: [SAMPLE_KEYWORDS[0]],
                        images: ['img1.png']
                    }
                }
            })),
            start: vi.fn()
        };

        editor.applyLoadedTask({
            task_data: {
                meta: { modified: '2026-03-12T10:20:00.000Z' },
                content: {
                    question: SAVED_QUESTION,
                    reference_answer: SAVED_REFERENCE,
                    hint: '',
                    sequence_matters: false,
                    keywords: [],
                    images: []
                }
            },
            metadata: { id: 'task_001', name: 'OA Task' }
        }, { persisted: true });

        expect(document.querySelector('#question-textarea').value).toBe(DRAFT_QUESTION);
        expect(document.querySelector('#reference-textarea').value).toBe(DRAFT_REFERENCE);
        expect(document.querySelector('#hint-textarea').value).toBe(DRAFT_HINT);
        expect(document.querySelector('#sequence-order-check').checked).toBe(true);
        expect(editor.hasUnsavedChanges).toBe(true);
        expect(toastSpy).toHaveBeenCalled();
    });

    it('opens image preview and closes it with Escape', () => {
        editor.setupImagePreviewControls();

        editor.showImagePreview('/api/editor/image?path=modules/module_01/image_1.png');

        const overlay = document.querySelector('#image-preview-overlay');
        const previewImg = document.querySelector('#image-preview-img');
        expect(overlay.classList.contains('hidden')).toBe(false);
        expect(overlay.classList.contains('flex')).toBe(true);
        expect(previewImg.src).toContain('/api/editor/image?path=modules/module_01/image_1.png');
        expect(document.body.classList.contains('overflow-hidden')).toBe(true);

        document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(overlay.classList.contains('hidden')).toBe(true);
        expect(previewImg.getAttribute('src')).toBe('');
        expect(document.body.classList.contains('overflow-hidden')).toBe(false);
    });

    it('removes an image with undo toast and restores it on demand', () => {
        editor.task.task_data.content.images = ['img1.png'];
        editor.renderImages();

        const deleteBtn = document.querySelector('.open-answer-image-card .delete-btn');
        expect(deleteBtn).not.toBeNull();

        deleteBtn.click();

        expect(editor.task.task_data.content.images).toEqual([]);
        const toast = document.querySelector('#open-answer-toast');
        expect(toast).not.toBeNull();
        expect(toast.textContent).toContain('Изображение удалено.');
        const undoBtn = toast.querySelector('[data-toast-action="action"]');
        expect(undoBtn).not.toBeNull();

        undoBtn.click();

        expect(editor.task.task_data.content.images).toEqual(['img1.png']);
        expect(document.querySelectorAll('.open-answer-image-card')).toHaveLength(1);
    });

    it('ships readable open answer markup without mojibake in the save button and max length block', () => {
        const html = fs.readFileSync(
            path.resolve(process.cwd(), 'frontend/Editor/Open Answer Editor Textual Reasoning.html'),
            'utf8'
        );

        expect(html).toContain('Максимальная длина ответа');
        expect(html).toContain('Оставьте пустым, если ответ можно вводить без лимита');
        expect(html).toContain('<span class="material-symbols-outlined text-[18px]">save</span>');
    });

    it('renders an analysis beacon in the header and opens the panel on demand', () => {
        editor.task = {
            task_data: {
                meta: { module: 'module_01', topic: 'topic_01', id: 'task_001' },
                content: {}
            },
            metadata: { id: 'task_001' }
        };
        editor.moduleId = 'module_01';
        editor.topicId = 'topic_01';
        editor.taskId = 'task_001';

        dom.window.localStorage.setItem(editor.editorTheoryBridgeStorageKey, JSON.stringify({
            intent: 'editor_link',
            ai_run_id: 'bench_nephr_20260223'
        }));

        editor.initTheoryGroundingPanel();

        const beacon = document.getElementById('editor-theory-grounding-beacon');
        expect(beacon).not.toBeNull();
        expect(beacon.textContent).toContain('Есть контекст анализа');
        expect(document.getElementById('editor-theory-grounding-p8-panel')).toBeNull();

        beacon.click();

        const panel = document.getElementById('editor-theory-grounding-p8-panel');
        expect(panel).not.toBeNull();
        expect(panel.textContent).toContain('Связь с анализом');
        expect(panel.textContent).toContain('Контекст из отчёта');
        expect(panel.textContent).not.toContain('Coverage / Grounding');
        expect(panel.textContent).not.toContain('warnings');
        expect(panel.textContent).not.toContain('Применить refs из отчёта');
    });

    it('ignores stale automatic analysis context that was not explicitly sent to the editor', () => {
        editor.task = {
            task_data: {
                meta: { module: 'module_01', topic: 'topic_01', id: 'task_001' },
                content: {}
            },
            metadata: { id: 'task_001' }
        };
        editor.moduleId = 'module_01';
        editor.topicId = 'topic_01';
        editor.taskId = 'task_001';

        dom.window.localStorage.setItem(editor.editorTheoryBridgeStorageKey, JSON.stringify({
            source: 'theory_report',
            ai_run_id: 'bench_nephr_legacy_auto'
        }));

        editor.initTheoryGroundingPanel();

        expect(document.getElementById('editor-theory-grounding-beacon')).toBeNull();
        expect(document.getElementById('editor-theory-grounding-p8-panel')).toBeNull();
    });
    it('keeps nested hosted asset refs through image normalization and preview resolution', () => {
        const normalized = editor.normalizeImageReference({
            image: {
                asset_id: 'asset_open_editor_1',
                path: 'legacy/open-answer-image.png'
            }
        });

        expect(normalized).toEqual({
            path: 'legacy/open-answer-image.png',
            asset_id: 'asset_open_editor_1',
            asset_url: null,
        });
        expect(editor.resolveEditorImagePreviewSrc(normalized)).toBe(
            '/api/editor/image?asset_id=asset_open_editor_1'
        );
    });
});
