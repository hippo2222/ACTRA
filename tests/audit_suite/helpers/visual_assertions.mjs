/**
 * tests/audit_suite/helpers/visual_assertions.mjs
 * 
 * Deterministic Visual Engineering Assertions for ACTRA UI Audit Suite
 * Codified in accordance with ACTRA UI/UX Design Standards (AGENTS.md Rule 10)
 */

/**
 * 1. assertScrollportSafetyMargin
 * Asserts that any child inside a scrolling/clipped container maintains at least minMarginPx
 * clearance from the container's scroll boundaries, preventing clipped borders, focus rings, and box-shadows.
 */
export async function assertScrollportSafetyMargin(page, containerSelector, childSelector, minMarginPx = 4) {
    const findings = await page.evaluate(({ cSel, chSel, minMargin }) => {
        const errors = [];
        const container = document.querySelector(cSel);
        if (!container) return [`Container not found: ${cSel}`];
        const cRect = container.getBoundingClientRect();
        const children = Array.from(container.querySelectorAll(chSel));
        if (children.length === 0) return [`No children matched selector ${chSel} in ${cSel}`];

        children.forEach((child, idx) => {
            const r = child.getBoundingClientRect();
            const leftGap = r.left - cRect.left;
            const rightGap = cRect.right - r.right;
            if (leftGap < minMargin - 0.5) {
                errors.push(`Child #${idx} (${child.textContent.trim().slice(0, 20)}) left clearance ${leftGap.toFixed(1)}px < ${minMargin}px (risk of clipped border/shadow)`);
            }
            if (rightGap < minMargin - 0.5) {
                errors.push(`Child #${idx} (${child.textContent.trim().slice(0, 20)}) right clearance ${rightGap.toFixed(1)}px < ${minMargin}px (risk of clipped border/shadow)`);
            }
        });
        return errors;
    }, { cSel: containerSelector, chSel: childSelector, minMargin: minMarginPx });

    if (findings.length > 0) {
        throw new Error(`[assertScrollportSafetyMargin Violation] in ${containerSelector} > ${childSelector}:\n` + findings.join('\n'));
    }
    return true;
}

/**
 * 2. assertParentCornerContainment
 * Asserts that a child element does not push into the rounded corner curve of its parent container.
 */
export async function assertParentCornerContainment(page, containerSelector, childSelector) {
    const findings = await page.evaluate(({ cSel, chSel }) => {
        const errors = [];
        const container = document.querySelector(cSel);
        if (!container) return [`Container not found: ${cSel}`];
        const cRect = container.getBoundingClientRect();
        const cStyle = window.getComputedStyle(container);
        const borderRadius = parseFloat(cStyle.borderRadius) || 0;
        if (borderRadius <= 0) return []; // No rounded corners to check

        const children = Array.from(container.querySelectorAll(chSel));
        children.forEach((child, idx) => {
            const r = child.getBoundingClientRect();
            // Child cannot extend past parent.right minus effective corner curve
            const maxRight = cRect.right - (borderRadius * 0.4);
            const minLeft = cRect.left + (borderRadius * 0.4);
            if (r.right > maxRight + 0.5) {
                errors.push(`Child #${idx} (${child.textContent.trim().slice(0, 20)}) right edge ${r.right.toFixed(1)}px encroaches on parent rounded corner (limit ${maxRight.toFixed(1)}px, radius ${borderRadius}px)`);
            }
            if (r.left < minLeft - 0.5) {
                errors.push(`Child #${idx} (${child.textContent.trim().slice(0, 20)}) left edge ${r.left.toFixed(1)}px encroaches on parent rounded corner (limit ${minLeft.toFixed(1)}px, radius ${borderRadius}px)`);
            }
        });
        return errors;
    }, { cSel: containerSelector, chSel: childSelector });

    if (findings.length > 0) {
        throw new Error(`[assertParentCornerContainment Violation]:\n` + findings.join('\n'));
    }
    return true;
}

/**
 * 3. assertNoGamificationSlop
 * Scans all visible text nodes in the target element for forbidden gaming jargon and synthetic badges.
 */
export async function assertNoGamificationSlop(page, rootSelector = '#create-task-modal') {
    const forbiddenPatterns = [
        /точность\s*100%/i,
        /\baccuracy\s*100%/i,
        /\bscore\b/i,
        /\blevel\s*\d+\b/i,
        /набрали\s*\d+\s*очков/i,
        /\bcombo\s*x\d+/i,
        /\bperfect\b/i
    ];

    const findings = await page.evaluate(({ rootSel, patterns }) => {
        const root = document.querySelector(rootSel);
        if (!root) return [`Root element not found: ${rootSel}`];

        const violations = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const text = node.textContent.trim();
            if (!text) continue;
            for (const patStr of patterns) {
                const regex = new RegExp(patStr.source, patStr.flags);
                if (regex.test(text)) {
                    violations.push(`Forbidden gamification/slop phrase detected: "${text}" matches ${regex.toString()}`);
                }
            }
        }
        return violations;
    }, { rootSel: rootSelector, patterns: forbiddenPatterns.map(p => ({ source: p.source, flags: p.flags })) });

    if (findings.length > 0) {
        throw new Error(`[assertNoGamificationSlop Violation] in ${rootSelector}:\n` + findings.join('\n'));
    }
    return true;
}

/**
 * 4. assertDomZeroGhost
 * Asserts that deprecated or removed UI controls are not merely hidden with display:none in the DOM,
 * but completely purged from the markup.
 */
export async function assertDomZeroGhost(page, ghostSelectors = []) {
    const findings = await page.evaluate((selectors) => {
        const found = [];
        selectors.forEach(sel => {
            const el = document.querySelector(sel);
            if (el) {
                found.push(`Ghost element "${sel}" still exists in DOM (tag: ${el.tagName}, class: "${el.className}"). It must be completely deleted, not masked with display:none.`);
            }
        });
        return found;
    }, ghostSelectors);

    if (findings.length > 0) {
        throw new Error(`[assertDomZeroGhost Violation]:\n` + findings.join('\n'));
    }
    return true;
}

/**
 * 5. assertCornerCurvatureIntegrity
 * Verifies that rounded elements have symmetric, continuous border curvature and are not clipped by parent scrollports.
 */
export async function assertCornerCurvatureIntegrity(page, elementSelector) {
    const findings = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return [`Element not found: ${sel}`];
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const radius = parseFloat(style.borderRadius) || 0;
        if (radius <= 0) return [];

        const parent = el.parentElement;
        if (!parent) return [];
        const pRect = parent.getBoundingClientRect();
        const pStyle = window.getComputedStyle(parent);

        const isClippedByParent = (
            (pStyle.overflowX === 'hidden' || pStyle.overflowX === 'auto') &&
            (r.left < pRect.left + 0.5 || r.right > pRect.right - 0.5)
        );

        if (isClippedByParent) {
            return [`Element ${sel} (border-radius: ${radius}px) is clipped by parent scrollport (${pRect.left} to ${pRect.right}). Left: ${r.left.toFixed(1)}, Right: ${r.right.toFixed(1)}`];
        }
        return [];
    }, elementSelector);

    if (findings.length > 0) {
        throw new Error(`[assertCornerCurvatureIntegrity Violation]:\n` + findings.join('\n'));
    }
    return true;
}
