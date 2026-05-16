import { defineEditorAuditContract } from "./editor_audit/core.mjs";
import { createTestEditorAuditAdapter } from "./editor_audit/test_adapter.mjs";

defineEditorAuditContract({
    editorName: "Test",
    createAdapter: createTestEditorAuditAdapter,
});
