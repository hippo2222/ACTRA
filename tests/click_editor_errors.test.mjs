import { describe, it, expect, beforeEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

function setupDom() {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
        url: "http://localhost",
        runScripts: "dangerously",
        resources: "usable"
    });

    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;

    dom.window.fetch = vi.fn();
    dom.window.alert = vi.fn();
    dom.window.confirm = vi.fn(() => true);
    dom.window.__CLICK_EDITOR_AUTO_INIT_DISABLED__ = true;
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({
        drawImage: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
        moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
        save: vi.fn(), restore: vi.fn(), measureText: () => ({ width: 0 }),
    });

    // Load dependencies in order
    dom.window.eval(loadScript("frontend/Editor/undo_manager.js") + "\n;window.UndoManager = UndoManager;");
    dom.window.eval(loadScript("frontend/Editor/click_editor_helpers.js"));
    dom.window.wt = (key, fallback) => fallback;
    dom.window.eval(loadScript("frontend/Editor/base_editor.js") + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript("frontend/Editor/autosave_manager.js") + "\n;window.AutoSaveManager = AutoSaveManager;");
    dom.window.eval(loadScript("frontend/Editor/click_editor.js") + "\n;window.ClickEditor = ClickEditor;");

    return dom;
}

const dom = setupDom();

const dispatchDomReady = () => {
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
};

