import { afterEach, beforeEach, describe, expect, it } from "vitest";

function resolveLineColumn(text, index) {
    const safeIndex = Math.max(0, Number.isFinite(index) ? index : 0);
    const before = String(text).slice(0, safeIndex);
    const line = before.split(/\r?\n/).length;
    const lastLineBreak = Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
    const column = safeIndex - lastLineBreak;
    return { line, column };
}

function stripHtml(html) {
    return String(html || "").replace(/<[^>]+>/g, " ");
}

function normalizeIssueCollection(result, fallback = {}) {
    if (!result) {
        return [];
    }
    if (Array.isArray(result)) {
        return result.map((issue) => ({ ...fallback, ...issue }));
    }
    return [{ ...fallback, ...result }];
}

export function runCopyLint({ sources = [], forbiddenPatterns = [] }) {
    const issues = [];

    for (const source of sources) {
        const label = source?.label || "unknown";
        const text = String(source?.text || "");
        for (const pattern of forbiddenPatterns) {
            const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
            const re = new RegExp(pattern.source, flags);
            const matches = [...text.matchAll(re)];
            for (const match of matches) {
                const { line, column } = resolveLineColumn(text, match.index ?? 0);
                issues.push({
                    type: "copy_lint",
                    label,
                    match: match[0],
                    pattern: pattern.toString(),
                    line,
                    column,
                });
            }
        }
    }

    return issues;
}

