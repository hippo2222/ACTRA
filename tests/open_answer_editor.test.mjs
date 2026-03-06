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
    dom.window.eval(loadScript('frontend/Editor/base_editor.js') + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript('frontend/Editor/autosave_manager.js') + "\n;window.AutoSaveManager = AutoSaveManager;");
    dom.window.eval(loadScript('frontend/Editor/open_answer_editor.js') + "\n;window.OpenAnswerEditor = OpenAnswerEditor;");

    return dom;
}

let dom = setupGlobalDom();
const OpenAnswerEditor = dom.window.OpenAnswerEditor;

function mountEditorDom() {
    document.body.innerHTML = `
        <header>
            <button id="back-btn"></button>
            <h2></h2>
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
        <select id="min-keywords-input">
            <option value="1">1</option>
            <option value="-1">all</option>
        </select>
        <input id="sequence-order-check" type="checkbox" />
        <div id="images-container">
            <button id="add-image-btn"><span class="add-image-label">Добавить изображение</span></button>
        </div>
        <input id="image-upload-input" type="file" multiple />
        <button class="bg-primary"></button>
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
        editor = createEditorInstance();
        editor.task = {
            task_data: {
                meta: { module: 'module_01', topic: 'topic_01' },
                content: {
                    question: '',
                    reference_answer: '',
                    hint: '',
                    max_length: 500,
                    min_keywords: 1,
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
        document.querySelector('#question-textarea').value = 'Новый вопрос';
        document.querySelector('#reference-textarea').value = 'Правильный ответ';
        document.querySelector('#hint-textarea').value = 'Подсказка';
        document.querySelector('#max-length-input').value = '600';
        document.querySelector('#min-keywords-input').value = '1';
        document.querySelector('#sequence-order-check').checked = true;

        editor.sequenceMatters = true;
        editor.keywords = [
            { text: 'Печень', normalized: 'печень', required: true },
            { text: 'Здоровье', normalized: 'здоровье', required: false }
        ];
        editor.task.task_data.content.images = ['img1.png'];

        dom.window.fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true })
        });

        await editor.saveTask();

        expect(dom.window.fetch).toHaveBeenCalledTimes(1);
        const [, options] = dom.window.fetch.mock.calls[0];
        const payload = JSON.parse(options.body);

        expect(payload.content.question).toBe('Новый вопрос');
        expect(payload.content.reference_answer).toBe('Правильный ответ');
        expect(payload.content.hint).toBe('Подсказка');
        expect(payload.content.max_length).toBe(500);
        expect(payload.content.min_keywords).toBe(1);
        expect(payload.content.require_all_keywords).toBe(false);
        expect(payload.content.sequence_matters).toBe(true);
        expect(payload.content.keywords).toEqual(['Печень']);
        expect(payload.content.images).toEqual(['img1.png']);

        expect(dom.window.alert).not.toHaveBeenCalled();
    });
});
