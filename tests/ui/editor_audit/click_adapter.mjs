import fs from "fs";
import path from "path";

import { JSDOM } from "jsdom";
import { vi } from "vitest";

function loadScript(filePath) {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

function bindDomGlobals(dom) {
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
}

function setupDom() {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
        url: "http://localhost",
        runScripts: "dangerously",
        resources: "usable",
    });

    bindDomGlobals(dom);

    dom.window.fetch = vi.fn();
    dom.window.alert = vi.fn();
    dom.window.confirm = vi.fn(() => true);
    dom.window.__CLICK_EDITOR_AUTO_INIT_DISABLED__ = true;
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({
        drawImage: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        measureText: () => ({ width: 0 }),
    });

    dom.window.eval(loadScript("frontend/Editor/undo_manager.js") + "\n;window.UndoManager = UndoManager;");
    dom.window.eval(loadScript("frontend/Editor/click_editor_helpers.js"));
    dom.window.eval(loadScript("frontend/Editor/base_editor.js") + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript("frontend/Editor/autosave_manager.js") + "\n;window.AutoSaveManager = AutoSaveManager;");
    dom.window.eval(loadScript("frontend/Editor/click_editor.js") + "\n;window.ClickEditor = ClickEditor;");

    return dom;
}

function dispatchDomReady(dom) {
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
}

function createEditorInstance(dom) {
    const editorClass = dom.window.ClickEditor;
    if (!editorClass) {
        throw new Error("ClickEditor is not available");
    }
    const initSpy = vi.spyOn(editorClass.prototype, "init").mockResolvedValue(undefined);
    const instance = new editorClass();
    initSpy.mockRestore();
    return instance;
}

function mountRichShell() {
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
}

function mountDestructiveShell() {
    document.body.innerHTML = `
        <button id="finish-polygon-btn"></button>
        <button id="delete-last-point-btn"></button>
        <button id="cancel-polygon-btn"></button>
        <span data-drawing-status class="opacity-0"></span>
        <input id="required-correct-input" value="1" />
        <span id="required-correct-context"></span>
        <p id="required-correct-hint"></p>
    `;
}

