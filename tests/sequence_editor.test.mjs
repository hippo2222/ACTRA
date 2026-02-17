import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

function loadScript(filePath) {
    const fullPath = path.resolve(process.cwd(), filePath);
    return fs.readFileSync(fullPath, 'utf8');
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
    dom.window.__SEQUENCE_EDITOR_AUTO_INIT_DISABLED__ = true;
    dom.window.fetch = vi.fn();
    dom.window.alert = vi.fn();
    dom.window.confirm = vi.fn(() => true);

    // Load dependencies in order
    const undoManagerCode = loadScript('frontend/Editor/undo_manager.js');
    dom.window.eval(undoManagerCode + "\n;window.UndoManager = UndoManager;");

    const baseEditorCode = loadScript('frontend/Editor/base_editor.js');
    dom.window.eval(baseEditorCode + "\n;window.BaseEditor = BaseEditor;");

    const autoSaveCode = loadScript('frontend/Editor/autosave_manager.js');
    dom.window.eval(autoSaveCode + "\n;window.AutoSaveManager = AutoSaveManager;");

    const seqEditorCode = loadScript('frontend/Editor/sequence_editor.js');
    dom.window.eval(seqEditorCode + "\n;window.SequenceEditor = SequenceEditor;");

    return dom;
}

let dom = setupGlobalDom();
const SequenceEditor = dom.window.SequenceEditor;

function mountEditorDom() {
    document.body.innerHTML = `
        <input id="task-name-input" />
        <textarea id="prompt-textarea"></textarea>
        <input id="order-inside-matters" type="checkbox" />
        <input id="level-order-matters" type="checkbox" />
        <div id="levels-container"></div>
        <button id="clear-all-btn"></button>
        <button id="add-level-btn"></button>
        <button id="save-task-btn"></button>
        <input id="block-image-upload" type="file" />
    `;
}

function createEditorInstance() {
    const initSpy = vi.spyOn(SequenceEditor.prototype, 'init').mockImplementation(() => {});
    const instance = new SequenceEditor();
    initSpy.mockRestore();
    return instance;
}

describe('SequenceEditor', () => {
    let editor;

    beforeEach(() => {
        mountEditorDom();
        dom.window.alert = vi.fn();
        dom.window.fetch = vi.fn();
        editor = createEditorInstance();
        editor.moduleId = 'module_01';
        editor.topicId = 'topic_01';
        editor.taskId = 'task_999';
        editor.task = {
            task_data: {
                name: '',
                meta: { module: 'module_01', topic: 'topic_01' },
                content: {}
            },
            metadata: { id: 'task_999' }
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('buildStructure normalizes elements and levels', () => {
        editor.levels = [
            {
                levelId: 'level_a',
                title: 'Первый',
                items: [
                    { id: 'elem_1', label: 'Шаг А1', target_image: 'img1.png' },
                    { id: 'elem_2', label: 'Шаг А2', target_image: '' }
                ]
            },
            {
                levelId: 'level_b',
                title: '',
                items: [
                    { id: 'elem_1', label: 'Шаг А1', target_image: 'img1.png' },
                    { id: 'elem_3', label: 'Шаг B1', target_image: '' }
                ]
            }
        ];

        const result = editor.buildStructure();

        expect(result.elements).toHaveLength(3);
        expect(result.levels).toHaveLength(2);
        expect(result.levels[1].level_name).toBeUndefined();
        expect(result.levels[0].blocks).toEqual(['elem_1', 'elem_2']);
        expect(result.legacySequence[0].items[0]).toEqual({ id: 'elem_1', label: 'Шаг А1' });
    });

    it('saveTask posts normalized payload with elements and levels', async () => {
        document.querySelector('#task-name-input').value = 'Задание';
        document.querySelector('#prompt-textarea').value = 'Инструкция';
        document.querySelector('#order-inside-matters').checked = true;
        document.querySelector('#level-order-matters').checked = false;

        editor.levels = [
            {
                levelId: 'level_1',
                title: 'Уровень 1',
                items: [
                    { id: 'elem_1', label: 'Шаг 1', target_image: 'modules/img1.png' },
                    { id: 'elem_2', label: 'Шаг 2', target_image: '' }
                ]
            }
        ];

        dom.window.fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true })
        });

        await editor.saveTask();

        expect(dom.window.fetch).toHaveBeenCalledTimes(1);
        const [, options] = dom.window.fetch.mock.calls[0];
        const payload = JSON.parse(options.body);

        expect(payload.content.elements).toHaveLength(2);
        expect(payload.content.levels).toEqual([
            {
                level_id: 'level_1',
                level_name: 'Уровень 1',
                blocks: ['elem_1', 'elem_2']
            }
        ]);
        expect(payload.content.sequence).toHaveLength(1);
        expect(payload.content.sequence_within_level_matters).toBe(true);
        expect(payload.content.level_order_matters).toBe(false);
        expect(dom.window.alert).not.toHaveBeenCalled();
    });

    it('saveTask validates missing step descriptions', async () => {
        document.querySelector('#task-name-input').value = 'Задание';
        document.querySelector('#prompt-textarea').value = 'Инструкция';

        editor.levels = [
            {
                levelId: 'level_1',
                title: '',
                items: [{ id: 'elem_1', label: '', target_image: '' }]
            }
        ];

        const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});
        await editor.saveTask();

        expect(dom.window.fetch).not.toHaveBeenCalled();
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('Заполните описание шага 1'), 'warning');
    });

    it('deleteLevel prevents removing the last level', () => {
        editor.levels = [
            { levelId: 'level_1', title: '', items: [{ id: 'elem_1', label: 'Шаг', target_image: '' }] }
        ];

        editor.deleteLevel(0);

        expect(dom.window.alert).toHaveBeenCalledWith('Должен остаться минимум один уровень.');
        expect(editor.levels).toHaveLength(1);
    });

    it('deleteBlock prevents removing the last block in a level', () => {
        editor.levels = [
            { levelId: 'level_1', title: '', items: [{ id: 'elem_1', label: 'Шаг', target_image: '' }] }
        ];

        editor.deleteBlock(0, 0);

        expect(dom.window.alert).toHaveBeenCalledWith('В уровне должен быть хотя бы один шаг.');
        expect(editor.levels[0].items).toHaveLength(1);
    });
});