export function runArchivedLogicAudit({ methodSources = [], suspiciousTailPatterns = [] }) {
    const issues = [];

    for (const method of methodSources) {
        const name = method?.name || "unknown";
        const source = String(method?.source || "");
        const baseLine = Number.isFinite(method?.startLine) ? method.startLine : 1;
        const returnMatches = [...source.matchAll(/\breturn;/g)];

        for (const returnMatch of returnMatches) {
            const returnIndex = returnMatch.index ?? -1;
            if (returnIndex === -1) {
                continue;
            }

            const lineStart = source.lastIndexOf("\n", returnIndex) + 1;
            const lineEndIndex = source.indexOf("\n", returnIndex);
            const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
            const returnLine = source.slice(lineStart, lineEnd);

            // Skip concise guard-clauses like: if (!task) return;
            if (/\b(if|else if)\b/.test(returnLine)) {
                continue;
            }

            const afterReturn = source.slice(returnIndex + "return;".length);
            const nextTokenMatch = afterReturn.match(/(?:\r?\n|\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/);
            const nextTokenIndex = nextTokenMatch ? nextTokenMatch[0].length : 0;
            const nextTokenChar = afterReturn[nextTokenIndex];

            // Guard-clause returns are followed by a closing brace of the current block.
            if (!nextTokenChar || nextTokenChar === "}") {
                continue;
            }

            const tail = afterReturn.slice(nextTokenIndex).trim();
            if (!tail) {
                continue;
            }

            const returnLocation = resolveLineColumn(source, returnIndex);
            issues.push({
                type: "code_after_return",
                method: name,
                line: baseLine + returnLocation.line - 1,
            });

            for (const pattern of suspiciousTailPatterns) {
                const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
                const re = new RegExp(pattern.source, flags);
                const match = re.exec(tail);
                if (match) {
                    const tailLocation = resolveLineColumn(tail, match.index ?? 0);
                    issues.push({
                        type: "suspicious_tail_pattern",
                        method: name,
                        pattern: pattern.toString(),
                        line: baseLine + returnLocation.line + tailLocation.line - 1,
                        match: match[0],
                    });
                }
            }
        }
    }

    return issues;
}

export function runSurfaceDriftAudit({ htmlSource = "", jsSource = "", focusSelectors = [] }) {
    const htmlIds = new Set(
        [...String(htmlSource).matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
    );
    const jsText = String(jsSource);

    const jsSelectors = new Set(
        [...jsText.matchAll(/['"`]#([A-Za-z0-9_-]+)['"`]/g)].map((match) => match[1])
    );

    const selectorPool = focusSelectors.length ? focusSelectors : [...jsSelectors];
    const missing = selectorPool.filter((selector) => !htmlIds.has(selector));

    return missing.map((selector) => {
        const selectorMatch = jsText.match(new RegExp(`['"\`]#${selector}['"\`]`));
        const location = resolveLineColumn(jsText, selectorMatch?.index ?? 0);
        return {
            type: "missing_selector_in_html",
            selector,
            line: location.line,
        };
    });
}

export function runDirtyStateAudit({ cases = [] }) {
    const issues = [];

    for (const auditCase of cases) {
        const result = auditCase?.run?.();
        issues.push(
            ...normalizeIssueCollection(result, {
                type: "dirty_state_issue",
                caseId: auditCase?.id || "unknown_case",
            })
        );
    }

    return issues;
}

export function runAffordanceAudit({ htmlSource = "", jsSources = [], ignoreButtonIds = [] }) {
    const issues = [];
    const htmlText = String(htmlSource);
    const ignored = new Set(ignoreButtonIds);
    const buttonPattern = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
    const jsText = jsSources.map((source) => String(source || "")).join("\n");
    const wiredIds = new Set();

    for (const match of jsText.matchAll(/(?:getElementById|querySelector)\(\s*['"`]#?([A-Za-z0-9_-]+)['"`]/g)) {
        wiredIds.add(match[1]);
    }

    for (const match of htmlText.matchAll(buttonPattern)) {
        const attrs = match[1] || "";
        const innerHtml = match[2] || "";
        // Anchor to start/whitespace so this matches the real `id` attribute and
        // NOT data-*-id attributes (e.g. data-onboarding-tour-id), where the `-`
        // before "id" is also a \b word boundary and caused false positives.
        const idMatch = attrs.match(/(?:^|\s)id="([^"]+)"/i);
        const buttonId = idMatch?.[1] || null;
        const titleMatch = attrs.match(/\btitle="([^"]+)"/i);
        const ariaLabelMatch = attrs.match(/\baria-label="([^"]+)"/i);
        const line = resolveLineColumn(htmlText, match.index ?? 0).line;

        if (buttonId && ignored.has(buttonId)) {
            continue;
        }

        const visibleHtml = innerHtml.replace(
            /<span\b[^>]*material-symbols-outlined[^>]*>[\s\S]*?<\/span>/gi,
            " "
        );
        const visibleText = stripHtml(visibleHtml).replace(/\s+/g, " ").trim();
        const hasAccessibleName = Boolean(titleMatch?.[1] || ariaLabelMatch?.[1] || visibleText);

        if (!hasAccessibleName) {
            issues.push({
                type: "icon_only_button_missing_label",
                buttonId,
                line,
            });
        }

        if (buttonId && !wiredIds.has(buttonId) && !/\bonclick\s*=/.test(attrs)) {
            issues.push({
                type: "button_without_js_wiring",
                buttonId,
                line,
            });
        }
    }

    return issues;
}

export function defineEditorAuditContract({ editorName, createAdapter }) {
    describe(`${editorName} editor audit contract`, () => {
        let adapter;

        beforeEach(() => {
            adapter = createAdapter();
        });

        afterEach(() => {
            adapter?.teardown?.();
        });

        it("captures live primary and supplementary state in draft", () => {
            const context = adapter.createDraftRoundtripContext();
            const state = context.editor.captureState();

            expect(context.readDraft(state)).toEqual(context.expected);
        });

        it("hydrates canonical fields back into the UI", () => {
            const context = adapter.createCanonicalHydrationContext();
            context.hydrate?.();

            expect(context.readUi(context.editor)).toEqual(context.expected);
        });

        it("keeps a destructive action reversible", () => {
            const context = adapter.createUndoableDestructiveContext();
            context.act();

            expect(context.read(context.editor)).toEqual(context.expectedAfterAction);

            context.undo();

            expect(context.read(context.editor)).toEqual(context.expectedAfterUndo);
        });

        it("describes the editor surface and scenario matrix", () => {
            const descriptor = adapter.describeSurfaceAudit();

            expect(Array.isArray(descriptor.capabilities)).toBe(true);
            expect(descriptor.capabilities.length).toBeGreaterThan(0);
            expect(Array.isArray(descriptor.riskClasses)).toBe(true);
            expect(descriptor.riskClasses.length).toBeGreaterThan(0);
            expect(Array.isArray(descriptor.heuristics)).toBe(true);
            expect(descriptor.heuristics.length).toBeGreaterThan(0);

            expect(descriptor.scenarios).toBeTruthy();
            expect(Array.isArray(descriptor.scenarios.happy)).toBe(true);
            expect(Array.isArray(descriptor.scenarios.rich)).toBe(true);
            expect(Array.isArray(descriptor.scenarios.recovery)).toBe(true);
            expect(Array.isArray(descriptor.scenarios.error)).toBe(true);
            expect(Array.isArray(descriptor.scenarios.destructive)).toBe(true);

            expect(
                descriptor.scenarios.happy.length +
                descriptor.scenarios.rich.length +
                descriptor.scenarios.recovery.length +
                descriptor.scenarios.error.length +
                descriptor.scenarios.destructive.length
            ).toBeGreaterThan(0);
        });
    });
}
