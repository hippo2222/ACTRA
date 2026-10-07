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
        '<!DOCTYPE html><html><body><header><div class="flex items-center gap-3"></div></header><main id="app"></main></body></html>',
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
    defineGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0));
    dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);

    dom.window.wt = (key, fallback) => fallback;
    defineGlobal('wt', dom.window.wt);

    dom.window.fetch = vi.fn();
    defineGlobal('fetch', dom.window.fetch);

    return dom;
}

describe('Dashboard Task Duplication UI', () => {
    let dom;
    let mockDashboard;

    beforeEach(() => {
        dom = setupDom();
        // Setup mock minimal dashboard context
        mockDashboard = {
            selectedTasks: new Set(),
            selectionMode: false,
            isTaskUniqueIdPremiumArchived: vi.fn(() => false),
            showVoiceToast: vi.fn(),
            cancelSelection: vi.fn(),
            loadCatalog: vi.fn(async () => {}),
            renderSidebar: vi.fn(),
            refreshCurrentView: vi.fn(),
            renderRecoveryCenter: vi.fn(),
        };
        dom.window.dashboard = mockDashboard;
    });

    it('creates selection action bar with duplicate button', () => {
        const dashboardJs = loadScript('frontend/Editor/dashboard.js');
        const m1 = dashboardJs.slice(dashboardJs.indexOf('setupSelectionControls() {'), dashboardJs.indexOf('setupSidebarResizer() {'));
        dom.window.eval(`
            class TestDashboard {
                ${m1}
            }
            window.TestDashboard = TestDashboard;
        `);

        const inst = new dom.window.TestDashboard();
        Object.assign(inst, mockDashboard);
        inst.setupSelectionControls();

        const bar = dom.window.document.getElementById('selection-action-bar');
        expect(bar).not.toBeNull();

        const duplicateBtn = bar.querySelector('[data-role="selection-duplicate"]');
        expect(duplicateBtn).not.toBeNull();
        expect(duplicateBtn.textContent).toContain('Дублировать');
        expect(duplicateBtn.innerHTML).toContain('content_copy');
    });

    it('updateActionBar disables duplicate button when no tasks selected and enables when tasks present', () => {
        const dashboardJs = loadScript('frontend/Editor/dashboard.js');
        const m1 = dashboardJs.slice(dashboardJs.indexOf('setupSelectionControls() {'), dashboardJs.indexOf('setupSidebarResizer() {'));
        const m2 = dashboardJs.slice(dashboardJs.indexOf('updateActionBar() {'), dashboardJs.indexOf('async duplicateSelectedTasks() {'));
        dom.window.eval(`
            class TestDashboard {
                ${m1}
                ${m2}
            }
            window.TestDashboard = TestDashboard;
        `);

        const inst = new dom.window.TestDashboard();
        Object.assign(inst, mockDashboard);
        inst.setupSelectionControls();
        const bar = dom.window.document.getElementById('selection-action-bar');
        const duplicateBtn = bar.querySelector('[data-role="selection-duplicate"]');

        // With 0 selected tasks
        inst.selectedTasks = new Set();
        inst.updateActionBar();
        expect(duplicateBtn.disabled).toBe(true);

        // With 1 selected task
        inst.selectedTasks = new Set(['mod1:top1:task1']);
        inst.updateActionBar();
        expect(duplicateBtn.disabled).toBe(false);

        // With archived task selected
        inst.isTaskUniqueIdPremiumArchived = vi.fn(() => true);
        inst.updateActionBar();
        expect(duplicateBtn.disabled).toBe(true);
        expect(duplicateBtn.title).toContain('архив Premium');
    });

    it('duplicateSelectedTasks sends POST request and updates catalog on success', async () => {
        const dashboardJs = loadScript('frontend/Editor/dashboard.js');
        const m1 = dashboardJs.slice(dashboardJs.indexOf('setupSelectionControls() {'), dashboardJs.indexOf('setupSidebarResizer() {'));
        const m2 = dashboardJs.slice(dashboardJs.indexOf('updateActionBar() {'), dashboardJs.indexOf('async duplicateSelectedTasks() {'));
        const m3 = dashboardJs.slice(dashboardJs.indexOf('async duplicateSelectedTasks() {'), dashboardJs.indexOf('async exportSelectedTasks() {'));
        dom.window.eval(`
            class TestDashboard {
                ${m1}
                ${m2}
                ${m3}
            }
            window.TestDashboard = TestDashboard;
        `);

        const inst = new dom.window.TestDashboard();
        Object.assign(inst, mockDashboard);
        inst.setupSelectionControls();

        inst.selectedTasks = new Set(['mod1:top1:task_heart']);

        dom.window.fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                ok: true,
                duplicated_count: 1,
                duplicated: [
                    {
                        source_task_id: 'task_heart',
                        task_id: 'task_heart_copy1',
                        name: 'Анатомия сердца (копия 1)',
                    },
                ],
                errors: [],
            }),
        });

        await inst.duplicateSelectedTasks();

        expect(dom.window.fetch).toHaveBeenCalledWith('/api/editor/tasks/duplicate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tasks: [{ module_id: 'mod1', topic_id: 'top1', task_id: 'task_heart' }],
            }),
        });

        expect(inst.loadCatalog).toHaveBeenCalled();
        expect(inst.showVoiceToast).toHaveBeenCalledWith(
            expect.objectContaining({
                severity: 'success',
            })
        );
        expect(inst.selectedTasks.size).toBe(0);
    });

    it('duplicateSelectedTasks shows error voice toast when quota limit is exceeded', async () => {
        const dashboardJs = loadScript('frontend/Editor/dashboard.js');
        const m1 = dashboardJs.slice(dashboardJs.indexOf('setupSelectionControls() {'), dashboardJs.indexOf('setupSidebarResizer() {'));
        const m2 = dashboardJs.slice(dashboardJs.indexOf('updateActionBar() {'), dashboardJs.indexOf('async duplicateSelectedTasks() {'));
        const m3 = dashboardJs.slice(dashboardJs.indexOf('async duplicateSelectedTasks() {'), dashboardJs.indexOf('async exportSelectedTasks() {'));
        dom.window.eval(`
            class TestDashboard {
                ${m1}
                ${m2}
                ${m3}
            }
            window.TestDashboard = TestDashboard;
        `);

        const inst = new dom.window.TestDashboard();
        Object.assign(inst, mockDashboard);
        inst.setupSelectionControls();

        inst.selectedTasks = new Set(['mod1:top1:task_heart']);

        dom.window.fetch.mockResolvedValueOnce({
            ok: false,
            status: 409,
            json: async () => ({
                ok: false,
                error: 'workspace_task_limit_exceeded',
                message: 'Limit reached',
            }),
        });

        await inst.duplicateSelectedTasks();

        expect(inst.showVoiceToast).toHaveBeenCalledWith(
            expect.objectContaining({
                severity: 'error',
                what: 'Превышен лимит заданий на тарифе.',
            })
        );
    });

    it('cancelSelection and toggleSelectionMode refresh current view instead of forcing renderGrid', () => {
        const dashboardJs = loadScript('frontend/Editor/dashboard.js');
        const mSelection = dashboardJs.slice(
            dashboardJs.indexOf('toggleSelectionMode() {'),
            dashboardJs.indexOf('handleTaskSelection(uniqueId, isSelected, isShiftClick) {')
        );
        dom.window.eval(`
            class TestDashboard {
                ${mSelection}
            }
            window.TestDashboard = TestDashboard;
        `);

        const inst = new dom.window.TestDashboard();
        Object.assign(inst, mockDashboard);
        delete inst.cancelSelection;
        inst.renderGrid = vi.fn();
        inst.refreshCurrentView = vi.fn();
        inst.updateActionBar = vi.fn();

        inst.selectionMode = true;
        inst.toggleSelectionMode();
        expect(inst.refreshCurrentView).toHaveBeenCalled();
        expect(inst.renderGrid).not.toHaveBeenCalled();

        inst.refreshCurrentView.mockClear();
        inst.cancelSelection();
        expect(inst.refreshCurrentView).toHaveBeenCalled();
        expect(inst.renderGrid).not.toHaveBeenCalled();

        inst.refreshCurrentView.mockClear();
        inst.cancelSelection({ rerender: false });
        expect(inst.refreshCurrentView).not.toHaveBeenCalled();
    });

    it('duplicateSelectedTasks preserves activeModuleId and activeTopicId without intermediate render', async () => {
        const dashboardJs = loadScript('frontend/Editor/dashboard.js');
        const m1 = dashboardJs.slice(dashboardJs.indexOf('setupSelectionControls() {'), dashboardJs.indexOf('setupSidebarResizer() {'));
        const m2 = dashboardJs.slice(dashboardJs.indexOf('updateActionBar() {'), dashboardJs.indexOf('async duplicateSelectedTasks() {'));
        const m3 = dashboardJs.slice(dashboardJs.indexOf('async duplicateSelectedTasks() {'), dashboardJs.indexOf('async exportSelectedTasks() {'));
        dom.window.eval(`
            class TestDashboard {
                ${m1}
                ${m2}
                ${m3}
            }
            window.TestDashboard = TestDashboard;
        `);

        const inst = new dom.window.TestDashboard();
        Object.assign(inst, mockDashboard);
        inst.setupSelectionControls();

        inst.activeModuleId = 'mod_xray';
        inst.activeTopicId = 'top_chest';
        inst.selectedTasks = new Set(['mod_xray:top_chest:task1']);

        dom.window.fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                ok: true,
                duplicated_count: 1,
                duplicated: [{ source_task_id: 'task1', task_id: 'task1_copy', name: 'Task 1 (Copy)' }]
            }),
        });

        await inst.duplicateSelectedTasks();

        expect(inst.cancelSelection).toHaveBeenCalledWith({ rerender: false });
        expect(inst.activeModuleId).toBe('mod_xray');
        expect(inst.activeTopicId).toBe('top_chest');
        expect(inst.renderSidebar).toHaveBeenCalled();
        expect(inst.refreshCurrentView).toHaveBeenCalled();
    });

    it('updateTaskNameInCatalog updates catalog and synchronously synchronizes task label in the sidebar', () => {
        const dashboardJs = loadScript('frontend/Editor/dashboard.js');
        const mCreateTask = dashboardJs.slice(
            dashboardJs.indexOf('createTaskElement(task, moduleId, topicId) {'),
            dashboardJs.indexOf('expandSidebarModule(moduleId, { saveState = true } = {}) {')
        );
        const mUpdateCatalog = dashboardJs.slice(
            dashboardJs.indexOf('updateTaskNameInCatalog(moduleId, topicId, taskId, newName) {'),
            dashboardJs.indexOf('showTaskRenameUndoToast({ moduleId, topicId, taskId, oldName, newName, titleEl, taskObj }) {')
        );
        dom.window.eval(`
            class TestDashboard {
                ${mCreateTask}
                ${mUpdateCatalog}
            }
            window.TestDashboard = TestDashboard;
        `);

        const inst = new dom.window.TestDashboard();
        inst.catalog = [
            {
                id: 'mod1',
                topics: [
                    {
                        id: 'top1',
                        tasks: [
                            { id: 'task1', name: 'Original Name' }
                        ]
                    }
                ]
            }
        ];
        inst.favoriteTaskMap = {};
        inst.recentTasks = [];
        inst.saveWorkspaceShortcuts = vi.fn();
        inst.renderWorkspaceShortcuts = vi.fn();

        // Create sidebar task button and attach to DOM
        const sidebarContainer = dom.window.document.createElement('div');
        sidebarContainer.dataset.topic = 'mod1:top1';
        const taskBtn = inst.createTaskElement({ id: 'task1', name: 'Original Name', type: 'test' }, 'mod1', 'top1');
        sidebarContainer.appendChild(taskBtn);
        dom.window.document.body.appendChild(sidebarContainer);

        expect(taskBtn.dataset.sidebarTaskId).toBe('task1');
        expect(taskBtn.dataset.taskUniqueId).toBe('mod1:top1:task1');

        const label = taskBtn.querySelector('.editor-sidebar-tree-label');
        expect(label.textContent).toBe('Original Name');

        // Execute rename
        inst.updateTaskNameInCatalog('mod1', 'top1', 'task1', 'Renamed Task');

        // Verify in-memory catalog
        expect(inst.catalog[0].topics[0].tasks[0].name).toBe('Renamed Task');

        // Verify DOM label in sidebar
        expect(label.textContent).toBe('Renamed Task');
        expect(label.title).toBe('Renamed Task');

        // Execute undo / revert
        inst.updateTaskNameInCatalog('mod1', 'top1', 'task1', 'Original Name');
        expect(inst.catalog[0].topics[0].tasks[0].name).toBe('Original Name');
        expect(label.textContent).toBe('Original Name');
        expect(label.title).toBe('Original Name');
    });
});
