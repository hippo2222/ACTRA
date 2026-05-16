import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestEditorHarness } from "./editor_audit/test_adapter.mjs";

function createImagePasteEvent(target, file) {
    return {
        target,
        clipboardData: {
            items: [
                {
                    kind: "file",
                    type: file.type,
                    getAsFile: () => file,
                },
            ],
            files: [],
        },
        preventDefault: vi.fn(),
    };
}

function createFilesOnlyImagePasteEvent(target, file) {
    return {
        target,
        clipboardData: {
            items: [],
            files: [file],
        },
        preventDefault: vi.fn(),
    };
}

function createEmptyPasteEvent(target) {
    return {
        target,
        clipboardData: {
            items: [],
            files: [],
        },
        preventDefault: vi.fn(),
    };
}

describe("Test editor clipboard image paste", () => {
    const harnesses = [];

    afterEach(() => {
        harnesses.splice(0).forEach(({ dom }) => dom?.window?.close?.());
        vi.restoreAllMocks();
    });

    it("attaches a pasted image to the current question when the question field is targeted", async () => {
        const harness = createTestEditorHarness();
        harnesses.push(harness);

        const { editor } = harness;
        const file = new File(["question-image"], "question.png", { type: "image/png" });
        const questionTextarea = document.querySelector("#question-textarea");
        editor.requestJson.mockResolvedValue({
            path: "images/question.png",
            asset_id: "asset_question",
            asset_url: "/api/assets/asset_question/content",
        });

        const pasteEvent = createImagePasteEvent(questionTextarea, file);
        await editor.handleClipboardPaste(pasteEvent);

        expect(pasteEvent.preventDefault).toHaveBeenCalledOnce();
        expect(editor.requestJson).toHaveBeenCalledTimes(1);
        expect(editor.questions[0].image).toBe("images/question.png");
        expect(editor.questions[0].image_asset_id).toBe("asset_question");
        expect(editor.questions[0].images).toEqual([
            {
                path: "images/question.png",
                asset_id: "asset_question",
                asset_url: "/api/assets/asset_question/content",
            },
        ]);
    });

    it("selects a bank image and adds it to the clicked question without uploading again", () => {
        const sharedRef = {
            path: "images/shared.png",
            asset_id: "asset_shared",
            asset_url: "/api/assets/asset_shared/content",
        };
        const harness = createTestEditorHarness({
            questions: [
                {
                    id: 1,
                    text: "First question",
                    options: [
                        { text: "A", is_correct: true, image_path: null },
                        { text: "B", is_correct: false, image_path: null },
                    ],
                    settings: { all_correct_required: true, allow_partial_credit: false },
                    explanation: "",
                    image: null,
                    images: [],
                },
                {
                    id: 2,
                    text: "Second question",
                    options: [
                        { text: "A", is_correct: true, image_path: null },
                        { text: "B", is_correct: false, image_path: null },
                    ],
                    settings: { all_correct_required: true, allow_partial_credit: false },
                    explanation: "",
                    image: sharedRef.path,
                    image_asset_id: sharedRef.asset_id,
                    image_asset_url: sharedRef.asset_url,
                    images: [sharedRef],
                },
            ],
            currentQuestionIndex: 0,
        });
        harnesses.push(harness);

        const { editor } = harness;
        const count = document.querySelector("#test-image-bank-count");
        const bankButton = document.querySelector(".test-image-bank__select");
        const questionTextarea = document.querySelector("#question-textarea");

        expect(count.textContent).toBe("1");
        expect(bankButton).toBeTruthy();

        bankButton.click();
        expect(document.body.classList.contains("bank-image-placement-mode")).toBe(true);
        expect(document.querySelector(".test-image-bank__item").classList.contains("is-selected")).toBe(true);

        questionTextarea.click();

        expect(editor.requestJson).not.toHaveBeenCalled();
        expect(editor.questions[0].images).toEqual([sharedRef]);
        expect(editor.questions[0].image_asset_id).toBe(sharedRef.asset_id);
        expect(editor.markUnsavedChanges).toHaveBeenCalled();
        expect(document.body.classList.contains("bank-image-placement-mode")).toBe(false);
    });

    it("selects a bank image and inserts it into the clicked answer option", () => {
        const sharedRef = {
            path: "images/option-shared.png",
            asset_id: "asset_option_shared",
            asset_url: "/api/assets/asset_option_shared/content",
        };
        const harness = createTestEditorHarness({
            questions: [
                {
                    id: 1,
                    text: "First question",
                    options: [
                        { text: "A", is_correct: true, image_path: null },
                        { text: "B", is_correct: false, image_path: null },
                    ],
                    settings: { all_correct_required: true, allow_partial_credit: false },
                    explanation: "",
                    image: null,
                    images: [],
                },
                {
                    id: 2,
                    text: "Second question",
                    options: [
                        {
                            text: "A",
                            is_correct: true,
                            image_path: sharedRef.path,
                            image_asset_id: sharedRef.asset_id,
                            image_asset_url: sharedRef.asset_url,
                        },
                        { text: "B", is_correct: false, image_path: null },
                    ],
                    settings: { all_correct_required: true, allow_partial_credit: false },
                    explanation: "",
                    image: null,
                    images: [],
                },
            ],
            currentQuestionIndex: 0,
        });
        harnesses.push(harness);

        const { editor } = harness;
        document.querySelector(".test-image-bank__select").click();
        document.querySelector("#options-container .option-row textarea").click();

        expect(editor.requestJson).not.toHaveBeenCalled();
        expect(editor.questions[0].options[0]).toMatchObject({
            image_path: sharedRef.path,
            image_asset_id: sharedRef.asset_id,
            image_asset_url: sharedRef.asset_url,
        });
        expect(editor.questions[0].images).toEqual([]);
        expect(document.body.classList.contains("bank-image-placement-mode")).toBe(false);
    });

    it("opens a zoomable viewer from the image bank preview button", () => {
        const sharedRef = {
            path: "images/shared-preview.png",
            asset_id: "asset_shared_preview",
            asset_url: "/api/assets/asset_shared_preview/content",
        };
        const harness = createTestEditorHarness({
            questions: [
                {
                    id: 1,
                    text: "Question",
                    options: [
                        { text: "A", is_correct: true, image_path: null },
                        { text: "B", is_correct: false, image_path: null },
                    ],
                    settings: { all_correct_required: true, allow_partial_credit: false },
                    explanation: "",
                    image: sharedRef.path,
                    image_asset_id: sharedRef.asset_id,
                    image_asset_url: sharedRef.asset_url,
                    images: [sharedRef],
                },
            ],
        });
        harnesses.push(harness);

        document.querySelector(".test-image-bank__preview-btn").click();

        const viewer = document.querySelector(".test-image-bank-viewer");
        expect(viewer).toBeTruthy();
        expect(viewer.querySelector("img").getAttribute("src")).toBe(sharedRef.asset_url);
    });

    it("collapses and expands the image bank from the sidebar toggle", () => {
        const sharedRef = {
            path: "images/collapsible-bank.png",
            asset_id: "asset_collapsible_bank",
            asset_url: "/api/assets/asset_collapsible_bank/content",
        };
        const harness = createTestEditorHarness({
            questions: [
                {
                    id: 1,
                    text: "Question",
                    options: [
                        { text: "A", is_correct: true, image_path: null },
                        { text: "B", is_correct: false, image_path: null },
                    ],
                    settings: { all_correct_required: true, allow_partial_credit: false },
                    explanation: "",
                    image: sharedRef.path,
                    image_asset_id: sharedRef.asset_id,
                    image_asset_url: sharedRef.asset_url,
                    images: [sharedRef],
                },
            ],
        });
        harnesses.push(harness);

        const toggle = document.querySelector("#test-image-bank-toggle");
        const panel = document.querySelector("#test-image-bank-panel");

        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(panel.classList.contains("hidden")).toBe(false);

        toggle.click();
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(panel.classList.contains("hidden")).toBe(true);

        toggle.click();
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(panel.classList.contains("hidden")).toBe(false);
    });

    it("uses an option image button as an explicit paste target", async () => {
        const harness = createTestEditorHarness();
        harnesses.push(harness);

        const { editor } = harness;
        const file = new File(["option-image"], "option.png", { type: "image/png" });
        const optionUploadButton = document.querySelector(".upload-option-image");
        editor.requestJson.mockResolvedValue({
            path: "images/option-a.png",
            asset_id: "asset_option_a",
            asset_url: "/api/assets/asset_option_a/content",
        });

        const pasteEvent = createImagePasteEvent(optionUploadButton, file);
        await editor.handleClipboardPaste(pasteEvent);

        expect(pasteEvent.preventDefault).toHaveBeenCalledOnce();
        expect(editor.questions[0].options[0].image_path).toBe("images/option-a.png");
        expect(editor.questions[0].options[0].image_asset_id).toBe("asset_option_a");
    });

    it("accepts pasted images exposed through clipboardData.files", async () => {
        const harness = createTestEditorHarness();
        harnesses.push(harness);

        const { editor } = harness;
        const file = new File(["files-only-image"], "files-only.png", { type: "image/png" });
        const questionTextarea = document.querySelector("#question-textarea");
        editor.requestJson.mockResolvedValue({
            path: "images/files-only.png",
            asset_id: "asset_files_only",
            asset_url: "/api/assets/asset_files_only/content",
        });

        const pasteEvent = createFilesOnlyImagePasteEvent(questionTextarea, file);
        await editor.handleClipboardPaste(pasteEvent);

        expect(pasteEvent.preventDefault).toHaveBeenCalledOnce();
        expect(editor.questions[0].image).toBe("images/files-only.png");
        expect(editor.questions[0].image_asset_id).toBe("asset_files_only");
        expect(editor.questions[0].images).toHaveLength(1);
    });

    it("enters target selection mode when the paste target is ambiguous and applies the clicked option card", async () => {
        const harness = createTestEditorHarness();
        harnesses.push(harness);

        const { editor } = harness;
        const file = new File(["chooser-image"], "chooser.png", { type: "image/png" });
        const pasteEvent = createImagePasteEvent(document.body, file);

        await editor.handleClipboardPaste(pasteEvent);

        const modal = document.querySelector("#paste-image-target-modal");
        const optionRow = document.querySelector('.option-row[data-option-index="1"]');

        expect(pasteEvent.preventDefault).toHaveBeenCalledOnce();
        expect(modal.classList.contains("hidden")).toBe(false);
        expect(document.body.classList.contains("paste-image-selection-mode")).toBe(true);
        expect(optionRow.classList.contains("is-paste-selectable")).toBe(true);

        editor.requestJson.mockResolvedValue({
            path: "images/option-b.png",
            asset_id: "asset_option_b",
            asset_url: "/api/assets/asset_option_b/content",
        });

        await editor.handlePasteTargetSelectionClick({
            target: optionRow,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        });

        expect(editor.questions[0].options[1].image_path).toBe("images/option-b.png");
        expect(modal.classList.contains("hidden")).toBe(true);
        expect(document.body.classList.contains("paste-image-selection-mode")).toBe(false);
    });

    it("does not hijack image paste inside the import modal text area", async () => {
        const harness = createTestEditorHarness();
        harnesses.push(harness);

        const { editor } = harness;
        const importModal = document.querySelector("#import-modal");
        const importTextInput = document.querySelector("#import-text-input");
        const file = new File(["ignored-image"], "ignored.png", { type: "image/png" });

        importModal.classList.remove("hidden");

        const pasteEvent = createImagePasteEvent(importTextInput, file);
        await editor.handleClipboardPaste(pasteEvent);

        expect(pasteEvent.preventDefault).not.toHaveBeenCalled();
        expect(editor.requestJson).not.toHaveBeenCalled();
        expect(document.querySelector("#paste-image-target-modal").classList.contains("hidden")).toBe(true);
    });

    it("falls back to navigator.clipboard.read() when the paste event carries no file items", async () => {
        const harness = createTestEditorHarness();
        harnesses.push(harness);

        const { editor } = harness;
        const questionTextarea = document.querySelector("#question-textarea");
        const originalClipboard = navigator.clipboard;
        const clipboardRead = vi.fn().mockResolvedValue([
            {
                types: ["image/png"],
                getType: vi.fn().mockResolvedValue(new Blob(["navigator-image"], { type: "image/png" })),
            },
        ]);

        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                ...originalClipboard,
                read: clipboardRead,
            },
        });

        editor.requestJson.mockResolvedValue({
            path: "images/navigator.png",
            asset_id: "asset_navigator",
            asset_url: "/api/assets/asset_navigator/content",
        });

        const pasteEvent = createEmptyPasteEvent(questionTextarea);
        await editor.handleClipboardPaste(pasteEvent);

        expect(clipboardRead).toHaveBeenCalledOnce();
        expect(pasteEvent.preventDefault).toHaveBeenCalledOnce();
        expect(editor.questions[0].image).toBe("images/navigator.png");
        expect(editor.questions[0].image_asset_id).toBe("asset_navigator");
        expect(editor.questions[0].images).toHaveLength(1);
    });

    it("appends question images up to three, removes by index, and mirrors the first image on save", async () => {
        const harness = createTestEditorHarness();
        harnesses.push(harness);

        const { editor } = harness;
        editor.requestJson
            .mockResolvedValueOnce({
                path: "images/question-1.png",
                asset_id: "asset_question_1",
                asset_url: "/api/assets/asset_question_1/content",
            })
            .mockResolvedValueOnce({
                path: "images/question-2.png",
                asset_id: "asset_question_2",
                asset_url: "/api/assets/asset_question_2/content",
            })
            .mockResolvedValueOnce({
                path: "images/question-3.png",
                asset_id: "asset_question_3",
                asset_url: "/api/assets/asset_question_3/content",
            });

        await editor.uploadImageFileForQuestion(new File(["one"], "one.png", { type: "image/png" }));
        await editor.uploadImageFileForQuestion(new File(["two"], "two.png", { type: "image/png" }));
        await editor.uploadImageFileForQuestion(new File(["three"], "three.png", { type: "image/png" }));
        const fourthResult = await editor.uploadImageFileForQuestion(new File(["four"], "four.png", { type: "image/png" }));

        expect(fourthResult).toBe(false);
        expect(editor.requestJson).toHaveBeenCalledTimes(3);
        expect(editor.questions[0].images).toHaveLength(3);

        editor.removeQuestionImage(0);

        expect(editor.questions[0].images).toHaveLength(2);
        expect(editor.questions[0].image).toBe("images/question-2.png");
        expect(editor.questions[0].image_asset_id).toBe("asset_question_2");

        const payload = editor.buildBackendContent();
        expect(payload.questions[0].images).toEqual([
            {
                path: "images/question-2.png",
                asset_id: "asset_question_2",
                asset_url: "/api/assets/asset_question_2/content",
            },
            {
                path: "images/question-3.png",
                asset_id: "asset_question_3",
                asset_url: "/api/assets/asset_question_3/content",
            },
        ]);
        expect(payload.questions[0].image_path).toBe("images/question-2.png");
        expect(payload.questions[0].image_asset_id).toBe("asset_question_2");
        expect(payload.questions[0].image_asset_url).toBe("/api/assets/asset_question_2/content");
    });

    it("removes the final question image instead of restoring it from legacy mirror fields", async () => {
        const harness = createTestEditorHarness();
        harnesses.push(harness);

        const { editor } = harness;
        editor.questions[0] = {
            ...editor.questions[0],
            image: "images/question.png",
            image_path: "images/question.png",
            image_asset_id: "asset_question",
            image_asset_url: "/api/assets/asset_question/content",
            images: [
                {
                    path: "images/question.png",
                    asset_id: "asset_question",
                    asset_url: "/api/assets/asset_question/content",
                },
            ],
        };

        editor.removeQuestionImage(0);

        expect(editor.questions[0].images).toEqual([]);
        expect(editor.questions[0].image).toBe(null);
        expect(editor.questions[0].image_path).toBe(null);
        expect(editor.questions[0].image_asset_id).toBe(null);
        expect(editor.questions[0].image_asset_url).toBe(null);

        const payload = editor.buildBackendContent();
        expect(payload.questions[0].images).toBeUndefined();
        expect(payload.questions[0].image).toBeUndefined();
        expect(payload.questions[0].image_path).toBeUndefined();
        expect(payload.questions[0].image_asset_id).toBeUndefined();
        expect(payload.questions[0].image_asset_url).toBeUndefined();
    });

    it("allows cancelling target selection mode", async () => {
        const harness = createTestEditorHarness();
        harnesses.push(harness);

        const { editor } = harness;
        const file = new File(["cancel-image"], "cancel.png", { type: "image/png" });

        await editor.handleClipboardPaste(createImagePasteEvent(document.body, file));

        const cancelButton = document.querySelector("#paste-image-target-cancel");
        cancelButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

        expect(document.querySelector("#paste-image-target-modal").classList.contains("hidden")).toBe(true);
        expect(document.body.classList.contains("paste-image-selection-mode")).toBe(false);
        expect(editor.pendingPastedImageFile).toBe(null);
    });
});
