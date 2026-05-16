import { defineEditorAuditContract } from "./editor_audit/core.mjs";
import { createClickEditorAuditAdapter } from "./editor_audit/click_adapter.mjs";

defineEditorAuditContract({
    editorName: "Click",
    createAdapter: createClickEditorAuditAdapter,
});