const buildErrorsPane = () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
        <div>
            <div data-errors-text-editor-wrapper>
                <textarea data-errors-text-editor></textarea>
                <div data-errors-highlight-layer></div>
                <button data-errors-add-span-btn disabled></button>
                <div data-errors-selection-hint></div>
                <input data-errors-required-correct />
                <span data-errors-total-count></span>
                <button data-errors-clear-all></button>
                <table>
                    <tbody data-errors-span-list></tbody>
                </table>
                <div data-errors-spans-empty></div>
            </div>
            <div data-reference-section>
                <textarea data-reference-text-editor></textarea>
                <div data-reference-highlight-layer></div>
                <button data-reference-add-span-btn disabled></button>
                <div data-reference-selection-hint></div>
                <span data-reference-char-counter></span>
                <button data-reference-clear-all></button>
                <button data-reference-copy-btn></button>
                <div data-reference-spans-empty></div>
                <table>
                    <tbody data-reference-span-list></tbody>
                </table>
            </div>
            <div data-errors-subpane="errors">
                <div data-choice-prompt-preview></div>
                <div data-choice-prompt-area>
                    <textarea id="choice-prompt-textarea"></textarea>
                </div>
                <button data-choice-prompt-toggle>
                    <span data-choice-prompt-icon></span>
                    <span data-choice-prompt-label></span>
                </button>
            </div>
        </div>
    `;
    return wrapper.firstElementChild; // return the outer div
};

const createEditorInstance = () => {
    const editorClass = dom.window.ClickEditor;
    if (!editorClass) {
        throw new Error("ClickEditor is not available on dom.window.ClickEditor");
    }
    const initSpy = vi.spyOn(editorClass.prototype, "init").mockResolvedValue(undefined);
    const instance = new editorClass();
    initSpy.mockRestore();
    return instance;
};

const buildAdditionalMaterialsShell = () => {
    document.body.innerHTML = `
        <div id="app">
            <textarea id="prompt-textarea"></textarea>
            <textarea id="choice-prompt-textarea"></textarea>
            <input id="required-correct-input" value="1" />
            <span id="required-correct-context"></span>
            <p id="required-correct-hint"></p>
            <button id="additional-info-toggle-btn" type="button" aria-expanded="true">
                <span id="additional-info-toggle-icon">expand_less</span>
            </button>
            <div id="additional-info-content">
                <select id="additional-type-select">
                    <option value="none">Нет</option>
                    <option value="text">Текст</option>
                    <option value="image">Изображение</option>
                    <option value="combined">Текст + изображение</option>
                </select>
                <div id="additional-text-group" class="hidden">
                    <textarea id="additional-textarea"></textarea>
                </div>
                <div id="additional-images-group" class="hidden">
                    <button id="additional-add-image-btn" type="button">Добавить</button>
                    <div id="additional-images-grid"></div>
                    <div id="additional-images-empty">Нет изображений</div>
                    <input id="additional-image-input" type="file" />
                </div>
            </div>
            <div id="image-preview-modal" class="hidden"></div>
            <img id="image-preview-img" />
            <button id="image-preview-close" type="button"></button>
        </div>
    `;
};

const buildRequiredCorrectShell = (value = "1") => {
    document.body.innerHTML = `
        <div id="app">
            <input id="required-correct-input" value="${value}" />
            <span id="required-correct-context"></span>
            <p id="required-correct-hint"></p>
        </div>
    `;
};

describe("ClickEditor errors pane (jsdom)", () => {
    let editor;
    let pane;

    beforeEach(() => {
        // fresh DOM
        document.body.innerHTML = `<div id="app"></div>`;
        // stub dialogs
        window.alert = vi.fn();
        window.confirm = vi.fn(() => true);
        dispatchDomReady();
        pane = buildErrorsPane();
        document.getElementById("app").appendChild(pane);
        editor = createEditorInstance();
        editor.errorsModePane = document.getElementById("app");
        editor.errorsPaneInitialized = false;
        editor.initErrorsPaneComponents();
        editor.errorDetection.text = "abc def";
        editor.errorsTextEditor.value = editor.errorDetection.text;
        editor.referenceData.text = "  foo  ";
        if (editor.referenceTextEditor) {
            editor.referenceTextEditor.value = editor.referenceData.text;
        }
        editor.renderErrorsHighlightLayer();
        editor.updateErrorsAddButtonState();
        editor.updateErrorsTotalCount();
    });

    it("adds an error span from selection and clears selection state", () => {
        editor.errorsTextEditor.setSelectionRange(0, 3);
        editor.handleErrorsTextSelection();
        editor.handleErrorsAddSpan();

        const spans = editor.getErrorSpansArray();
        expect(spans.length).toBe(1);
        expect(spans[0]).toMatchObject({ start: 0, end: 3 });
        expect(editor.errorsTextSelection).toBeNull();
        expect(editor.errorsAddSpanBtn.disabled).toBe(true);
    });

    it("clears all spans and resets selection/highlight on clear-all", async () => {
        const spans = editor.getErrorSpansArray();
        spans.push({ start: 0, end: 3 });
        editor.renderErrorsSpanList();
        editor.renderErrorsHighlightLayer();
        editor.updateErrorsAddButtonState();

        editor.errorsTextSelection = { start: 0, end: 3 };
        editor.errorsTextEditor.setSelectionRange(0, 3);

        const clearPromise = editor.handleErrorsClearAll();
        const modal = document.getElementById("custom-confirm-modal");
        expect(modal).toBeTruthy();
        modal.querySelector("#confirm-modal-btn").click();
        await clearPromise;

        expect(spans.length).toBe(0);
        expect(editor.errorsTextSelection).toBeNull();
        expect(editor.errorsTextEditor.selectionStart).toBe(0);
        expect(editor.errorsTextEditor.selectionEnd).toBe(0);
        expect(editor.errorsAddSpanBtn.disabled).toBe(true);
    });

    it("updates counters and required_correct when spans change", () => {
        editor.updateErrorsTotalCount();
        expect(editor.errorsTotalCountLabel.textContent).toBe("0");
        expect(editor.errorsRequiredCorrectInput.value).toBe("0");

        const spans = editor.getErrorSpansArray();
        spans.push({ start: 1, end: 4 });
        editor.updateErrorsTotalCount(); // also syncs required_correct

        expect(editor.errorsTotalCountLabel.textContent).toBe("1");
        expect(editor.errorsRequiredCorrectInput.value).toBe("1");
    });

    it("trims whitespace from reference selection before adding span", () => {
        if (!editor.referenceTextEditor) throw new Error("referenceTextEditor missing");
        const spans = editor.getReferenceSpansArray();
        editor.referenceTextEditor.setSelectionRange(0, editor.referenceTextEditor.value.length);
        editor.handleReferenceTextSelection();
        editor.handleReferenceAddSpan();
        expect(spans.length).toBe(1);
        expect(spans[0]).toMatchObject({ start: 2, end: 5 }); // "foo" without spaces
        expect(editor.referenceSelection).toBeNull();
        expect(editor.referenceAddSpanBtn.disabled).toBe(true);
    });
    it("captures the live prompt fields in the draft state", () => {
        buildAdditionalMaterialsShell();
        const editor = createEditorInstance();
        editor.cacheDom();
        editor.task = {
            task_data: {
                content: {
                    prompt: "Старая версия",
                    choice_prompt: "Старый выбор",
                    required_correct: 1
                },
                settings: {}
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.annotations = [
            {
                type: "polygon",
                label: "Контур 1",
                points: [[0, 0], [10, 10], [20, 20]],
                color: "#111111"
            }
        ];
        editor.promptArea.value = "  Новая формулировка  ";
        editor.choicePromptTextarea.value = "  Новый выбор  ";
        editor.requiredCorrectInput.value = "2";

        const state = editor.captureState();

        expect(state.content.prompt).toBe("  Новая формулировка  ");
        expect(state.content.choice_prompt).toBe("  Новый выбор  ");
        expect(state.content.required_correct).toBe(2);
        expect(state.content.annotations).toHaveLength(1);
    });

    it("captures success_threshold in the draft settings snapshot for regular click tasks", () => {
        buildAdditionalMaterialsShell();
        const editor = createEditorInstance();
        editor.cacheDom();
        editor.task = {
            task_data: {
                content: {
                    prompt: "Старая версия",
                    required_correct: 1
                },
                settings: {
                    success_threshold: 1,
                    custom_flag: true
                }
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.requiredCorrectInput.value = "3";

        const state = editor.captureState();

        expect(state.settings.success_threshold).toBe(3);
        expect(state.settings.custom_flag).toBe(true);
    });
});

describe("ClickEditor semantic warnings", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = `<div id="app"></div>`;
        window.alert = vi.fn();
        window.confirm = vi.fn(() => true);
        dispatchDomReady();
    });

    it("detects overlapping spans in error-detection mode", () => {
        const editor = createEditorInstance();
        editor.task = {
            task_data: {
                content: {
                    mode: "text_errors",
                    text: "abcdef",
                    error_spans: []
                },
                subtype: "error_detection"
            }
        };
        editor.errorDetection.enabled = true;
        editor.errorDetection.mode = "text_errors";
        editor.errorDetection.text = "abcdef";
        editor.errorDetection.errorSpans = [
            { start: 0, end: 3 },
            { start: 2, end: 5 }
        ];

        const warnings = editor.getSemanticWarnings();

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("пересеч");
    });

    it("does not warn when required threshold equals the total number of contours", () => {
        const editor = createEditorInstance();
        editor.task = {
            task_data: {
                content: {
                    image: "/img.png",
                    required_correct: 3
                },
                settings: {
                    success_threshold: 3
                }
            }
        };
        editor.annotations = [
            { label: "Очаг 1", points: [[0, 0], [10, 0], [10, 10]], type: "polygon" },
            { label: "Очаг 2", points: [[20, 20], [30, 20], [30, 30]], type: "polygon" },
            { label: "Очаг 3", points: [[40, 40], [50, 40], [50, 50]], type: "polygon" }
        ];

        const warnings = editor.getSemanticWarnings();
        expect(warnings).toEqual([]);
    });
});

describe("ClickEditor confirmations", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = `<div id="app"></div>`;
        window.alert = vi.fn();
        window.confirm = vi.fn(() => true);
        dispatchDomReady();
    });

    it("uses the custom confirm modal instead of browser confirm", async () => {
        const editor = createEditorInstance();

        editor.buildDraftRecoveryCopy = vi.fn(() => ({
            title: "Восстановить несохранённый черновик?",
            message: "На этом устройстве есть автосохранённый черновик.",
            confirmText: "Открыть черновик",
            cancelText: "Открыть сохранённую версию",
        }));

        const resultPromise = editor.confirmAction({
            title: "Восстановить несохранённый черновик?",
            message: "На этом устройстве есть автосохранённый черновик.",
            confirmText: "Открыть черновик",
            cancelText: "Открыть сохранённую версию",
            variant: "info",
        });

        const modal = document.getElementById("custom-confirm-modal");
        expect(modal).toBeTruthy();
        expect(window.confirm).not.toHaveBeenCalled();

        modal.querySelector("#confirm-modal-btn").click();

        await expect(resultPromise).resolves.toBe(true);
    });
});

describe("ClickEditor draft recovery", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = `<div id="app"></div>`;
        window.alert = vi.fn();
        window.confirm = vi.fn(() => true);
        dispatchDomReady();
    });

    it("uses plain-language recovery copy for unsaved changes", () => {
        const editor = createEditorInstance();

        const copy = editor.buildDraftRecoveryCopy(
            { timestamp: "2026-03-12T10:35:00.000Z" },
            "2026-03-12T10:20:00.000Z"
        );

        expect(copy.title).toBe("Вернуть несохранённые изменения?");
        expect(copy.message).toContain("несохранённые изменения");
        expect(copy.message).toContain("последней сохранённой версии");
        expect(copy.confirmText).toBe("Вернуть изменения");
        expect(copy.cancelText).toBe("Открыть сохранённую версию");
    });

    it("restores unsaved changes automatically after a reload without showing the modal", async () => {
        const editor = createEditorInstance();
        const draftData = {
            content: { prompt: "Локальная версия" },
            annotations: [],
        };
        const startSpy = vi.fn();

        editor.autoSaveManager = {
            hasFresherDraft: vi.fn(() => true),
            loadDraft: vi.fn(() => ({
                timestamp: "2026-03-12T10:35:00.000Z",
                data: draftData,
            })),
            start: startSpy,
        };
        editor.isReloadNavigation = vi.fn(() => true);
        editor.confirmAction = vi.fn();
        editor.restoreState = vi.fn();
        editor.showToast = vi.fn();
        editor.cleanupPersistedTaskRoute = vi.fn();

        await editor.hydrateTask({
            task_data: {
                content: {},
                settings: {},
                meta: { modified: "2026-03-12T10:20:00.000Z" },
            },
        }, { persisted: true });

        expect(editor.confirmAction).not.toHaveBeenCalled();
        expect(editor.restoreState).toHaveBeenCalledWith(draftData);
        expect(editor.showToast).toHaveBeenCalledWith("Восстановлены несохранённые изменения", "info");
        expect(startSpy).toHaveBeenCalled();
        expect(editor.hasUnsavedChanges).toBe(true);
        expect(editor.cleanupPersistedTaskRoute).not.toHaveBeenCalled();
    });
});

describe("ClickEditor additional materials", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        buildAdditionalMaterialsShell();
        window.alert = vi.fn();
        window.confirm = vi.fn(() => true);
        dispatchDomReady();
    });

    it("reveals the correct inputs when switching additional material type", () => {
        const editor = createEditorInstance();

        editor.handleAdditionalTypeChange({ target: { value: "text" } });
        expect(editor.additionalTypeSelect.value).toBe("text");
        expect(editor.additionalTextGroup.classList.contains("hidden")).toBe(false);
        expect(editor.additionalImagesGroup.classList.contains("hidden")).toBe(true);

        editor.handleAdditionalTypeChange({ target: { value: "image" } });
        expect(editor.additionalTypeSelect.value).toBe("image");
        expect(editor.additionalTextGroup.classList.contains("hidden")).toBe(true);
        expect(editor.additionalImagesGroup.classList.contains("hidden")).toBe(false);

        editor.handleAdditionalTypeChange({ target: { value: "combined" } });
        expect(editor.additionalTypeSelect.value).toBe("combined");
        expect(editor.additionalTextGroup.classList.contains("hidden")).toBe(false);
        expect(editor.additionalImagesGroup.classList.contains("hidden")).toBe(false);
    });

    it("toggles the additional materials section", () => {
        const editor = createEditorInstance();
        const toggleBtn = document.getElementById("additional-info-toggle-btn");
        const content = document.getElementById("additional-info-content");
        const icon = document.getElementById("additional-info-toggle-icon");

        editor.initAdditionalInfoToggle();

        expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");
        expect(content.classList.contains("hidden")).toBe(false);

        toggleBtn.click();
        expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");
        expect(content.classList.contains("hidden")).toBe(true);
        expect(icon.textContent).toBe("expand_more");

        toggleBtn.click();
        expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");
        expect(content.classList.contains("hidden")).toBe(false);
        expect(icon.textContent).toBe("expand_less");
    });

    it("keeps additional materials when saving an error-detection task", async () => {
        const editor = createEditorInstance();
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, meta: { authoring_enabled: false } })
        });

        window.fetch = fetchMock;
        editor.task = {
            metadata: { id: "task1", module: "m1", topic: "t1", name: "Task 1" },
            task_data: {
                type: "click",
                meta: { id: "task1", module: "m1", topic: "t1", name: "Task 1" },
                content: {
                    prompt: "Prompt",
                    mode: "text_choice",
                }
            }
        };
        editor.moduleId = "m1";
        editor.topicId = "t1";
        editor.taskId = "task1";
        editor.promptArea.value = "Prompt";
        editor.choicePromptTextarea.value = "Выберите вариант";
        editor.errorDetection.enabled = true;
        editor.errorDetection.mode = "text_choice";
        editor.validateErrorDetectionBeforeSave = vi.fn(() => true);
        editor.enableErrorDetectionEditor = vi.fn();
        editor.applyErrorsRequiredCorrectToContent = vi.fn();
        editor.applyReferenceDataToContent = vi.fn();
        editor.serializeAdditionalInfo = vi.fn(() => ({ type: "text", text: "Hint text" }));
        editor.getSemanticWarnings = vi.fn(() => []);
        editor.showToast = vi.fn();
        editor.updateSaveStatus = vi.fn();
        editor.captureTaskSnapshot = vi.fn(() => "snapshot");
        editor.autoSaveManager = { clearDraft: vi.fn() };
        editor.clearTaskBootstrap = vi.fn();
        editor.cleanupPersistedTaskRoute = vi.fn();

        await editor.saveTask();

        expect(fetchMock).toHaveBeenCalled();
        expect(editor.task.task_data.content.additionalInfo).toEqual({ type: "text", text: "Hint text" });
        expect(editor.additionalInfoDirty).toBe(false);
    });

    it("captures the live additional text for draft recovery", () => {
        const editor = createEditorInstance();
        editor.cacheDom();
        editor.task = {
            task_data: {
                content: {
                    prompt: "Prompt"
                },
                settings: {}
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.additionalInfo = {
            type: "combined",
            text: "Старый комментарий",
            images: ["/media/one.png"]
        };
        editor.renderAdditionalInfo();
        editor.additionalTypeSelect.value = "combined";
        editor.additionalTextArea.value = "Новый комментарий к изображению";

        const state = editor.captureState();

        expect(state.additionalInfo).toEqual({
            type: "combined",
            text: "Новый комментарий к изображению",
            images: ["/media/one.png"]
        });
        expect(state.content.additionalInfo).toEqual({
            type: "combined",
            text: "Новый комментарий к изображению",
            images: ["/media/one.png"]
        });
    });
});

describe("ClickEditor annotations", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = `
            <button id="finish-polygon-btn"></button>
            <button id="delete-last-point-btn"></button>
            <button id="cancel-polygon-btn"></button>
            <span data-drawing-status class="opacity-0"></span>
        `;
        dispatchDomReady();
    });

    it("deletes an annotation and keeps selection indices consistent", () => {
        const editor = createEditorInstance();
        const firstAnnotation = {
            type: "polygon",
            label: "Контур 1",
            points: [[0, 0], [10, 10], [20, 20]],
            color: "#111111"
        };
        const secondAnnotation = {
            type: "polygon",
            label: "Контур 2",
            points: [[30, 30], [40, 40], [50, 50]],
            color: "#222222"
        };

        editor.annotations = [firstAnnotation, secondAnnotation];
        editor.selectedAnnotationIndex = 1;
        editor.selectedVertex = { annotationIndex: 1, vertexIndex: 0 };
        editor.annotationHighlights.set(firstAnnotation, true);
        editor.highlightTimers.set(firstAnnotation, setTimeout(() => {}, 0));
        editor.requiredCorrectInput = document.createElement("input");
        editor.requiredCorrectInput.value = "2";
        editor.renderAnnotations = vi.fn();
        editor.renderAnnotationList = vi.fn();
        editor.updateAnnotationCount = vi.fn();
        editor.enforceRequiredCorrectBounds = vi.fn().mockReturnValue({
            autoLowered: true,
            value: 1,
            annotationsCount: 1
        });
        editor.updateDrawingControlsState = vi.fn();
        editor.markUnsaved = vi.fn();

        const deleted = editor.deleteAnnotation(0);

        expect(deleted).toBe(true);
        expect(editor.annotations).toEqual([secondAnnotation]);
        expect(editor.selectedAnnotationIndex).toBe(0);
        expect(editor.selectedVertex).toEqual({ annotationIndex: 0, vertexIndex: 0 });
        expect(editor.annotationHighlights.has(firstAnnotation)).toBe(false);
        expect(editor.highlightTimers.has(firstAnnotation)).toBe(false);
        expect(editor.renderAnnotations).toHaveBeenCalled();
        expect(editor.renderAnnotationList).toHaveBeenCalled();
        expect(editor.updateAnnotationCount).toHaveBeenCalled();
        expect(editor.enforceRequiredCorrectBounds).toHaveBeenCalledWith({ clampToMax: true });
        expect(editor.markUnsaved).toHaveBeenCalled();
        expect(editor.statusBadge.textContent).toContain("Порог");
        expect(editor.statusBadge.textContent.toLowerCase()).toContain("контур");
    });

    it("shows the completion hint when polygon has enough points", () => {
        const editor = createEditorInstance();
        editor.currentTool = "polygon";
        editor.drawingPolygon = true;
        editor.currentPolygonPoints = [[0, 0], [10, 10], [20, 20]];

        editor.updateDrawingControlsState();
        editor.updateStatusBadge(editor.getPolygonProgressMessage(), { tone: "info" });

        expect(editor.finishBtn.disabled).toBe(false);
        expect(editor.finishBtn.classList.contains("bg-primary")).toBe(true);
        expect(editor.statusBadge.textContent).toContain("Контур готов");
    });

    it("offers toast undo after deleting an annotation", () => {
        const editor = createEditorInstance();
        editor.annotations = [
            {
                type: "polygon",
                label: "Контур 1",
                points: [[0, 0], [10, 10], [20, 20]],
                color: "#111111"
            }
        ];
        editor.renderAnnotations = vi.fn();
        editor.renderAnnotationList = vi.fn();
        editor.updateAnnotationCount = vi.fn();
        editor.enforceRequiredCorrectBounds = vi.fn();
        editor.updateDrawingControlsState = vi.fn();
        editor.markUnsaved = vi.fn();
        editor.highlightAnnotation = vi.fn();

        const deleted = editor.deleteAnnotation(0);

        expect(deleted).toBe(true);
        const toast = document.getElementById("click-editor-toast");
        expect(toast).toBeTruthy();
        expect(toast.textContent).toContain("Контур");
        expect(toast.textContent).toContain("Отменить");
        expect(toast.className).toContain("bottom-4");
        expect(toast.className).toContain("left-4");
        expect(toast.querySelector('[data-toast-action="close"]')).toBeTruthy();

        toast.querySelector('[data-toast-action="undo"]').click();

        expect(editor.annotations).toHaveLength(1);
        expect(editor.annotations[0].label).toBe("Контур 1");
        expect(editor.highlightAnnotation).toHaveBeenCalledWith(0);
        expect(editor.statusBadge.textContent).toContain("восстановлен");
    });
});

describe("ClickEditor required-correct UX", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        dispatchDomReady();
        buildRequiredCorrectShell("3");
    });

    it("disables the field and explains what to do when there are no contours", () => {
        const editor = createEditorInstance();
        editor.cacheDom();
        editor.annotations = [];

        const result = editor.enforceRequiredCorrectBounds({ clampToMax: true });

        expect(result.value).toBe(0);
        expect(editor.requiredCorrectInput.disabled).toBe(true);
        expect(editor.requiredCorrectContext.textContent).toContain("0");
        expect(editor.requiredCorrectHint.textContent).toContain("Сначала");
    });

    it("shows the current threshold against the number of contours", () => {
        const editor = createEditorInstance();
        editor.cacheDom();
        editor.annotations = [{}, {}, {}];
        editor.requiredCorrectInput.value = "2";

        const result = editor.enforceRequiredCorrectBounds({ clampToMax: true });

        expect(result.value).toBe(2);
        expect(result.autoLowered).toBe(false);
        expect(editor.requiredCorrectInput.disabled).toBe(false);
        expect(editor.requiredCorrectContext.textContent).toContain("3");
        expect(editor.requiredCorrectHint.textContent).toContain("2");
        expect(editor.requiredCorrectHint.textContent).toContain("3");
    });

    it("explains when the threshold is lowered automatically", () => {
        const editor = createEditorInstance();
        editor.cacheDom();
        editor.annotations = [{}, {}];
        editor.requiredCorrectInput.value = "4";

        const result = editor.enforceRequiredCorrectBounds({ clampToMax: true });

        expect(result.value).toBe(2);
        expect(result.autoLowered).toBe(true);
        expect(editor.requiredCorrectHint.textContent).toContain("Порог");
        expect(editor.requiredCorrectHint.textContent).toContain("2");
    });

    it("prefers settings.success_threshold when hydrating the field", () => {
        buildAdditionalMaterialsShell();
        const editor = createEditorInstance();
        editor.cacheDom();
        editor.task = {
            task_data: {
                content: {
                    prompt: "Найдите области",
                    required_correct: 1
                },
                settings: {
                    success_threshold: 3
                }
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.annotations = [{}, {}, {}];

        editor.renderUI();

        expect(editor.requiredCorrectInput.value).toBe("3");
        expect(editor.requiredCorrectHint.textContent).toContain("3");
    });

    it("automatically updates required count to match contour count when not manually modified", () => {
        const editor = createEditorInstance();
        editor.cacheDom();
        editor.setupEventListeners();
        editor.annotations = [];

        expect(editor.requiredCorrectManuallySet).toBe(false);

        // Add 1st contour
        editor.annotations.push({ points: [[0, 0], [10, 0], [10, 10]], type: "polygon" });
        editor.syncRequiredCorrectThreshold();
        expect(editor.requiredCorrectInput.value).toBe("1");
        expect(editor.requiredCorrectContext.textContent).toContain("1");

        // Add 2nd contour
        editor.annotations.push({ points: [[20, 20], [30, 20], [30, 30]], type: "polygon" });
        editor.syncRequiredCorrectThreshold();
        expect(editor.requiredCorrectInput.value).toBe("2");
        expect(editor.requiredCorrectContext.textContent).toContain("2");

        // Add 3rd contour
        editor.annotations.push({ points: [[40, 40], [50, 40], [50, 50]], type: "polygon" });
        editor.syncRequiredCorrectThreshold();
        expect(editor.requiredCorrectInput.value).toBe("3");
        expect(editor.requiredCorrectContext.textContent).toContain("3");

        // Delete 1 contour before any manual edit
        editor.annotations.splice(2, 1);
        editor.syncRequiredCorrectThreshold();
        expect(editor.requiredCorrectInput.value).toBe("2");
        expect(editor.requiredCorrectContext.textContent).toContain("2");
    });

    it("stops automatically updating required count as soon as the user manually modifies the field", () => {
        const editor = createEditorInstance();
        editor.cacheDom();
        editor.setupEventListeners();
        editor.annotations = [
            { points: [[0, 0], [10, 0], [10, 10]], type: "polygon" },
            { points: [[20, 20], [30, 20], [30, 30]], type: "polygon" },
            { points: [[40, 40], [50, 40], [50, 50]], type: "polygon" },
        ];
        editor.syncRequiredCorrectThreshold();
        expect(editor.requiredCorrectInput.value).toBe("3");

        // User manually changes input to 2
        editor.requiredCorrectInput.value = "2";
        editor.requiredCorrectInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

        expect(editor.requiredCorrectManuallySet).toBe(true);
        expect(editor.requiredCorrectInput.value).toBe("2");

        // Add 4th contour - should NOT change value from 2
        editor.annotations.push({ points: [[60, 60], [70, 60], [70, 70]], type: "polygon" });
        editor.syncRequiredCorrectThreshold();

        expect(editor.requiredCorrectInput.value).toBe("2");
        expect(editor.requiredCorrectContext.textContent).toContain("4");

        // Add 5th contour - should still remain 2
        editor.annotations.push({ points: [[80, 80], [90, 80], [90, 90]], type: "polygon" });
        editor.syncRequiredCorrectThreshold();

        expect(editor.requiredCorrectInput.value).toBe("2");
        expect(editor.requiredCorrectContext.textContent).toContain("5");
    });

    it("preserves and restores requiredCorrectManuallySet across captureState and restoreState", () => {
        const editor = createEditorInstance();
        editor.cacheDom();
        editor.task = {
            task_data: {
                content: { prompt: "Test", required_correct: 2 },
                settings: { success_threshold: 2 }
            },
            metadata: { id: "t1" }
        };
        editor.annotations = [{}, {}, {}];
        editor.requiredCorrectManuallySet = true;

        const captured = editor.captureState();
        expect(captured.requiredCorrectManuallySet).toBe(true);

        const newEditor = createEditorInstance();
        newEditor.cacheDom();
        newEditor.task = { task_data: { content: {}, settings: {} }, metadata: { id: "t1" } };
        newEditor.restoreState(captured);

        expect(newEditor.requiredCorrectManuallySet).toBe(true);
    });
});

describe("ClickEditor toolbar tooltips", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = `
            <div id="toolbar-row">
                <span data-toolbar-tooltip="Прямолинейное лассо"><button id="lasso-tool-btn"></button></span>
                <span data-toolbar-tooltip="Удалить последнюю точку"><button id="delete-last-point-btn" title="Удалить последнюю точку"></button></span>
            </div>
            <div id="toolbar-status-row"></div>
        `;
        dispatchDomReady();
    });

    it("promotes toolbar titles into delayed custom tooltips", () => {
        const editor = createEditorInstance();
        const deleteBtn = document.getElementById("delete-last-point-btn");
        const deleteTooltipTarget = deleteBtn.parentElement;

        expect(deleteTooltipTarget.dataset.toolbarTooltip).toBe("Удалить последнюю точку");
        expect(deleteTooltipTarget.getAttribute("title")).toBeNull();
        expect(deleteBtn.getAttribute("title")).toBeNull();
        expect(deleteBtn.getAttribute("aria-label")).toBe("Удалить последнюю точку");

        deleteTooltipTarget.dispatchEvent(new window.FocusEvent("focus"));

        const tooltip = document.getElementById("editor-toolbar-tooltip");
        expect(tooltip).toBeTruthy();
        expect(tooltip.textContent).toContain("Удалить последнюю точку");

        deleteTooltipTarget.dispatchEvent(new window.FocusEvent("blur"));
        expect(tooltip.classList.contains("opacity-0")).toBe(true);
    });

    it("shows the tooltip when hovering a nested toolbar button", () => {
        vi.useFakeTimers();
        const editor = createEditorInstance();
        const deleteBtn = document.getElementById("delete-last-point-btn");

        deleteBtn.dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: true }));
        vi.advanceTimersByTime(500);

        const tooltip = document.getElementById("editor-toolbar-tooltip");
        expect(tooltip).toBeTruthy();
        expect(tooltip.textContent).toContain("Удалить последнюю точку");

        deleteBtn.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
        expect(tooltip.classList.contains("opacity-0")).toBe(true);
        vi.useRealTimers();
    });
});

describe("ClickEditor choice prompt (errors text_choice)", () => {
    let editor;
    let pane;

    const buildPromptShell = () => {
        document.body.innerHTML = `
            <header><h2></h2></header>
            <textarea id="prompt-textarea"></textarea>
            <input id="required-correct-input" />
            <span id="required-correct-context"></span>
            <p id="required-correct-hint"></p>
            <div id="click-mode-pane"></div>
            <div id="errors-mode-pane"></div>
        `;
        const host = document.createElement("div");
        host.id = "app";
        pane = buildErrorsPane();
        host.appendChild(pane);
        document.body.appendChild(host);
    };

    const createEditorWithTask = (contentOverrides = {}) => {
        dispatchDomReady();
        editor = createEditorInstance();
        editor.cacheDom();
        editor.errorsModePane = pane;
        editor.errorsPaneInitialized = false;
        editor.task = {
            task_data: {
                content: {
                    text: "",
                    error_spans: [],
                    options: [],
                    prompt: "Основной",
                    choice_prompt: "Выберите верный",
                    mode: "text_choice",
                    ...contentOverrides
                },
                meta: { module: "m1", topic: "t1", id: "task1" },
                subtype: "error_detection"
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.moduleId = "m1";
        editor.topicId = "t1";
        editor.taskId = "task1";
        editor.errorDetection.enabled = true;
        editor.errorDetection.mode = editor.task.task_data.content.mode;
        editor.initErrorsPaneComponents();
    };

    beforeEach(() => {
        vi.restoreAllMocks();
        window.alert = vi.fn();
        window.confirm = vi.fn(() => true);
        buildPromptShell();
    });

    it("loads and displays choice_prompt with fallback to prompt", () => {
        createEditorWithTask();
        expect(editor.choicePromptTextarea.value).toBe("Выберите верный");
        expect(editor.choicePromptPreviewEl.textContent).toBe("Выберите верный");

        // remove choice_prompt to check fallback
        createEditorWithTask({ choice_prompt: "", prompt: "Фолбек" });
        expect(editor.choicePromptTextarea.value).toBe("Фолбек");
        expect(editor.choicePromptPreviewEl.textContent).toBe("Фолбек");
    });

    it("saves choice_prompt separately and falls back to main prompt when empty", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, meta: { authoring_enabled: false } })
        });

        createEditorWithTask({
            choice_prompt: "Старая",
            prompt: "Основной",
            options: [
                { id: "opt1", text: "Вариант А", is_correct: true },
                { id: "opt2", text: "Вариант Б", is_correct: false }
            ]
        });
        editor.errorDetection.options = editor.task.task_data.content.options;
        dom.window.fetch = fetchMock;
        editor.choicePromptTextarea.value = "Новая инструкция выбора";
        editor.promptArea.value = "Основной промпт";
        await editor.saveTask();

        expect(editor.task.task_data.content.choice_prompt).toBe("Новая инструкция выбора");

        // now empty choice prompt -> fallback to main prompt
        editor.choicePromptTextarea.value = "";
        editor.promptArea.value = "Промпт по умолчанию";
        await editor.saveTask();

        expect(editor.task.task_data.content.choice_prompt).toBe("Промпт по умолчанию");
        expect(fetchMock).toHaveBeenCalled();
    });

    it("shows warning feedback instead of plain success when semantic warnings are present", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, meta: { authoring_enabled: false } })
        });

        createEditorWithTask({
            choice_prompt: "Старая",
            prompt: "Основной",
            options: [
                { id: "opt1", text: "Повтор", is_correct: true },
                { id: "opt2", text: "Повтор", is_correct: false }
            ]
        });
        editor.errorDetection.options = editor.task.task_data.content.options;
        dom.window.fetch = fetchMock;

        const toastSpy = vi.spyOn(editor, "showToast").mockImplementation(() => {});
        const statusSpy = vi.spyOn(editor, "updateSaveStatus");

        await editor.saveTask();

        expect(statusSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "warning" }));
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("проверьте"), "warning", 5200);
        expect(toastSpy).not.toHaveBeenCalledWith("Задание сохранено.", "success");
    });
});

describe("ClickEditor default prompt behavior", () => {
    let editor;

    beforeEach(() => {
        vi.restoreAllMocks();
        window.alert = vi.fn();
        window.confirm = vi.fn(() => true);
        document.body.innerHTML = `
            <div id="app">
                <textarea id="prompt-textarea"></textarea>
                <textarea id="choice-prompt-textarea"></textarea>
                <input id="required-correct-input" value="1" />
                <div id="click-mode-pane"></div>
                <div id="errors-mode-pane"></div>
            </div>
        `;
        dispatchDomReady();
        editor = createEditorInstance();
        editor.cacheDom();
        editor.moduleId = "m1";
        editor.topicId = "t1";
        editor.taskId = "task1";
        editor.showToast = vi.fn();
    });

    it("defaults to 'ce.k001_click' prompt when saving regular click task with empty prompt", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, meta: { authoring_enabled: false } })
        });
        dom.window.fetch = fetchMock;

        editor.task = {
            task_data: {
                content: {
                    image: "test.jpg",
                    prompt: "",
                    mode: "click"
                },
                meta: { module: "m1", topic: "t1", id: "task1" }
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.annotations = [
            { type: "polygon", label: "Зона 1", points: [[0, 0], [10, 0], [10, 10]] }
        ];
        editor.errorDetection.enabled = false;
        editor.promptArea.value = "";

        await editor.saveTask();

        expect(editor.task.task_data.content.prompt).toBe("Отметьте указанные области на изображении");
    });

    it("defaults to 'ce.k001' prompt when saving error detection task with empty prompt", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, meta: { authoring_enabled: false } })
        });
        dom.window.fetch = fetchMock;

        editor.task = {
            task_data: {
                content: {
                    prompt: "",
                    choice_prompt: "",
                    mode: "text_choice",
                    options: [
                        { id: "opt1", text: "Вариант А", is_correct: true },
                        { id: "opt2", text: "Вариант Б", is_correct: false }
                    ]
                },
                meta: { module: "m1", topic: "t1", id: "task1" },
                subtype: "error_detection"
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.errorDetection.enabled = true;
        editor.errorDetection.mode = "text_choice";
        editor.errorDetection.options = editor.task.task_data.content.options;
        editor.promptArea.value = "";

        await editor.saveTask();

        expect(editor.task.task_data.content.prompt).toBe("Отметьте ошибки в тексте");
    });

    it("clears legacy error prompt in promptArea when hydrating regular click task via renderUI", () => {
        editor.task = {
            task_data: {
                content: {
                    prompt: "Отметьте ошибки в тексте",
                    mode: "click"
                },
                meta: { module: "m1", topic: "t1", id: "task1" }
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.errorDetection.enabled = false;

        editor.renderUI();

        expect(editor.promptArea.value).toBe("");
    });

    it("preserves custom prompt when hydrating regular click task via renderUI", () => {
        editor.task = {
            task_data: {
                content: {
                    prompt: "Найдите транзистор VT1 на схеме",
                    mode: "click"
                },
                meta: { module: "m1", topic: "t1", id: "task1" }
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.errorDetection.enabled = false;

        editor.renderUI();

        expect(editor.promptArea.value).toBe("Найдите транзистор VT1 на схеме");
    });

    it("defaults to English prompt when saving regular click task with empty prompt on English interface", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, meta: { authoring_enabled: false } })
        });
        dom.window.fetch = fetchMock;
        dom.window.localStorage.setItem("actra_lang", "en");
        dom.window.i18n = {
            getLang: () => "en",
            t: (k) => (k === "ce.k001_click" ? "Mark the indicated areas on the image" : k)
        };

        editor.task = {
            task_data: {
                content: {
                    image: "test.jpg",
                    prompt: "",
                    mode: "click"
                },
                meta: { module: "m1", topic: "t1", id: "task1" }
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.annotations = [
            { type: "polygon", label: "Zone 1", points: [[0, 0], [10, 0], [10, 10]] }
        ];
        editor.errorDetection.enabled = false;
        editor.promptArea.value = "";

        await editor.saveTask();

        expect(editor.task.task_data.content.prompt).toBe("Mark the indicated areas on the image");
        delete dom.window.i18n;
        dom.window.localStorage.removeItem("actra_lang");
    });

    it("defaults to Ukrainian prompt when saving regular click task with empty prompt on Ukrainian interface", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, meta: { authoring_enabled: false } })
        });
        dom.window.fetch = fetchMock;
        dom.window.localStorage.setItem("actra_lang", "uk");
        dom.window.i18n = {
            getLang: () => "uk",
            t: (k) => (k === "ce.k001_click" ? "Позначте вказані області на зображенні" : k)
        };

        editor.task = {
            task_data: {
                content: {
                    image: "test.jpg",
                    prompt: "",
                    mode: "click"
                },
                meta: { module: "m1", topic: "t1", id: "task1" }
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.annotations = [
            { type: "polygon", label: "Zone 1", points: [[0, 0], [10, 0], [10, 10]] }
        ];
        editor.errorDetection.enabled = false;
        editor.promptArea.value = "";

        await editor.saveTask();

        expect(editor.task.task_data.content.prompt).toBe("Позначте вказані області на зображенні");
        delete dom.window.i18n;
        dom.window.localStorage.removeItem("actra_lang");
    });

    it("clears previously saved Russian default click prompt when hydrating in renderUI", () => {
        editor.task = {
            task_data: {
                content: {
                    prompt: "Отметьте указанные области на изображении",
                    mode: "click"
                },
                meta: { module: "m1", topic: "t1", id: "task1" }
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.errorDetection.enabled = false;

        editor.renderUI();

        expect(editor.promptArea.value).toBe("");
    });
});

describe("ClickEditor contour drawing isolation (Task 3)", () => {
    let editor;

    const setupEditorForDrawing = () => {
        document.body.innerHTML = `
            <header><h2></h2></header>
            <div id="toolbar-row">
                <button id="lasso-tool-btn" class="tool-toggle" data-tool="polygon" aria-pressed="true"></button>
                <button id="freehand-tool-btn" class="tool-toggle" data-tool="freehand" aria-pressed="false"></button>
                <button id="finish-polygon-btn"></button>
                <button id="delete-last-point-btn"></button>
                <button id="cancel-polygon-btn"></button>
                <button id="clear-annotations-btn"></button>
            </div>
            <div id="toolbar-status-row"></div>
            <div id="canvas-container">
                <div id="canvas-stage">
                    <img id="main-image" src="test.jpg" />
                    <svg id="annotation-overlay"></svg>
                </div>
            </div>
            <div id="annotation-list"></div>
            <span data-annotations-count></span>
            <div data-drawing-status><span data-drawing-status-text></span></div>
            <textarea id="prompt-textarea"></textarea>
            <div id="click-mode-pane"></div>
            <div id="errors-mode-pane"></div>
        `;
        dispatchDomReady();
        editor = createEditorInstance();
        editor.cacheDom();
        editor.setupEventListeners();
        editor.baseImageWidth = 800;
        editor.baseImageHeight = 600;
        editor.annotations = [
            {
                type: "polygon",
                label: "Zone 1",
                points: [[10, 10], [50, 10], [50, 50], [10, 50]],
                color: "#ff0000",
                labelVisible: false
            }
        ];
        editor.currentTool = "polygon";
    };

    beforeEach(() => {
        vi.restoreAllMocks();
        setupEditorForDrawing();
    });

    it("activates is-drawing-active class on overlay when polygon drawing starts", () => {
        expect(editor.overlay.classList.contains("is-drawing-active")).toBe(false);

        editor.startPolygon();
        editor.currentPolygonPoints.push([100, 100]);
        editor.syncDrawingActiveState();

        expect(editor.drawingPolygon).toBe(true);
        expect(editor.overlay.classList.contains("is-drawing-active")).toBe(true);
    });

    it("treats existing contour shapes as non-interactive while drawing a polygon", () => {
        editor.startPolygon();
        editor.currentPolygonPoints.push([100, 100]);

        const fakeShape = document.createElement("path");
        fakeShape.className = "annotation-shape";
        fakeShape.dataset.annotationIndex = "0";

        const fakeHandle = document.createElement("circle");
        fakeHandle.className = "vertex-handle";
        fakeHandle.dataset.annotationIndex = "0";
        fakeHandle.dataset.vertexIndex = "0";

        expect(editor.isOverlayInteractiveTarget(fakeShape)).toBe(false);
        expect(editor.isOverlayInteractiveTarget(fakeHandle)).toBe(false);
    });

    it("does not select existing contour on mousedown when drawing a polygon", () => {
        editor.startPolygon();
        editor.currentPolygonPoints.push([100, 100]);
        editor.selectedAnnotationIndex = -1;

        const fakeShape = document.createElement("path");
        fakeShape.className = "annotation-shape";
        fakeShape.dataset.annotationIndex = "0";
        editor.overlay.appendChild(fakeShape);

        const mousedownEvent = new dom.window.MouseEvent("mousedown", {
            button: 0,
            bubbles: true
        });
        fakeShape.dispatchEvent(mousedownEvent);

        expect(editor.selectedAnnotationIndex).toBe(-1);
    });

    it("removes is-drawing-active and restores interactivity when polygon is finished", () => {
        editor.startPolygon();
        editor.currentPolygonPoints = [[100, 100], [150, 100], [150, 150]];
        expect(editor.overlay.classList.contains("is-drawing-active")).toBe(true);

        editor.finishCurrentPolygon();

        expect(editor.drawingPolygon).toBe(false);
        expect(editor.overlay.classList.contains("is-drawing-active")).toBe(false);

        const fakeShape = document.createElement("path");
        fakeShape.className = "annotation-shape";
        fakeShape.dataset.annotationIndex = "0";
        expect(editor.isOverlayInteractiveTarget(fakeShape)).toBe(true);
    });

    it("removes is-drawing-active when polygon is cancelled", () => {
        editor.startPolygon();
        editor.currentPolygonPoints = [[100, 100]];
        expect(editor.overlay.classList.contains("is-drawing-active")).toBe(true);

        editor.cancelPolygonDrawing();

        expect(editor.drawingPolygon).toBe(false);
        expect(editor.currentPolygonPoints.length).toBe(0);
        expect(editor.overlay.classList.contains("is-drawing-active")).toBe(false);
    });

    it("removes is-drawing-active and resets state when removeLastPoint leaves 0 points", () => {
        editor.startPolygon();
        editor.currentPolygonPoints = [[100, 100]];
        expect(editor.overlay.classList.contains("is-drawing-active")).toBe(true);

        editor.removeLastPoint();

        expect(editor.currentPolygonPoints.length).toBe(0);
        expect(editor.drawingPolygon).toBe(false);
        expect(editor.overlay.classList.contains("is-drawing-active")).toBe(false);
    });

    it("deselects existing annotation when clicking active tool button", () => {
        editor.selectAnnotation(0);
        expect(editor.selectedAnnotationIndex).toBe(0);

        const lassoBtn = document.getElementById("lasso-tool-btn");
        lassoBtn.click();

        expect(editor.selectedAnnotationIndex).toBe(-1);
    });
});

describe("ClickEditor point deletion, reset and Escape hotkey audit (Task 4)", () => {
    let editor;

    const setupEditor = () => {
        document.body.innerHTML = `
            <header><h2></h2></header>
            <div id="toolbar-row">
                <button id="lasso-tool-btn" class="tool-toggle" data-tool="polygon" aria-pressed="true"></button>
                <button id="freehand-tool-btn" class="tool-toggle" data-tool="freehand" aria-pressed="false"></button>
                <button id="finish-polygon-btn"></button>
                <button id="delete-last-point-btn"></button>
                <button id="cancel-polygon-btn"></button>
                <button id="clear-annotations-btn"></button>
            </div>
            <div id="toolbar-status-row"></div>
            <div id="canvas-container">
                <div id="canvas-stage">
                    <img id="main-image" src="test.jpg" />
                    <svg id="annotation-overlay"></svg>
                </div>
            </div>
            <div id="annotation-list"></div>
            <span data-annotations-count></span>
            <div data-drawing-status><span data-drawing-status-text></span></div>
            <textarea id="prompt-textarea"></textarea>
            <div id="click-mode-pane"></div>
            <div id="errors-mode-pane"></div>
        `;
        dispatchDomReady();
        editor = createEditorInstance();
        editor.cacheDom();
        editor.setupEventListeners();
        editor.baseImageWidth = 800;
        editor.baseImageHeight = 600;
        editor.annotations = [
            {
                type: "polygon",
                label: "Zone 1",
                points: [[10, 10], [50, 10], [50, 50], [10, 50]],
                color: "#ff0000",
                labelVisible: false
            }
        ];
        editor.currentTool = "polygon";
    };

    beforeEach(() => {
        vi.restoreAllMocks();
        setupEditor();
    });

    it("transitions controls and status correctly through sequential removeLastPoint calls down to 0", () => {
        editor.startPolygon();
        editor.currentPolygonPoints = [[10, 10], [20, 20], [30, 30]];
        editor.updateDrawingControlsState();

        expect(editor.finishBtn.disabled).toBe(false);
        expect(editor.deleteLastPointBtn.disabled).toBe(false);
        expect(editor.cancelPolygonBtn.disabled).toBe(false);

        // Remove 3rd point -> 2 points left
        editor.removeLastPoint();
        expect(editor.currentPolygonPoints.length).toBe(2);
        expect(editor.drawingPolygon).toBe(true);
        expect(editor.finishBtn.disabled).toBe(true);
        expect(editor.deleteLastPointBtn.disabled).toBe(false);
        expect(editor.cancelPolygonBtn.disabled).toBe(false);

        // Remove 2nd point -> 1 point left
        editor.removeLastPoint();
        expect(editor.currentPolygonPoints.length).toBe(1);
        expect(editor.drawingPolygon).toBe(true);
        expect(editor.finishBtn.disabled).toBe(true);
        expect(editor.deleteLastPointBtn.disabled).toBe(false);
        expect(editor.cancelPolygonBtn.disabled).toBe(false);

        // Remove 1st point -> 0 points left
        editor.removeLastPoint();
        expect(editor.currentPolygonPoints.length).toBe(0);
        expect(editor.drawingPolygon).toBe(false);
        expect(editor.finishBtn.disabled).toBe(true);
        expect(editor.deleteLastPointBtn.disabled).toBe(true);
        expect(editor.cancelPolygonBtn.disabled).toBe(true);
        expect(editor.statusBadgeText.textContent).toBe("Режим ожидания");
        expect(editor.overlay.classList.contains("is-drawing-active")).toBe(false);
    });

    it("resets all drawing state and controls on cancelPolygonDrawing", () => {
        editor.startPolygon();
        editor.currentPolygonPoints = [[10, 10], [20, 20]];
        editor.updateDrawingControlsState();
        expect(editor.cancelPolygonBtn.disabled).toBe(false);

        editor.cancelPolygonDrawing();

        expect(editor.currentPolygonPoints.length).toBe(0);
        expect(editor.drawingPolygon).toBe(false);
        expect(editor.finishBtn.disabled).toBe(true);
        expect(editor.deleteLastPointBtn.disabled).toBe(true);
        expect(editor.cancelPolygonBtn.disabled).toBe(true);
        expect(editor.statusBadgeText.textContent).toBe("Режим ожидания");
        expect(editor.overlay.classList.contains("is-drawing-active")).toBe(false);
    });

    it("marks task unsaved when deleting a vertex from an existing annotation", () => {
        const markUnsavedSpy = vi.spyOn(editor, "markUnsaved");
        editor.selectAnnotation(0);
        editor.selectVertex(0, 1);

        expect(editor.annotations[0].points.length).toBe(4);

        editor.handleDeletePointAction();

        expect(editor.annotations[0].points.length).toBe(3);
        expect(markUnsavedSpy).toHaveBeenCalled();
    });

    it("prevents deleting vertex when polygon reaches minimum 3 points", () => {
        editor.annotations[0].points = [[10, 10], [50, 10], [50, 50]];
        editor.selectAnnotation(0);
        editor.selectVertex(0, 1);

        const markUnsavedSpy = vi.spyOn(editor, "markUnsaved");

        editor.handleDeletePointAction();

        expect(editor.annotations[0].points.length).toBe(3);
        expect(markUnsavedSpy).not.toHaveBeenCalled();
        expect(editor.statusBadgeText.textContent).toContain("Минимум точек: 3");
    });

    it("cancels polygon drawing when pressing Escape key", () => {
        editor.startPolygon();
        editor.currentPolygonPoints = [[10, 10], [20, 20]];
        expect(editor.drawingPolygon).toBe(true);

        const event = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        window.dispatchEvent(event);

        expect(editor.drawingPolygon).toBe(false);
        expect(editor.currentPolygonPoints.length).toBe(0);
        expect(editor.statusBadgeText.textContent).toBe("Режим ожидания");
    });

    it("clears selected vertex when pressing Escape key", () => {
        editor.selectAnnotation(0);
        editor.selectVertex(0, 1);
        expect(editor.selectedVertex).toBeTruthy();

        const event = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        window.dispatchEvent(event);

        expect(editor.selectedVertex).toBeNull();
        expect(editor.selectedAnnotationIndex).toBe(0);
    });

    it("clears selected annotation when pressing Escape key", () => {
        editor.selectAnnotation(0);
        expect(editor.selectedAnnotationIndex).toBe(0);

        const event = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        window.dispatchEvent(event);

        expect(editor.selectedAnnotationIndex).toBe(-1);
    });

    it("does not cancel drawing on Escape if user is typing in prompt textarea", () => {
        editor.startPolygon();
        editor.currentPolygonPoints = [[10, 10]];

        const textarea = document.getElementById("prompt-textarea");
        textarea.focus();
        const event = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        textarea.dispatchEvent(event);

        expect(editor.drawingPolygon).toBe(true);
        expect(editor.currentPolygonPoints.length).toBe(1);
    });
});

describe("ClickEditor toolbar tooltip and header fallback localization (Task 5)", () => {
    it("has all pa keys present across ru.json, en.json, and uk.json", () => {
        const ru = JSON.parse(fs.readFileSync("frontend/assets/locales/ru.json", "utf8"));
        const en = JSON.parse(fs.readFileSync("frontend/assets/locales/en.json", "utf8"));
        const uk = JSON.parse(fs.readFileSync("frontend/assets/locales/uk.json", "utf8"));

        const requiredKeys = [
            "last_change_fallback",
            "tooltip_lasso",
            "tooltip_freehand",
            "tooltip_finish",
            "tooltip_delete",
            "tooltip_cancel",
            "tooltip_toggle_labels",
            "label_visibility_smart",
            "tooltip_clear_all",
            "show"
        ];

        requiredKeys.forEach((key) => {
            expect(ru.pa[key], `Missing ru.pa.${key}`).toBeTruthy();
            expect(en.pa[key], `Missing en.pa.${key}`).toBeTruthy();
            expect(uk.pa[key], `Missing uk.pa.${key}`).toBeTruthy();
        });
    });

    it("dynamically resolves tooltip text according to active locale", () => {
        document.body.innerHTML = `
            <div id="toolbar-row">
                <span data-toolbar-tooltip data-i18n-title="pa.tooltip_lasso" title="Прямолинейное лассо">
                    <button id="lasso-tool-btn"></button>
                </span>
            </div>
            <div id="toolbar-status-row"></div>
        `;
        dispatchDomReady();
        const editor = createEditorInstance();
        editor.cacheDom();
        editor.initToolbarTooltips();

        const target = document.querySelector("[data-toolbar-tooltip]");
        dom.window.wt = (k, fb) => (k === "pa.tooltip_lasso" ? "Прямолинейное лассо: ставьте точки по контуру объекта" : fb);
        expect(editor.getToolbarTooltipText(target)).toBe("Прямолинейное лассо: ставьте точки по контуру объекта");

        dom.window.wt = (k, fb) => (k === "pa.tooltip_lasso" ? "Polygon lasso: place points along the object contour" : fb);
        editor.handleLocaleChanged();

        expect(target.dataset.toolbarTooltip).toBe("Polygon lasso: place points along the object contour");
        expect(target.getAttribute("title")).toBeNull();
        expect(target.querySelector("button")?.getAttribute("aria-label")).toBe("Polygon lasso: place points along the object contour");

        editor.showToolbarTooltip(target);
        const tooltip = document.getElementById("editor-toolbar-tooltip");
        expect(tooltip.textContent).toBe("Polygon lasso: place points along the object contour");
    });

    it("translates header last change fallback element in DOM", () => {
        const en = JSON.parse(fs.readFileSync("frontend/assets/locales/en.json", "utf8"));
        const uk = JSON.parse(fs.readFileSync("frontend/assets/locales/uk.json", "utf8"));

        expect(en.pa.last_change_fallback).toBe("Last change: recently");
        expect(uk.pa.last_change_fallback).toBe("Остання зміна: нещодавно");
    });
});

describe("ClickEditor contour color picker and randomizer", () => {
    let editor;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="canvas-stage">
                <canvas id="point-canvas"></canvas>
                <div id="annotation-overlay">
                    <svg id="annotation-svg"></svg>
                </div>
            </div>
            <ul id="annotation-list"></ul>
            <span data-annotations-count></span>
            <span data-drawing-status-text></span>
            <div id="status-badge" class="hidden"></div>
            <button id="save-task-btn" disabled></button>
            <div id="save-status-container">
                <span data-save-status-text></span>
            </div>
        `;
        dispatchDomReady();
        editor = createEditorInstance();
        editor.cacheDom();
        editor.annotations = [
            {
                type: "polygon",
                points: [[10, 10], [50, 10], [50, 50], [10, 50]],
                label: "Контур 1",
                color: "#2563eb",
                labelVisible: false
            },
            {
                type: "freehand",
                points: [[100, 100], [120, 120], [140, 140]],
                label: "Линия 2",
                color: "#dc2626",
                labelVisible: false
            }
        ];
        editor.renderAnnotations();
        editor.renderAnnotationList();
    });

    it("renders colorDot as an interactive button with accessibility attributes", () => {
        const triggers = document.querySelectorAll(".color-picker-trigger");
        expect(triggers.length).toBe(2);
        expect(triggers[0].tagName).toBe("BUTTON");
        expect(triggers[0].dataset.annotationIndex).toBe("0");
        expect(triggers[0].style.backgroundColor).toBe("rgb(37, 99, 235)");
        expect(triggers[0].getAttribute("aria-label")).toBeTruthy();
        expect(triggers[0].getAttribute("data-i18n-title")).toBe("pa.choose_color");
    });

    it("opens color picker popover on trigger click with presets, random and custom buttons", () => {
        const triggers = document.querySelectorAll(".color-picker-trigger");
        triggers[0].click();

        const popover = document.querySelector(".annotation-color-picker-popover");
        expect(popover).not.toBeNull();
        expect(popover.dataset.annotationIndex).toBe("0");
        expect(triggers[0].classList.contains("is-active")).toBe(true);

        const swatches = popover.querySelectorAll(".annotation-color-picker-popover__swatch");
        expect(swatches.length).toBeGreaterThanOrEqual(12);

        const randomBtn = popover.querySelector(".random-color-btn");
        expect(randomBtn).not.toBeNull();

        const customBtn = popover.querySelector(".custom-color-btn");
        expect(customBtn).not.toBeNull();
    });

    it("applies new color from preset swatch and marks unsaved", () => {
        const triggers = document.querySelectorAll(".color-picker-trigger");
        triggers[0].click();

        const popover = document.querySelector(".annotation-color-picker-popover");
        const swatches = popover.querySelectorAll(".annotation-color-picker-popover__swatch");
        const greenSwatch = Array.from(swatches).find(s => s.dataset.color === "#10b981");
        expect(greenSwatch).toBeDefined();

        greenSwatch.click();

        expect(editor.annotations[0].color).toBe("#10b981");
        expect(triggers[0].style.backgroundColor).toBe("rgb(16, 185, 129)");
        expect(editor.hasUnsavedChanges).toBe(true);
    });

    it("generates a distinct vibrant color on Random click", () => {
        const triggers = document.querySelectorAll(".color-picker-trigger");
        triggers[0].click();

        const popover = document.querySelector(".annotation-color-picker-popover");
        const randomBtn = popover.querySelector(".random-color-btn");

        const originalColor = editor.annotations[0].color;
        randomBtn.click();

        const newColor = editor.annotations[0].color;
        expect(newColor).toMatch(/^#[0-9a-f]{6}$/i);
        expect(newColor.toLowerCase()).not.toBe(originalColor.toLowerCase());
        expect(editor.hasUnsavedChanges).toBe(true);
    });

    it("closes popover when pressing Escape", () => {
        const triggers = document.querySelectorAll(".color-picker-trigger");
        triggers[0].click();

        expect(document.querySelector(".annotation-color-picker-popover")).not.toBeNull();

        const escEvent = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        document.dispatchEvent(escEvent);

        expect(document.querySelector(".annotation-color-picker-popover")).toBeNull();
        expect(triggers[0].classList.contains("is-active")).toBe(false);
    });

    it("closes popover when annotation is deleted", () => {
        const triggers = document.querySelectorAll(".color-picker-trigger");
        triggers[0].click();

        expect(document.querySelector(".annotation-color-picker-popover")).not.toBeNull();

        editor.deleteAnnotation(0);

        expect(document.querySelector(".annotation-color-picker-popover")).toBeNull();
    });

    it("toggles popover when clicking the same trigger again", () => {
        const triggers = document.querySelectorAll(".color-picker-trigger");
        triggers[0].click();
        expect(document.querySelector(".annotation-color-picker-popover")).not.toBeNull();

        triggers[0].click();
        expect(document.querySelector(".annotation-color-picker-popover")).toBeNull();
    });
});





