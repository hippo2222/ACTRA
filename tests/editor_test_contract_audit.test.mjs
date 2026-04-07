import { defineEditorAuditContract } from "./ui/editor_audit/core.mjs";
import { createTestEditorAuditAdapter } from "./ui/editor_audit/test_adapter.mjs";

defineEditorAuditContract({
    editorName: "Test",
    createAdapter: createTestEditorAuditAdapter,
});
