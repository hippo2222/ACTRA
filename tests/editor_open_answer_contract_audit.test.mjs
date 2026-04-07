import { defineEditorAuditContract } from "./ui/editor_audit/core.mjs";
import { createOpenAnswerEditorAuditAdapter } from "./ui/editor_audit/open_answer_adapter.mjs";

defineEditorAuditContract({
    editorName: "Open answer",
    createAdapter: createOpenAnswerEditorAuditAdapter,
});
