import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    runAffordanceAudit,
    runArchivedLogicAudit,
    runCopyLint,
    runDirtyStateAudit,
    runSurfaceDriftAudit,
} from "./editor_audit/core.mjs";
import { createTestEditorAuditAdapter } from "./editor_audit/test_adapter.mjs";

describe("Test editor surface heuristics", () => {
    let adapter;

    beforeEach(() => {
        adapter = createTestEditorAuditAdapter();
    });

    afterEach(() => {
        adapter?.teardown?.();
    });

    it("flags untranslated and technical copy in the editor surface", () => {
        const issues = runCopyLint(adapter.createCopyLintContext());

        expect(issues).toEqual([]);
    });

    it("flags archived legacy logic left after early returns", () => {
        const issues = runArchivedLogicAudit(adapter.createArchivedLogicAuditContext());

        expect(issues).toEqual([]);
    });

    it("flags selectors referenced in JS but missing from the current HTML surface", () => {
        const issues = runSurfaceDriftAudit(adapter.createSurfaceDriftAuditContext());

        expect(issues).toEqual([]);
    });

    it("guards against transient import state leaking across drafts and modal closes", () => {
        const issues = runDirtyStateAudit(adapter.createDirtyStateAuditContext());

        expect(issues).toEqual([]);
    });

    it("flags icon-only controls that still lack a visible or accessible label", () => {
        const issues = runAffordanceAudit(adapter.createAffordanceAuditContext());

        expect(issues).toEqual([]);
    });
});

describe("Editor audit heuristic detectors", () => {
    it("still detects untranslated copy on synthetic broken input", () => {
        const issues = runCopyLint({
            sources: [{ label: "fixture", text: '<button title="Import from JSON">x</button>' }],
            forbiddenPatterns: [/Import from JSON/i],
        });

        expect(issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "copy_lint",
                    label: "fixture",
                    match: "Import from JSON",
                }),
            ])
        );
    });

    it("still detects unreachable tails after return on synthetic broken input", () => {
        const issues = runArchivedLogicAudit({
            methodSources: [{
                name: "brokenFlow",
                source: `async brokenFlow() {\n    if (!ready) {\n        return;\n    }\n    return;\n\n    confirm("legacy");\n}`,
                startLine: 10,
            }],
            suspiciousTailPatterns: [/confirm\(/],
        });

        expect(issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "code_after_return",
                    method: "brokenFlow",
                }),
                expect.objectContaining({
                    type: "suspicious_tail_pattern",
                    method: "brokenFlow",
                    pattern: "/confirm\\(/",
                }),
            ])
        );
    });

    it("still detects selector drift on synthetic broken input", () => {
        const issues = runSurfaceDriftAudit({
            htmlSource: '<div id="present"></div>',
            jsSource: 'document.querySelector("#missing-selector");',
        });

        expect(issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "missing_selector_in_html",
                    selector: "missing-selector",
                }),
            ])
        );
    });

    it("still detects unlabeled icon-only buttons on synthetic broken input", () => {
        const issues = runAffordanceAudit({
            htmlSource: '<button id="icon-only"><span class="material-symbols-outlined">close</span></button>',
            jsSources: ['document.getElementById("icon-only");'],
        });

        expect(issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "icon_only_button_missing_label",
                    buttonId: "icon-only",
                }),
            ])
        );
    });
});
