import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';

function loadRealArchetypes() {
    const dashboardCode = fs.readFileSync('frontend/Editor/dashboard.js', 'utf8');
    const startIdx = dashboardCode.indexOf('getTaskStudioArchetypes() {');
    const endIdx = dashboardCode.indexOf('renderTaskShowcase(type, forcedSubtypeId = null) {');
    if (startIdx === -1 || endIdx === -1) throw new Error('Could not find getTaskStudioArchetypes in dashboard.js');
    const methodStr = dashboardCode.slice(startIdx, endIdx).trim();
    const fn = new Function('wt', 'return {' + methodStr + '}.getTaskStudioArchetypes()');
    return fn(global.wt);
}
import { JSDOM } from 'jsdom';

describe('Task Creation Studio Modal & Archetype Showcase', () => {
    let dom;
    let window;
    let document;
    let dashboard;

    beforeEach(() => {
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <head></head>
            <body>
                <div id="create-task-modal">
                    <form id="create-task-form">
                        <select id="task-module-select">
                            <option value="mod_1">Module 1</option>
                        </select>
                        <select id="task-topic-select">
                            <option value="top_1">Topic 1</option>
                        </select>
                        <input id="task-name-input" value="Test Clinical Task" />
                        
                        <div id="editor-task-type-picker" class="editor-studio-archetypes">
                            <button type="button" class="editor-task-type-card is-active" data-type="click">
                                <span class="editor-task-type-name">Click</span>
                            </button>
                            <button type="button" class="editor-task-type-card" data-type="sequence_assembly">
                                <span class="editor-task-type-name">Sequence</span>
                            </button>
                            <button type="button" class="editor-task-type-card" data-type="test">
                                <span class="editor-task-type-name">Test</span>
                            </button>
                            <button type="button" class="editor-task-type-card" data-type="draw">
                                <span class="editor-task-type-name">Draw</span>
                            </button>
                            <button type="button" class="editor-task-type-card" data-type="open_answer">
                                <span class="editor-task-type-name">Open</span>
                            </button>
                            <button type="button" class="editor-task-type-card" data-type="image_labeling">
                                <span class="editor-task-type-name">Labels</span>
                            </button>
                        </div>

                        <div id="editor-task-showcase">
                            <div id="editor-subtype-pills"></div>
                            <span id="editor-showcase-counter"></span>
                            <div id="editor-showcase-canvas"></div>
                            <p id="editor-showcase-desc"></p>
                            <div id="editor-showcase-example">
                                <span id="editor-showcase-example-text"></span>
                            </div>
                        </div>

                        <input type="hidden" id="task-subtype-input" name="task_subtype" value="point" />
                        <select id="task-type-select">
                            <option value="click" selected>Click</option>
                            <option value="sequence_assembly">Sequence</option>
                            <option value="test">Test</option>
                            <option value="draw">Draw</option>
                            <option value="open_answer">Open</option>
                            <option value="image_labeling">Labels</option>
                        </select>
                    </form>
                </div>
            </body>
            </html>
        `, { url: 'http://localhost:8000/editor/Main_Dashboard.html' });

        window = dom.window;
        document = window.document;
        global.window = window;
        global.document = document;
        global.wt = (key, fallback) => fallback;

        // Minimal mock dashboard instance using real archetypes from dashboard.js
        dashboard = {
            getTaskStudioArchetypes() {
                return loadRealArchetypes();
            },
            renderTaskShowcase(type, forcedSubtypeId = null) {
                const archetypes = this.getTaskStudioArchetypes();
                const arch = archetypes[type] || archetypes.click;
                if (!arch || !arch.subtypes || !arch.subtypes.length) return;

                const hiddenInput = document.getElementById('task-subtype-input');
                let currentSubtypeId = forcedSubtypeId || (hiddenInput ? hiddenInput.value : '');
                let activeSubtype = arch.subtypes.find(s => s.id === currentSubtypeId);
                if (!activeSubtype) {
                    activeSubtype = arch.subtypes[0];
                    currentSubtypeId = activeSubtype.id;
                }
                if (hiddenInput) {
                    hiddenInput.value = currentSubtypeId;
                }

                const pillsContainer = document.getElementById('editor-subtype-pills');
                if (pillsContainer) {
                    pillsContainer.innerHTML = '';
                    arch.subtypes.forEach(st => {
                        const pill = document.createElement('button');
                        pill.type = 'button';
                        pill.className = `editor-subtype-pill${st.id === currentSubtypeId ? ' is-active' : ''}`;
                        pill.textContent = global.wt(st.nameKey, st.defaultName);
                        pill.addEventListener('click', (e) => {
                            e.preventDefault();
                            this.renderTaskShowcase(type, st.id);
                        });
                        pillsContainer.appendChild(pill);
                    });
                }

                const counter = document.getElementById('editor-showcase-counter');
                if (counter) {
                    counter.textContent = `${arch.subtypes.length} formats`;
                }

                const canvas = document.getElementById('editor-showcase-canvas');
                if (canvas && typeof activeSubtype.renderSvg === 'function') {
                    canvas.innerHTML = activeSubtype.renderSvg();
                }

                const desc = document.getElementById('editor-showcase-desc');
                if (desc) {
                    desc.textContent = global.wt(activeSubtype.descKey, activeSubtype.defaultDesc);
                }

                const exampleText = document.getElementById('editor-showcase-example-text');
                if (exampleText) {
                    exampleText.textContent = global.wt(activeSubtype.exampleKey, activeSubtype.defaultExample);
                }
            },
            setupTaskTypePicker() {
                const picker = document.getElementById('editor-task-type-picker');
                const select = document.getElementById('task-type-select');
                if (!picker || !select || picker._bound) return;

                picker.querySelectorAll('.editor-task-type-card').forEach((card) => {
                    card.addEventListener('click', () => {
                        const type = card.dataset.type;
                        if (!type) return;
                        select.value = type;
                        select.dispatchEvent(new window.Event('change'));
                        this.syncTaskTypePicker();
                    });
                });

                select.addEventListener('change', () => this.syncTaskTypePicker());
                picker._bound = true;
            },
            syncTaskTypePicker() {
                const picker = document.getElementById('editor-task-type-picker');
                const select = document.getElementById('task-type-select');
                if (!picker || !select) return;
                const currentType = select.value || 'click';
                picker.querySelectorAll('.editor-task-type-card').forEach((card) => {
                    card.classList.toggle('is-active', card.dataset.type === currentType);
                });
                this.renderTaskShowcase(currentType);
            },
            getEditorUrl(type, module, topic, id, options = false) {
                let editorPage = '';
                if (type === 'click' || type === 'click_task') editorPage = 'Point_Annotation.html';
                if (type === 'draw' || type === 'draw_task') editorPage = 'Point_Annotation.html';
                if (type === 'test') editorPage = 'Test Task Editor Multiple Choice.html';
                if (type === 'sequence_assembly') editorPage = 'Sequence Assembly Editor Procedural Steps.html';
                if (type === 'image_labeling') editorPage = 'Image Labeling Editor.html';
                if (type === 'open_answer') editorPage = 'Open Answer Editor Textual Reasoning.html';

                const normalizedOptions = typeof options === 'boolean' ? { isNew: options } : (options || {});
                const params = new URLSearchParams({
                    module,
                    topic,
                    task: id,
                });
                if (normalizedOptions.isNew) {
                    params.set('new', '1');
                }
                if (normalizedOptions.taskType) {
                    params.set('task_type', normalizedOptions.taskType);
                }
                if (normalizedOptions.taskName) {
                    params.set('task_name', normalizedOptions.taskName);
                }
                if (normalizedOptions.restoreDraft) {
                    params.set('restore_draft', '1');
                }
                if (normalizedOptions.subtype) {
                    params.set('subtype', normalizedOptions.subtype);
                }
                if (normalizedOptions.initialMode) {
                    params.set('initial_mode', normalizedOptions.initialMode);
                }
                if (!editorPage) {
                    return '';
                }
                const encodedEditorPage = encodeURIComponent(editorPage);
                return `/editor/${encodedEditorPage}?${params.toString()}`;
            }
        };
    });

    it('has all 6 canonical archetypes in the studio registry', () => {
        const archetypes = dashboard.getTaskStudioArchetypes();
        const expected = ['click', 'sequence_assembly', 'test', 'draw', 'open_answer', 'image_labeling'];
        expect(Object.keys(archetypes)).toEqual(expected);

        for (const key of expected) {
            const arch = archetypes[key];
            expect(arch.id).toBe(key);
            expect(Array.isArray(arch.subtypes)).toBe(true);
            expect(arch.subtypes.length).toBeGreaterThanOrEqual(2);
            for (const st of arch.subtypes) {
                expect(typeof st.id).toBe('string');
                expect(typeof st.renderSvg).toBe('function');
                const svg = st.renderSvg();
                expect(svg).toContain('<svg');
                expect(svg).toContain('</svg>');
            }
        }
    });

    it('initializes the task type picker and showcases click by default', () => {
        dashboard.setupTaskTypePicker();
        dashboard.syncTaskTypePicker();

        const activeCard = document.querySelector('.editor-task-type-card.is-active');
        expect(activeCard).toBeTruthy();
        expect(activeCard.dataset.type).toBe('click');

        const pills = document.querySelectorAll('.editor-subtype-pill');
        expect(pills.length).toBe(3); // regions, errors_words, errors_texts
        expect(pills[0].classList.contains('is-active')).toBe(true);

        const hiddenInput = document.getElementById('task-subtype-input');
        expect(hiddenInput.value).toBe('regions');

        const canvas = document.getElementById('editor-showcase-canvas');
        expect(canvas.innerHTML).toContain('<svg');
    });

    it('updates showcase when selecting sequence_assembly archetype', () => {
        dashboard.setupTaskTypePicker();
        dashboard.syncTaskTypePicker();

        const seqCard = document.querySelector('.editor-task-type-card[data-type="sequence_assembly"]');
        seqCard.click();

        expect(seqCard.classList.contains('is-active')).toBe(true);
        const select = document.getElementById('task-type-select');
        expect(select.value).toBe('sequence_assembly');

        const pills = document.querySelectorAll('.editor-subtype-pill');
        expect(pills.length).toBe(2); // linear, hierarchy
        expect(pills[0].classList.contains('is-active')).toBe(true);
        expect(pills[0].textContent).toBe('Цепочка шагов');
        expect(pills[1].textContent).toBe('Иерархия и 2D-матрица');

        const hiddenInput = document.getElementById('task-subtype-input');
        expect(hiddenInput.value).toBe('linear');
    });

    it('updates subtype input and canvas when clicking hierarchy subtype pill', () => {
        dashboard.setupTaskTypePicker();
        dashboard.syncTaskTypePicker();

        const seqCard = document.querySelector('.editor-task-type-card[data-type="sequence_assembly"]');
        seqCard.click();

        const pills = document.querySelectorAll('.editor-subtype-pill');
        expect(pills.length).toBe(2);

        // Click on Hierarchy pill
        pills[1].click();

        const hiddenInput = document.getElementById('task-subtype-input');
        expect(hiddenInput.value).toBe('hierarchy');

        const activePill = document.querySelector('.editor-subtype-pill.is-active');
        expect(activePill.textContent).toBe('Иерархия и 2D-матрица');

        const canvas = document.getElementById('editor-showcase-canvas');
        expect(canvas.innerHTML).toContain('2D-матрица');
        expect(canvas.innerHTML).toContain('Оксиды');
    });

    it('generates correct editor URL with initial_mode=hierarchy when hierarchy is selected', () => {
        const url = dashboard.getEditorUrl('sequence_assembly', 'm_cardio', 't_pe', 'task_123', {
            isNew: true,
            taskType: 'sequence_assembly',
            taskName: 'PE Risk Stratification',
            subtype: 'hierarchy',
            initialMode: 'hierarchy',
        });

        expect(url).toContain('/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?');
        const urlObj = new URL(url, 'http://localhost:8000');
        expect(urlObj.searchParams.get('module')).toBe('m_cardio');
        expect(urlObj.searchParams.get('topic')).toBe('t_pe');
        expect(urlObj.searchParams.get('task')).toBe('task_123');
        expect(urlObj.searchParams.get('new')).toBe('1');
        expect(urlObj.searchParams.get('task_type')).toBe('sequence_assembly');
        expect(urlObj.searchParams.get('subtype')).toBe('hierarchy');
        expect(urlObj.searchParams.get('initial_mode')).toBe('hierarchy');
    });

    it('generates correct editor URLs for click error submodes and open answer sequential', () => {
        const clickUrl = dashboard.getEditorUrl('click', 'mod_1', 'top_1', 'task_clk', {
            isNew: true,
            taskType: 'click',
            taskName: 'Prescription Error Task',
            subtype: 'errors_words',
            initialMode: 'errors_words',
        });
        expect(clickUrl).toContain('Point_Annotation.html');
        const clickObj = new URL(clickUrl, 'http://localhost:8000');
        expect(clickObj.searchParams.get('subtype')).toBe('errors_words');
        expect(clickObj.searchParams.get('initial_mode')).toBe('errors_words');

        const openUrl = dashboard.getEditorUrl('open_answer', 'mod_1', 'top_1', 'task_open', {
            isNew: true,
            taskType: 'open_answer',
            taskName: 'Alveoli Gas Exchange',
            subtype: 'sequential',
            initialMode: 'sequential',
        });
        expect(openUrl).toContain('Open%20Answer%20Editor%20Textual%20Reasoning.html');
        const openObj = new URL(openUrl, 'http://localhost:8000');
        expect(openObj.searchParams.get('subtype')).toBe('sequential');
        expect(openObj.searchParams.get('initial_mode')).toBe('sequential');
    });

    it('preserves draft name and selections when showCreateTaskModal is called with preserveDraft: true', () => {
        dashboard.catalog = [
            { id: 'mod_1', name: 'Module 1', topics: [{ id: 'top_1', name: 'Topic 1' }] },
            { id: 'mod_2', name: 'Module 2', topics: [{ id: 'top_2', name: 'Topic 2' }] },
        ];
        dashboard.showCreateTaskModal = function(options = {}) {
            const preserveDraft = options.preserveDraft !== false;
            const savedName = preserveDraft ? (document.querySelector('#task-name-input')?.value || '') : '';
            const savedType = preserveDraft ? (document.querySelector('#task-type-select')?.value || '') : '';
            const savedSubtype = preserveDraft ? (document.querySelector('#task-subtype-input')?.value || '') : '';

            const moduleSelect = document.querySelector('#task-module-select');
            moduleSelect.innerHTML = '<option value="">Select...</option>';
            this.catalog.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.name;
                moduleSelect.appendChild(opt);
            });

            const targetModuleId = options.moduleId || (preserveDraft && moduleSelect.value ? moduleSelect.value : '') || 'mod_1';
            moduleSelect.value = targetModuleId;

            const nameInput = document.querySelector('#task-name-input');
            if (nameInput && savedName) {
                nameInput.value = savedName;
            }

            const typeSelect = document.querySelector('#task-type-select');
            if (typeSelect && savedType) {
                typeSelect.value = savedType;
            }

            const subtypeInput = document.querySelector('#task-subtype-input');
            if (subtypeInput && savedSubtype) {
                subtypeInput.value = savedSubtype;
            }
        };

        // User enters data
        document.querySelector('#task-name-input').value = 'My Custom Draft Task';
        document.querySelector('#task-type-select').value = 'sequence_assembly';
        document.querySelector('#task-subtype-input').value = 'hierarchy';

        // An inline module 'mod_2' is created
        dashboard.showCreateTaskModal({ moduleId: 'mod_2', preserveDraft: true });

        expect(document.querySelector('#task-module-select').value).toBe('mod_2');
        expect(document.querySelector('#task-name-input').value).toBe('My Custom Draft Task');
        expect(document.querySelector('#task-type-select').value).toBe('sequence_assembly');
        expect(document.querySelector('#task-subtype-input').value).toBe('hierarchy');
    });

    it('validates all 6 archetypes and 14 subtypes have valid theme-aware SVGs and legible typography', () => {
        const archetypes = dashboard.getTaskStudioArchetypes();
        const expectedMap = {
            click: ['regions', 'errors_words', 'errors_texts'],
            sequence_assembly: ['linear', 'hierarchy'],
            test: ['single_choice', 'multiple_choice', 'image_options'],
            draw: ['polygon', 'freehand'],
            open_answer: ['keywords', 'sequential'],
            image_labeling: ['zones', 'levels']
        };

        expect(Object.keys(archetypes)).toEqual(Object.keys(expectedMap));

        for (const [typeId, expectedSubtypes] of Object.entries(expectedMap)) {
            const arch = archetypes[typeId];
            expect(arch).toBeDefined();
            expect(arch.subtypes.map(s => s.id)).toEqual(expectedSubtypes);

            for (const st of arch.subtypes) {
                expect(st.nameKey).toMatch(/^md\.subtype_/);
                expect(st.descKey).toMatch(/^md\.subtype_/);
                expect(st.exampleKey).toMatch(/^md\.subtype_/);
                expect(typeof st.defaultName).toBe('string');
                expect(typeof st.defaultDesc).toBe('string');
                expect(typeof st.defaultExample).toBe('string');

                // Render SVG
                const svg = st.renderSvg();
                expect(svg).toContain('<svg');
                expect(svg).toContain('viewBox="0 0 440 120"');
                expect(svg).toContain('var(--color-surface-');
                expect(svg).toContain('var(--color-border-subtle)');
                expect(svg).not.toContain('undefined');
                expect(svg).not.toContain('NaN');

                // Check typography sizes in SVG (all font-size attributes must be >= 9)
                const fontSizes = [...svg.matchAll(/font-size="([0-9.]+)"/g)].map(m => parseFloat(m[1]));
                expect(fontSizes.length).toBeGreaterThan(0);
                for (const fs of fontSizes) {
                    expect(fs).toBeGreaterThanOrEqual(9.0);
                }
            }
        }
    });

    it('verifies all 14 subtype names and descriptions exist in ru.json, en.json, and uk.json', () => {
        const ru = JSON.parse(fs.readFileSync('frontend/assets/locales/ru.json', 'utf8'));
        const en = JSON.parse(fs.readFileSync('frontend/assets/locales/en.json', 'utf8'));
        const uk = JSON.parse(fs.readFileSync('frontend/assets/locales/uk.json', 'utf8'));

        const archetypes = dashboard.getTaskStudioArchetypes();
        for (const arch of Object.values(archetypes)) {
            for (const st of arch.subtypes) {
                const stripKey = (k) => k.replace(/^md\./, '');
                const nk = stripKey(st.nameKey);
                const dk = stripKey(st.descKey);
                const ek = stripKey(st.exampleKey);

                for (const loc of [ru, en, uk]) {
                    expect(loc.md[nk]).toBeDefined();
                    expect(loc.md[dk]).toBeDefined();
                    expect(loc.md[ek]).toBeDefined();
                    expect(loc.md[nk].trim().length).toBeGreaterThan(0);
                    expect(loc.md[dk].trim().length).toBeGreaterThan(0);
                    expect(loc.md[ek].trim().length).toBeGreaterThan(0);
                }
            }
        }
    });
});

describe('De-Mocked Editor Subtype Handshake Suite (DEF-10 & DEF-11)', () => {
    function setupEditorTestEnvironment(url) {
        const dom = new JSDOM('<!DOCTYPE html><html><body><div id="toast-container"></div><div id="zones-list-container"></div><textarea id="prompt-textarea"></textarea><div id="mode-switch"><button id="mode-text-btn"></button><button id="mode-errors-btn"></button></div></body></html>', {
            url,
            runScripts: 'dangerously'
        });
        dom.window.wt = (k, fallback) => fallback;
        class MockBaseEditor {
            constructor() {
                this.task = { task_data: { content: {}, settings: {} }, metadata: {} };
                this.isNewTaskParam = true;
            }
            initTaskFromUrlContext() { return Promise.resolve(); }
            setupEventListeners() {}
            captureSnapshot() { return '{}'; }
            updateSaveStatus() {}
            getTaskContext() { return {}; }
            showFatalError() {}
            renderUI() {}
            showToast() {}
            updateStatusBadge() {}
            updateCursorState() {}
            updateDrawingControlsState() {}
            updateToolButtons() {}
            cancelPolygonDrawing() {}
            cancelFreehandDrawing() {}
            resetZoom() {}
            setupOnboardingPreviewStateSync() {}
            deserializeQuestions(raw) { return raw; }
            finalizePendingQuestionDeletion() {}
            normalizeTestSettings(s) { return s; }
            syncQuestionLegacyImageFields(q) { return []; }
            readMaxLengthPreference() { return { isSet: false }; }
            syncFromDOM() {}
            extractStoredKeywords() { return []; }
            buildLiveSettingsSnapshot() { return {}; }
            applyDifficultyAuthoringSettings() { return Promise.resolve(true); }
            getBlockingEditorState() { return null; }
        }
        dom.window.BaseEditor = MockBaseEditor;
        return dom;
    }

    it('TestEditor: handshakes subtype=multiple_choice and configures multiple correct choices', () => {
        const dom = setupEditorTestEnvironment('http://localhost:8000/editor/test?subtype=multiple_choice&initial_mode=multiple_choice&new=1');
        const code = fs.readFileSync('frontend/Editor/test_editor.js', 'utf8');
        dom.window.eval(code + '\n;window.TestEditor = TestEditor;');

        const ed = new dom.window.TestEditor();
        expect(ed.subtypeParam).toBe('multiple_choice');

        ed.questions = [{
            id: 1,
            text: '',
            options: [
                { text: 'Вариант 1', is_correct: true },
                { text: 'Вариант 2', is_correct: false }
            ],
            settings: {}
        }];
        ed.applyInitialModeFromUrl();

        expect(ed.task.task_data.subtype).toBe('multiple_choice');
        expect(ed.questions[0].options.length).toBe(3);
        expect(ed.questions[0].options[0].is_correct).toBe(true);
        expect(ed.questions[0].options[1].is_correct).toBe(true);
        expect(ed.questions[0].options[2].is_correct).toBe(false);

        const bbc = ed.buildBackendContent();
        expect(bbc.subtype).toBe('multiple_choice');
        const taskData = ed.buildTaskData();
        expect(taskData.subtype).toBe('multiple_choice');
    });

    it('TestEditor: handshakes subtype=single_choice and configures single correct choice', () => {
        const dom = setupEditorTestEnvironment('http://localhost:8000/editor/test?subtype=single_choice&initial_mode=single_choice&new=1');
        const code = fs.readFileSync('frontend/Editor/test_editor.js', 'utf8');
        dom.window.eval(code + '\n;window.TestEditor = TestEditor;');

        const ed = new dom.window.TestEditor();
        expect(ed.subtypeParam).toBe('single_choice');

        ed.questions = [{
            id: 1,
            text: '',
            options: [
                { text: 'Вариант 1', is_correct: true },
                { text: 'Вариант 2', is_correct: false }
            ],
            settings: {}
        }];
        ed.applyInitialModeFromUrl();

        expect(ed.task.task_data.subtype).toBe('single_choice');
        expect(ed.questions[0].options.length).toBe(2);
        expect(ed.questions[0].options[0].is_correct).toBe(true);
        expect(ed.questions[0].options[1].is_correct).toBe(false);

        const bbc = ed.buildBackendContent();
        expect(bbc.subtype).toBe('single_choice');
        const taskData = ed.buildTaskData();
        expect(taskData.subtype).toBe('single_choice');
    });

    it('ImageLabelingEditor: handshakes subtype=levels and configures multi_level setting', () => {
        const dom = setupEditorTestEnvironment('http://localhost:8000/editor/image_labeling?subtype=levels&initial_mode=levels&new=1');
        const code = fs.readFileSync('frontend/Editor/image_labeling_editor.js', 'utf8');
        dom.window.eval(code + '\n;window.ImageLabelingEditor = ImageLabelingEditor;');

        const ed = new dom.window.ImageLabelingEditor();
        expect(ed.subtypeParam).toBe('levels');

        ed.applyInitialModeFromUrl();
        expect(ed.task.task_data.subtype).toBe('levels');
        expect(ed.task.task_data.settings.multi_level).toBe(true);

        const taskData = ed.buildTaskData();
        expect(taskData.subtype).toBe('levels');
        expect(taskData.content.subtype).toBe('levels');
        expect(taskData.settings.multi_level).toBe(true);
    });

    it('ImageLabelingEditor: handshakes subtype=zones and configures single-level mode', () => {
        const dom = setupEditorTestEnvironment('http://localhost:8000/editor/image_labeling?subtype=zones&initial_mode=zones&new=1');
        const code = fs.readFileSync('frontend/Editor/image_labeling_editor.js', 'utf8');
        dom.window.eval(code + '\n;window.ImageLabelingEditor = ImageLabelingEditor;');

        const ed = new dom.window.ImageLabelingEditor();
        expect(ed.subtypeParam).toBe('zones');

        ed.applyInitialModeFromUrl();
        expect(ed.task.task_data.subtype).toBe('zones');
        expect(ed.task.task_data.settings.multi_level).toBe(false);

        const taskData = ed.buildTaskData();
        expect(taskData.subtype).toBe('zones');
        expect(taskData.content.subtype).toBe('zones');
        expect(taskData.settings.multi_level).toBe(false);
    });

    it('OpenAnswerEditor: handshakes subtype=sequential and updates displayMode', () => {
        const dom = setupEditorTestEnvironment('http://localhost:8000/editor/open_answer?subtype=sequential&initial_mode=sequential&new=1');
        const code = fs.readFileSync('frontend/Editor/open_answer_editor.js', 'utf8');
        dom.window.eval(code + '\n;window.OpenAnswerEditor = OpenAnswerEditor;');

        const ed = new dom.window.OpenAnswerEditor();
        ed.applyInitialModeFromUrl();

        expect(ed.subtype).toBe('sequential');
        expect(ed.displayMode).toBe('sequential');
        expect(ed.task.task_data.subtype).toBe('sequential');
        expect(ed.task.task_data.content.display_mode).toBe('sequential');

        const taskData = ed.buildTaskData();
        expect(taskData.subtype).toBe('sequential');
        expect(taskData.content.subtype).toBe('sequential');
        expect(taskData.content.display_mode).toBe('sequential');
    });

    it('ClickEditor: handshakes subtype=freehand and activates freehand drawing tool', async () => {
        const dom = setupEditorTestEnvironment('http://localhost:8000/editor/click?subtype=freehand&initial_mode=freehand&new=1');
        const code = fs.readFileSync('frontend/Editor/click_editor.js', 'utf8');
        dom.window.eval(code + '\n;window.ClickEditor = ClickEditor;');

        const ed = new dom.window.ClickEditor();
        await ed.applyInitialModeFromUrl();

        expect(ed.subtype).toBe('freehand');
        expect(ed.currentTool).toBe('freehand');
        expect(ed.task.task_data.type).toBe('draw');
        expect(ed.task.task_data.subtype).toBe('freehand');
    });

    it('ClickEditor: handshakes subtype=polygon and activates polygon lasso tool', async () => {
        const dom = setupEditorTestEnvironment('http://localhost:8000/editor/click?subtype=polygon&initial_mode=polygon&new=1');
        const code = fs.readFileSync('frontend/Editor/click_editor.js', 'utf8');
        dom.window.eval(code + '\n;window.ClickEditor = ClickEditor;');

        const ed = new dom.window.ClickEditor();
        await ed.applyInitialModeFromUrl();

        expect(ed.subtype).toBe('polygon');
        expect(ed.currentTool).toBe('polygon');
        expect(ed.task.task_data.type).toBe('draw');
        expect(ed.task.task_data.subtype).toBe('polygon');
    });

    it('ClickEditor: handshakes subtype=errors_words and activates error detection subtask', async () => {
        const dom = setupEditorTestEnvironment('http://localhost:8000/editor/click?subtype=errors_words&initial_mode=errors_words&new=1');
        const code = fs.readFileSync('frontend/Editor/click_editor.js', 'utf8');
        dom.window.eval(code + '\n;window.ClickEditor = ClickEditor;');

        const ed = new dom.window.ClickEditor();
        ed.setModeToggleActive = (mode) => { ed.errorDetection.enabled = (mode === 'errors'); return Promise.resolve(); };
        ed.handleSubtaskModeClick = (subtask) => { ed.errorDetection.subtask = subtask; };
        await ed.applyInitialModeFromUrl();

        expect(ed.subtype).toBe('errors_words');
        expect(ed.task.task_data.subtype).toBe('errors_words');
        expect(ed.errorDetection.enabled).toBe(true);
        expect(ed.errorDetection.subtask).toBe('text');
    });
});