export function createClickEditorAuditAdapter() {
    const dom = setupDom();

    return {
        teardown() {
            dom.window.close();
        },

        describeSurfaceAudit() {
            return {
                capabilities: [
                    { id: "prompt", kind: "primary_field", description: "Основная формулировка задания" },
                    { id: "main_image", kind: "asset", description: "Основное изображение задания" },
                    { id: "polygon_tool", kind: "tool", description: "Прямолинейное лассо для областей" },
                    { id: "freehand_tool", kind: "tool", description: "Свободное рисование для линий" },
                    { id: "annotations_list", kind: "secondary_panel", description: "Список аннотаций и действия над ними" },
                    { id: "required_correct", kind: "requirement", description: "Порог нужного количества аннотаций" },
                    { id: "additional_info", kind: "supplementary", description: "Дополнительные материалы: текст и изображения" },
                    { id: "clear_all", kind: "destructive_action", description: "Очистка всех контуров" },
                ],
                riskClasses: [
                    "hidden_rule_without_hint",
                    "false_affordance",
                    "layout_instability",
                    "persistence_divergence",
                    "asset_hygiene_defect",
                ],
                heuristics: [
                    "copy_lint",
                    "dirty_state_audit",
                    "affordance_audit",
                    "persistence_diff",
                    "overlay_audit",
                ],
                scenarios: {
                    happy: [
                        "Загрузить основное изображение, нарисовать контур, сохранить задачу",
                    ],
                    rich: [
                        "Добавить несколько аннотаций, настроить порог, прикрепить дополнительные материалы",
                    ],
                    recovery: [
                        "Внести изменения, перезагрузить страницу, восстановить несохранённые изменения",
                    ],
                    error: [
                        "Попытаться сохранить задачу без изображения или без контуров",
                    ],
                    destructive: [
                        "Удалить контур и откатить действие через toast undo",
                        "Очистить все контуры через подтверждение",
                    ],
                },
            };
        },

        createDraftRoundtripContext() {
            vi.restoreAllMocks();
            bindDomGlobals(dom);
            mountRichShell();
            dispatchDomReady(dom);

            const editor = createEditorInstance(dom);
            editor.cacheDom();
            editor.task = {
                task_data: {
                    content: {
                        prompt: "Старая формулировка",
                        choice_prompt: "Старый выбор",
                        required_correct: 1,
                    },
                    settings: {
                        success_threshold: 1,
                    },
                },
                metadata: { id: "task1", module: "m1", topic: "t1" },
            };
            editor.annotations = [
                {
                    type: "polygon",
                    label: "Контур 1",
                    points: [[0, 0], [10, 10], [20, 20]],
                    color: "#111111",
                },
            ];
            editor.additionalInfo = {
                type: "combined",
                text: "Старый комментарий",
                images: ["/media/one.png"],
            };
            editor.renderAdditionalInfo();

            editor.promptArea.value = "Новая формулировка";
            editor.choicePromptTextarea.value = "Новая инструкция выбора";
            editor.requiredCorrectInput.value = "2";
            editor.additionalTypeSelect.value = "combined";
            editor.additionalTextArea.value = "Новый комментарий";

            return {
                editor,
                expected: {
                    prompt: "Новая формулировка",
                    choice_prompt: "Новая инструкция выбора",
                    required_correct: 2,
                    success_threshold: 2,
                    additionalInfo: {
                        type: "combined",
                        text: "Новый комментарий",
                        images: ["/media/one.png"],
                    },
                },
                readDraft(state) {
                    return {
                        prompt: state.content.prompt,
                        choice_prompt: state.content.choice_prompt,
                        required_correct: state.content.required_correct,
                        success_threshold: state.settings.success_threshold,
                        additionalInfo: state.content.additionalInfo,
                    };
                },
            };
        },

        createCanonicalHydrationContext() {
            vi.restoreAllMocks();
            bindDomGlobals(dom);
            mountRichShell();
            dispatchDomReady(dom);

            const editor = createEditorInstance(dom);
            editor.cacheDom();
            editor.task = {
                task_data: {
                    content: {
                        prompt: "Найдите области",
                        required_correct: 1,
                    },
                    settings: {
                        success_threshold: 3,
                    },
                },
                metadata: { id: "task1", module: "m1", topic: "t1" },
            };
            editor.annotations = [{}, {}, {}];

            return {
                editor,
                hydrate() {
                    editor.renderUI();
                },
                expected: {
                    requiredCorrect: "3",
                },
                readUi(instance) {
                    return {
                        requiredCorrect: instance.requiredCorrectInput.value,
                    };
                },
            };
        },

        createUndoableDestructiveContext() {
            vi.restoreAllMocks();
            bindDomGlobals(dom);
            mountDestructiveShell();
            dispatchDomReady(dom);

            const editor = createEditorInstance(dom);
            editor.cacheDom();
            editor.annotations = [
                {
                    type: "polygon",
                    label: "Контур 1",
                    points: [[0, 0], [10, 10], [20, 20]],
                    color: "#111111",
                },
            ];
            editor.renderAnnotations = vi.fn();
            editor.renderAnnotationList = vi.fn();
            editor.updateAnnotationCount = vi.fn();
            editor.enforceRequiredCorrectBounds = vi.fn().mockReturnValue({
                autoLowered: false,
                value: 1,
                annotationsCount: 1,
            });
            editor.updateDrawingControlsState = vi.fn();
            editor.markUnsaved = vi.fn();
            editor.highlightAnnotation = vi.fn();

            return {
                editor,
                act() {
                    editor.deleteAnnotation(0);
                },
                undo() {
                    const toast = document.getElementById("click-editor-toast");
                    toast?.querySelector('[data-toast-action="undo"]')?.click();
                },
                read(instance) {
                    const toast = document.getElementById("click-editor-toast");
                    return {
                        annotationCount: instance.annotations.length,
                        hasUndoToast: Boolean(
                            toast &&
                            !toast.classList.contains("opacity-0") &&
                            toast.textContent.includes("Отменить")
                        ),
                    };
                },
                expectedAfterAction: {
                    annotationCount: 0,
                    hasUndoToast: true,
                },
                expectedAfterUndo: {
                    annotationCount: 1,
                    hasUndoToast: false,
                },
            };
        },
    };
}
