---
name: llm-verifier
description: Fine-grained LLM verification, Best-of-N candidate selection, criteria decomposition, and automated validation for code and architecture in ACTRA.
---

# LLM-as-a-Verifier Skill for ACTRA

This skill embodies the **LLM-as-a-Verifier** methodology (test-time scaling, criteria decomposition, fine-grained scoring, and verification gates) tailored for development in the ACTRA project.

## When to Apply

Apply automatically on:
- Designing new modules, endpoints, or database structures (Best-of-N selection).
- Refactoring existing services, models, and UI components.
- Pre-submission verification (Verification Gate) before concluding any task.

---

## 1. Decomposed Verification Rubric

Every candidate solution / diff is evaluated against 5 fine-grained criteria:

| Dimension | Verification Questions & Checks |
|---|---|
| **1. Functional Correctness** | Does the code fully meet the task objectives? Are edge cases (empty lists, None values, boundaries) handled? Are heavy stress payloads tested ($\ge 1500$–$2500$ chars, wall of text, worst-case geometry at bottom of page)? |
| **2. Architectural Fit & Regressions** | Does it strictly honor the ACTRA stack (PostgreSQL on port 5433, Flask backend, MinIO S3, vanilla frontend)? Are adjacent files/endpoints intact? |
| **3. Security & Resilience** | Is there proper error isolation (`try/except`, status codes, transactional rollbacks)? Are inputs sanitized? |
| **4. Performance & Resource Usage** | Are queries optimized (no N+1)? Are async/sync boundaries respected? Is memory clean? |
| **5. Code Craft & UI/UX** | Is the code idiomatic, maintainable, and aligned with ACTRA design tokens without cliché tropes? Are stacking contexts clean (no occlusion of overlays), dismiss controls reachable in-view, and height capped adaptively? |

---

## 2. Best-of-N Strategy for Complex Decisions

When multiple valid architectural or implementation paths exist:
1. **Candidate Generation (N=2..3):** Draft distinct alternative approaches.
2. **Scoring:** Rate each candidate across the rubric dimensions.
3. **Selection:** Choose the top candidate with a clear justification.

---

## 3. Verification Gate Checklist

Before delivering code or marking a task done:
- [ ] Inspect full diff against the rubric.
- [ ] Run syntax check / unit tests if available.
- [ ] Ensure no temporary debug artifacts or broken imports remain.
- [ ] Output verification confirmation (Verification Verdict: PASS).

---

## 4. Multi-Role Subagent Audit Panel for UI/UX

For UI audits, refactorings, or editor reviews, verification is conducted using the **Multi-Role Subagent Panel Protocol** (see `.agents/AGENTS.md` Section 10 & 11):
1. **Novice Teacher (First-Time UX & Onboarding):** Zero-Placeholder, clean empty state (`01_default_blank`), step-by-step audit (never skip Step 1), guided tour coherence, non-technical terminology, data-loss protection (`confirmAction`).
2. **Methodologist / Workflow Engineer (Didactics & Ergonomics):** Stress payloads (long text, 8–12 items, 4+ levels), didactic validity of evaluation modes, Z-pattern readability, `/reference` guide utility.
3. **Cold-Eye Visual Critic (Design System Guardian):** 9 deadly layout sins, 8 Headless Assertions (Anti-Truncation, Anti-Collision, Viewport Fold, Stacking Context, Dismiss Reachability, Anti-Void `densityRatio >= 0.70` & `bottomVoid <= 48px`, Anti-Glue `gap >= 16px`, Anti-Phantom-CSS), Step-Aware Geometry Canon (Dialog vs Studio), dark theme contrast (WCAG AA).
4. **Execution Protocol & Per-Iteration Gate:** 5 phases (Baseline Capture $\to$ Subagent Isolation with Adversarial Quota $\ge 3$ $\to$ Cumulative `audit_findings_registry.md` $\to$ Batched Fixes $\to$ Post-Fix Verification Gate). **Per-Iteration Subagent Review Gate:** Strictly forbidden to declare UI work done without independent subagents reviewing real screenshots via `view_file` and passing the visual inspection.


