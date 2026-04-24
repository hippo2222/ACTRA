import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestEditorHarness } from "./ui/editor_audit/test_adapter.mjs";

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
