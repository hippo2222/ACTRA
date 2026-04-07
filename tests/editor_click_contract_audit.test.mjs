import { defineEditorAuditContract } from "./ui/editor_audit/core.mjs";
import { createClickEditorAuditAdapter } from "./ui/editor_audit/click_adapter.mjs";

defineEditorAuditContract({
    editorName: "Click",
    createAdapter: createClickEditorAuditAdapter,
});
