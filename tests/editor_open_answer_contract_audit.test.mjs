import { defineEditorAuditContract } from "./editor_audit/core.mjs";
import { createOpenAnswerEditorAuditAdapter } from "./editor_audit/open_answer_adapter.mjs";

defineEditorAuditContract({
    editorName: "Open answer",
    createAdapter: createOpenAnswerEditorAuditAdapter,
});
