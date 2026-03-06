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

describe('ImportManager archive preview', () => {
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

    it('renders rich archive preview context and issue groups', () => {
        manager.importMode = 'archive';
        manager.selectedModule = 'mod_1';
        manager.selectedModuleName = 'Module 1';
        manager.selectedTopic = 'topic_1';
        manager.selectedTopicName = 'Topic 1';
        manager.parsedResult = {
            archive_version: '1.2.3',
            summary: {
                total: 2,
                valid: 1,
                conflicts: 1,
                errors: 1,
            },
            warnings: ['Archive created by another major version'],
            conflicts: {
                duplicates: [],
                overwrites: [
                    {
                        id: 'task_conflict',
                        name: 'Conflict Task',
                        diff_keys: ['content', 'settings'],
                    },
                ],
                broken_deps: [],
            },
            errors: [
                {
                    id: 'task_error',
                    name: 'Broken Task',
                    error: 'Missing images: x.png',
                },
            ],
            tasks: [
                {
                    id: 'task_conflict',
                    name: 'Conflict Task',
                    type: 'test',
                    status: 'conflict',
                    conflict_type: 'overwrite',
                    target_module: 'mod_1',
                    target_topic: 'topic_1',
                    diff_keys: ['content', 'settings'],
                    existing_path: 'modules/mod_1/topics/topic_1/tasks/task_conflict',
                },
                {
                    id: 'task_error',
                    name: 'Broken Task',
                    type: 'click',
                    status: 'error',
                    target_module: 'mod_1',
                    target_topic: 'topic_1',
                    error: 'Missing images: x.png',
                    warnings: ['Unknown task type extension'],
                },
            ],
        };

        const html = manager.renderStep3();

        expect(html).toContain('data-role="archive-import-preview"');
        expect(html).toContain('Module 1 / Topic 1');
        expect(html).toContain('Archive v1.2.3');
        expect(html).toContain('data-role="archive-import-issues"');
        expect(html).toContain('data-role="archive-import-warnings"');
        expect(html).toContain('Conflict Task');
        expect(html).toContain('Broken Task');
        expect(html).toContain('Missing images: x.png');
        expect(html).toContain('Изменённые ключи');
        expect(html).toContain('data-role="archive-import-task-card"');
    });

    it('step 4 counts only non-error non-excluded tasks', () => {
        manager.parsedResult = {
            tasks: [
                { status: 'valid' },
                { status: 'conflict' },
                { status: 'error' },
            ],
        };
        manager.excludedTasks.add(1);

        const html = manager.renderStep4();

        expect(html).toContain('Будет импортировано 1 заданий');
    });
});
