/**
 * Contrast Auditor - Automated WCAG & Theme Compliance Checker (v2.0)
 * 
 * USAGE:
 * Copy this entire script and paste it into the Chrome/Edge Console (F12) 
 * while on the page you want to audit.
 */

(function () {
    function runContrastAudit(options = {}) {
        const silent = options && options.silent === true;
        const includeHidden = options && options.includeHidden === true;
        const simulateStates = options && options.simulateStates === true;
        const strictAA = options && options.strictAA === true;
        const uiGuideStrict = options && options.uiGuideStrict === true;
        const warnExcessiveTextContrast = !(options && options.warnExcessiveTextContrast === false);
        const ignoreModalBackdropPanelWarnings = options && options.ignoreModalBackdropPanelWarnings === true;
        const ignoreNativeToggleBorderWarnings = options && options.ignoreNativeToggleBorderWarnings === true;
        const minTextContrast = options && Number.isFinite(options.minTextContrast) ? Number(options.minTextContrast) : 4.5;
        const selectedOptionMinContrast = options && Number.isFinite(options.selectedOptionMinContrast)
            ? Number(options.selectedOptionMinContrast)
            : (uiGuideStrict ? 5.5 : minTextContrast);
        const requestedTolerance = options && Number.isFinite(options.tolerance) ? Number(options.tolerance) : null;
        const contrastTolerance = (strictAA || uiGuideStrict) ? 0 : (requestedTolerance !== null ? requestedTolerance : 0.35);
        const simulatedStates = Array.isArray(options && options.simulatedStates) && options.simulatedStates.length > 0
            ? options.simulatedStates
            : ['hover', 'focus', 'active', 'disabled', 'data-active=true'];
        if (!silent) {
            console.clear();
            console.log("%c Starting Contrast Audit (v2)...", "background: #222; color: #bada55; font-size: 14px; padding: 4px;");
            if (simulateStates) {
                console.log("%c Simulating states:", "color: #0aa;", simulatedStates.join(', '));
            }
            if (includeHidden) {
                console.log("%c Including hidden elements in audit", "color: #0aa;");
            }
            console.log("%c Contrast tolerance:", "color: #0aa;", contrastTolerance);
            if (uiGuideStrict) {
                console.log("%c UI-Guide strict mode enabled", "color: #0aa;");
            }
        }

    // 1. HELPER FUNCTIONS
    function parseColor(color) {
        if (!color || color === 'transparent') return null;

        // Handle hex
        if (color.startsWith('#')) {
            if (color.length === 4) {
                const r = parseInt(color[1] + color[1], 16);
                const g = parseInt(color[2] + color[2], 16);
                const b = parseInt(color[3] + color[3], 16);
                return { r, g, b, a: 1 };
            }
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            return { r, g, b, a: 1 };
        }

        // Handle rgb/rgba (comma separated) - support decimals
        const match = color.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/);
        if (match) {
            return {
                r: parseInt(match[1]),
                g: parseInt(match[2]),
                b: parseInt(match[3]),
                a: match[4] !== undefined ? parseFloat(match[4]) : 1
            };
        }

        // Handle modern rgb syntax: rgb(255 255 255 / 0.5)
        const modern = color.match(/rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/);
        if (modern) {
            return {
                r: parseFloat(modern[1]),
                g: parseFloat(modern[2]),
                b: parseFloat(modern[3]),
                a: modern[4] !== undefined ? parseFloat(modern[4]) : 1
            };
        }

        // Handle CSS Color 4 syntax: color(srgb 0.2 0.3 0.4 / 0.5)
        const srgb = color.match(/color\(\s*srgb\s+([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)/i);
        if (srgb) {
            const toChannel = (value) => {
                if (String(value).includes('%')) {
                    return Math.round((parseFloat(value) / 100) * 255);
                }
                const numeric = parseFloat(value);
                return numeric <= 1 ? Math.round(numeric * 255) : Math.round(numeric);
            };
            const toAlpha = (value) => {
                if (value === undefined) return 1;
                if (String(value).includes('%')) {
                    return parseFloat(value) / 100;
                }
                return parseFloat(value);
            };
            return {
                r: toChannel(srgb[1]),
                g: toChannel(srgb[2]),
                b: toChannel(srgb[3]),
                a: toAlpha(srgb[4])
            };
        }
        return null;
    }

    function parseGradientColor(bgImage, style) {
        if (!bgImage || bgImage === 'none') return null;
        if (!bgImage.includes('gradient')) return null;
        const match = bgImage.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{6}/);
        if (match) return parseColor(match[0]);

        const varMatch = bgImage.match(/var\((--[^)]+)\)/);
        if (varMatch) {
            const varName = varMatch[1];
            const raw = (style?.getPropertyValue(varName) || getComputedStyle(document.documentElement).getPropertyValue(varName) || '').trim();
            return raw ? parseColor(raw) : null;
        }
        return null;
    }

    function hasGradientBackground(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.backgroundImage && style.backgroundImage.includes('gradient');
    }

    function hasVisibleGradientInBackgroundChain(el) {
        let node = el;
        while (node) {
            const style = window.getComputedStyle(node);
            if (style.backgroundImage && style.backgroundImage.includes('gradient')) {
                return true;
            }
            const bg = parseColor(style.backgroundColor);
            const nodeOpacity = parseFloat(style.opacity);
            const alpha = bg ? bg.a * (Number.isNaN(nodeOpacity) ? 1 : nodeOpacity) : 0;
            if (alpha >= 0.98) {
                return false;
            }
            node = node.parentElement;
        }
        return false;
    }

    function getEffectiveOpacity(el) {
        let opacity = 1;
        let node = el;
        while (node) {
            const style = window.getComputedStyle(node);
            const value = parseFloat(style.opacity);
            if (!Number.isNaN(value)) opacity *= value;
            node = node.parentElement;
        }
        return opacity;
    }

    function isElementDisabled(el) {
        let node = el;
        while (node) {
            if (node.matches && node.matches(':disabled')) return true;
            if (node.getAttribute && node.getAttribute('aria-disabled') === 'true') return true;
            node = node.parentElement;
        }
        return false;
    }

    function getLuminance({ r, g, b }) {
        const a = [r, g, b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    }

    function getContrastRatio(fg, bg) {
        const l1 = getLuminance(fg);
        const l2 = getLuminance(bg);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    function blendColors(fg, bg) {
        // Simple alpha blending
        const alpha = fg.a;
        if (alpha === 1) return fg;

        return {
            r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
            g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
            b: Math.round(fg.b * alpha + bg.b * (1 - alpha)),
            a: 1 // Assume opaque after blend
        };
    }

    function getEffectiveForegroundColor(fg, bg) {
        if (!fg || !bg) return null;
        return fg.a < 1 ? blendColors(fg, bg) : fg;
    }

    function getBaseElementBackground(el) {
        if (!el) return null;
        const style = window.getComputedStyle(el);
        const gradientColor = parseGradientColor(style.backgroundImage, style);
        if (gradientColor) return gradientColor;
        return parseColor(style.backgroundColor);
    }

    // Traverse up the DOM to find the effective background color
    function getEffectiveBackgroundColor(el) {
        let parent = el;
        const bgStack = [];

        while (parent) {
            const style = window.getComputedStyle(parent);
            const bg = parseColor(style.backgroundColor);

            if (bg && bg.a > 0) {
                bgStack.push(bg);
                // If we found a fully opaque background, stop
                if (bg.a === 1) break;
            }
            parent = parent.parentElement;
        }

        // Blend from bottom up (root -> element)
        // Default to global theme background if stack doesn't end in opaque
        // (Simplified: assuming page bg is main)
        const themeBg = window.getComputedStyle(document.body).backgroundColor;
        let finalBg = parseColor(themeBg) || { r: 255, g: 255, b: 255, a: 1 };

        for (let i = bgStack.length - 1; i >= 0; i--) {
            finalBg = blendColors(bgStack[i], finalBg);
        }

        return finalBg;
    }

    function getEffectiveElementBackground(el) {
        if (!el) return null;
        const bg = getBaseElementBackground(el);
        if (!bg || bg.a === 0) return null;
        const opacity = getEffectiveOpacity(el);
        const bgWithOpacity = { r: bg.r, g: bg.g, b: bg.b, a: bg.a * opacity };
        if (bg.a < 1) {
            const parentBg = getEffectiveBackgroundColor(el.parentElement || document.body);
            if (!parentBg) return bg;
            return blendColors(bgWithOpacity, parentBg);
        }
        if (opacity < 1) {
            const parentBg = getEffectiveBackgroundColor(el.parentElement || document.body);
            return parentBg ? blendColors(bgWithOpacity, parentBg) : bgWithOpacity;
        }
        return bgWithOpacity;
    }

    function getClassNameText(el) {
        if (!el) return '';
        const rawClassName = el.className;
        if (typeof rawClassName === 'string') return rawClassName;
        if (rawClassName && typeof rawClassName.baseVal === 'string') return rawClassName.baseVal;
        return '';
    }

    function isRenderedElement(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
            return false;
        }
        const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
        if (rect && (style.position === 'fixed' || style.position === 'sticky')) {
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
            const isOutsideViewport = rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewportHeight || rect.left >= viewportWidth;
            if (isOutsideViewport) {
                return false;
            }
        }
        const rects = typeof el.getClientRects === 'function' ? el.getClientRects() : null;
        if (rects && rects.length > 0) return true;
        return !!(rect && (rect.width > 0 || rect.height > 0));
    }

    function getVisibleBorderSegments(style) {
        if (!style) return [];
        const sides = [
            { name: 'top', width: style.borderTopWidth, color: style.borderTopColor, borderStyle: style.borderTopStyle },
            { name: 'right', width: style.borderRightWidth, color: style.borderRightColor, borderStyle: style.borderRightStyle },
            { name: 'bottom', width: style.borderBottomWidth, color: style.borderBottomColor, borderStyle: style.borderBottomStyle },
            { name: 'left', width: style.borderLeftWidth, color: style.borderLeftColor, borderStyle: style.borderLeftStyle },
        ];
        return sides
            .map((side) => ({
                ...side,
                widthValue: parseFloat(side.width) || 0,
            }))
            .filter((side) => {
                if (!(side.widthValue > 0) || side.borderStyle === 'none' || side.borderStyle === 'hidden') {
                    return false;
                }
                const parsedColor = parseColor(side.color);
                return !!(parsedColor && parsedColor.a > 0.05);
            });
    }

    function getVisibleBorderSummary(style) {
        const segments = getVisibleBorderSegments(style);
        const maxWidth = segments.reduce((max, side) => Math.max(max, side.widthValue), 0);
        return {
            segments,
            maxWidth,
            hasVisibleBorder: segments.length > 0,
        };
    }

    function getVisibleOutlineSummary(style) {
        if (!style) {
            return {
                segments: [],
                maxWidth: 0,
                hasVisibleOutline: false,
            };
        }
        const outlineWidth = parseFloat(style.outlineWidth) || 0;
        const outlineStyle = style.outlineStyle;
        const outlineColor = style.outlineColor;
        if (!(outlineWidth > 0) || outlineStyle === 'none' || outlineStyle === 'hidden') {
            return {
                segments: [],
                maxWidth: 0,
                hasVisibleOutline: false,
            };
        }
        const parsedColor = parseColor(outlineColor);
        if (!(parsedColor && parsedColor.a > 0.05)) {
            return {
                segments: [],
                maxWidth: 0,
                hasVisibleOutline: false,
            };
        }
        return {
            segments: [{
                name: 'outline',
                widthValue: outlineWidth,
                color: outlineColor,
                outlineStyle,
            }],
            maxWidth: outlineWidth,
            hasVisibleOutline: true,
        };
    }

    function getBestBorderContrastAgainstBackgrounds(style, bgColors) {
        const summary = getVisibleBorderSummary(style);
        const backgrounds = Array.isArray(bgColors) ? bgColors.filter(Boolean) : [];
        if (!summary.hasVisibleBorder || !backgrounds.length) {
            return {
                ...summary,
                bestRatio: 0,
                bestSegment: null,
                bestBackground: null,
            };
        }

        let bestRatio = 0;
        let bestSegment = null;
        let bestBackground = null;
        summary.segments.forEach((segment) => {
            const parsedColor = parseColor(segment.color);
            if (!parsedColor) return;
            backgrounds.forEach((bgColor) => {
                if (!bgColor) return;
                const effectiveBorder = getEffectiveForegroundColor(parsedColor, bgColor);
                const ratio = getContrastRatio(effectiveBorder, bgColor);
                if (ratio > bestRatio) {
                    bestRatio = ratio;
                    bestSegment = segment;
                    bestBackground = bgColor;
                }
            });
        });

        return {
            ...summary,
            bestRatio,
            bestSegment,
            bestBackground,
        };
    }

    function getBestOutlineContrastAgainstBackgrounds(style, bgColors) {
        const summary = getVisibleOutlineSummary(style);
        const backgrounds = Array.isArray(bgColors) ? bgColors.filter(Boolean) : [];
        if (!summary.hasVisibleOutline || !backgrounds.length) {
            return {
                ...summary,
                bestRatio: 0,
                bestSegment: null,
                bestBackground: null,
            };
        }

        let bestRatio = 0;
        let bestSegment = null;
        let bestBackground = null;
        summary.segments.forEach((segment) => {
            const parsedColor = parseColor(segment.color);
            if (!parsedColor) return;
            backgrounds.forEach((bgColor) => {
                if (!bgColor) return;
                const effectiveOutline = getEffectiveForegroundColor(parsedColor, bgColor);
                const ratio = getContrastRatio(effectiveOutline, bgColor);
                if (ratio > bestRatio) {
                    bestRatio = ratio;
                    bestSegment = segment;
                    bestBackground = bgColor;
                }
            });
        });

        return {
            ...summary,
            bestRatio,
            bestSegment,
            bestBackground,
        };
    }

    function getBestBoundaryContrastAgainstBackgrounds(style, bgColors) {
        const borderContrast = getBestBorderContrastAgainstBackgrounds(style, bgColors);
        const outlineContrast = getBestOutlineContrastAgainstBackgrounds(style, bgColors);
        if (outlineContrast.bestRatio > borderContrast.bestRatio) {
            return {
                ...outlineContrast,
                boundaryType: 'outline',
            };
        }
        return {
            ...borderContrast,
            boundaryType: 'border',
        };
    }

    function formatElementLabel(el) {
        if (!el) return '';
        const tag = el.tagName ? el.tagName.toLowerCase() : 'el';
        const id = el.id ? `#${el.id}` : '';
        const className = getClassNameText(el);
        const cls = className ? `.${className.split(' ').join('.').substring(0, 30)}` : '';
        return `${tag}${id}${cls}`;
    }

    function isInteractiveElement(el) {
        if (!el) return false;
        const role = el.getAttribute ? el.getAttribute('role') : null;
        if (el.tagName === 'BUTTON' || el.tagName === 'A' || role === 'button' || el.tagName === 'INPUT' || el.tagName === 'SELECT') {
            return true;
        }
        // Treat option labels as interactive controls for non-text contrast checks.
        if (el.tagName === 'LABEL') {
            const hasFormControl = !!el.querySelector('input, textarea, select');
            const style = window.getComputedStyle(el);
            const cursorInteractive = style.cursor === 'pointer';
            return hasFormControl || cursorInteractive;
        }
        return false;
    }

    function isPassiveContainerElement(el) {
        if (!el || isInteractiveElement(el)) return false;
        const tagName = String(el.tagName || '').toUpperCase();
        if (!['SECTION', 'ARTICLE', 'HEADER', 'ASIDE', 'DIV', 'MAIN'].includes(tagName)) {
            return false;
        }
        const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
        if (!rect) return false;
        return rect.width >= 120 && rect.height >= 40;
    }

    function extractUtilityForStateToken(token, state) {
        if (!token || token.indexOf(':') === -1) return null;
        const parts = token.split(':');
        if (parts.length < 2) return null;
        const utility = parts[parts.length - 1];
        const variants = parts.slice(0, -1);
        const has = (v) => variants.includes(v);

        if (state === 'focus') {
            return has('focus') || has('focus-visible') ? utility : null;
        }
        if (state === 'data-active=true') {
            return has('data-[active=true]') ? utility : null;
        }
        return has(state) ? utility : null;
    }

    function getSimulatedUtilityClasses(className, state) {
        if (!className || typeof className !== 'string') return [];
        const tokens = className.split(/\s+/).filter(Boolean);
        const out = [];
        tokens.forEach(token => {
            const utility = extractUtilityForStateToken(token, state);
            if (utility) out.push(utility);
        });
        return out;
    }

    function runWithSimulatedState(el, state, fn) {
        if (!el || typeof fn !== 'function') return;
        if (typeof el.className !== 'string') {
            fn();
            return;
        }

        const originalClassName = el.className;
        const originalDisabled = ('disabled' in el) ? el.disabled : undefined;
        const originalAriaDisabled = el.getAttribute ? el.getAttribute('aria-disabled') : null;
        const originalDataActive = el.getAttribute ? el.getAttribute('data-active') : null;

        try {
            const extraClasses = getSimulatedUtilityClasses(originalClassName, state);
            if (extraClasses.length > 0) {
                el.className = `${originalClassName} ${extraClasses.join(' ')}`.trim();
            }

            if (state === 'disabled') {
                if ('disabled' in el) el.disabled = true;
                if (el.setAttribute) el.setAttribute('aria-disabled', 'true');
            } else if (state === 'data-active=true') {
                if (el.setAttribute) el.setAttribute('data-active', 'true');
            }

            fn();
        } finally {
            el.className = originalClassName;
            if (originalDisabled !== undefined && 'disabled' in el) {
                el.disabled = originalDisabled;
            }
            if (el.setAttribute) {
                if (originalAriaDisabled === null) el.removeAttribute('aria-disabled');
                else el.setAttribute('aria-disabled', originalAriaDisabled);

                if (originalDataActive === null) el.removeAttribute('data-active');
                else el.setAttribute('data-active', originalDataActive);
            }
        }
    }

    function isSelectedAnswerOptionText(el) {
        if (!el) return false;
        const optionLabel = el.closest ? el.closest('label') : null;
        if (!optionLabel) return false;
        const cls = optionLabel.className || '';
        const hasSelectedClasses = cls.includes('bg-primary-lighter') || cls.includes('border-primary');
        const checkedInput = optionLabel.querySelector && optionLabel.querySelector('input:checked');
        return !!(hasSelectedClasses || checkedInput);
    }

    function auditTextContrastForElement(el, stateLabel = 'default') {
        const style = window.getComputedStyle(el);
        const elementText = el.innerText || '';
        const hasAnyText = elementText.trim().length > 0;
        const isIcon = el.classList.contains('material-symbols-outlined') || el.classList.contains('icon') || el.classList.contains('material-icons');
        const hasTextChildElement = Array.from(el.children || []).some(child =>
            child && ((child.innerText || '').trim().length > 0)
        );

        if (!(hasAnyText && el.children.length < 20 && !isIcon)) return;
        // De-duplicate nested containers: audit only text leaf elements.
        if (hasTextChildElement) return;

        const fgColor = parseColor(style.color);
        const parentBg = getEffectiveBackgroundColor(el.parentElement || document.body);
        const elementBg = getBaseElementBackground(el);
        const usesGradient = hasVisibleGradientInBackgroundChain(el);
        const opacity = getEffectiveOpacity(el);
        const isDisabled = isElementDisabled(el);
        const stateSuffix = stateLabel && stateLabel !== 'default' ? ` [${stateLabel}]` : '';

        if (fgColor && parentBg) {
            const fgWithOpacity = { r: fgColor.r, g: fgColor.g, b: fgColor.b, a: fgColor.a * opacity };
            const elementBgWithOpacity = elementBg
                ? { r: elementBg.r, g: elementBg.g, b: elementBg.b, a: elementBg.a * opacity }
                : null;
            const displayedBg = elementBgWithOpacity
                ? blendColors(elementBgWithOpacity, parentBg)
                : parentBg;
            const displayedFg = blendColors(fgWithOpacity, displayedBg);
            const ratio = getContrastRatio(displayedFg, displayedBg);
            const fontSize = parseFloat(style.fontSize);
            const fontWeight = style.fontWeight;
            const isBold = fontWeight === 'bold' || parseInt(fontWeight) >= 600;

            const isLarge = fontSize >= 18 || (isBold && fontSize >= 14);
            let limit = isLarge ? 3.0 : minTextContrast;
            if (isSelectedAnswerOptionText(el)) {
                limit = Math.max(limit, selectedOptionMinContrast);
            }
            const recommended = limit;
            const tolerance = contrastTolerance;

            if (ratio < (limit - tolerance)) {
                const payload = {
                    el: el,
                    state: stateLabel,
                    text: elementText.split('\n')[0].substring(0, 30),
                    ratio: ratio.toFixed(2),
                    required: `${limit.toFixed(1)} min`,
                    fg: style.color,
                    bg: `rgb(${displayedBg.r},${displayedBg.g},${displayedBg.b})`
                };
                if (usesGradient) {
                    warnings.push({
                        ...payload,
                        type: `Text Contrast (ESTIMATED ON GRADIENT)${stateSuffix}`,
                        required: `${limit.toFixed(1)} min (manual verification recommended)`
                    });
                } else if (isDisabled) {
                    warnings.push({
                        ...payload,
                        type: `Disabled Contrast (LOW)${stateSuffix}`
                    });
                } else {
                    issues.push({
                        ...payload,
                        type: `Text Contrast (LOW)${stateSuffix}`
                    });
                }
            }

            const softLimit = recommended - tolerance;
            const isGoodEnough = ratio > 6.0;
            if (!isGoodEnough && ratio >= (limit - tolerance) && ratio < softLimit) {
                const type = isDisabled ? `Disabled Contrast (WARN)${stateSuffix}` : `Text Contrast (WARN)${stateSuffix}`;
                warnings.push({
                    type,
                    el: el,
                    state: stateLabel,
                    text: elementText.split('\n')[0].substring(0, 30),
                    ratio: ratio.toFixed(2),
                    required: `${recommended.toFixed(1)} recommended`,
                    fg: style.color,
                    bg: `rgb(${displayedBg.r},${displayedBg.g},${displayedBg.b})`
                });
            }

            if (warnExcessiveTextContrast && ratio > 18.0) {
                const type = isDisabled ? `Disabled Contrast (EXCESSIVE)${stateSuffix}` : `Text Contrast (EXCESSIVE)${stateSuffix}`;
                warnings.push({
                    type,
                    el: el,
                    state: stateLabel,
                    text: elementText.split('\n')[0].substring(0, 30),
                    ratio: ratio.toFixed(2),
                    required: '< 18.0',
                    fg: style.color,
                    bg: `rgb(${displayedBg.r},${displayedBg.g},${displayedBg.b})`
                });
            }

            const gradientRiskThreshold = limit + (isLarge ? 1.0 : 1.25);
            if (usesGradient && ratio >= (limit - tolerance) && ratio < gradientRiskThreshold) {
                warnings.push({
                    type: `Gradient Background (Estimated)${stateSuffix}`,
                    el: el,
                    state: stateLabel,
                    text: elementText.split('\n')[0].substring(0, 30),
                    ratio: ratio.toFixed(2),
                    required: 'Background is gradient',
                    fg: style.color,
                    bg: `Estimated rgb(${displayedBg.r},${displayedBg.g},${displayedBg.b})`
                });
            }
        }
    }

    // 2. AUDIT LOGIC
    let issues = [];
    let warnings = [];
    let report = '';
    const elements = document.querySelectorAll('*');

    elements.forEach(el => {
        // Skip invisible unless includeHidden mode is enabled
        if (!includeHidden && !isRenderedElement(el)) return;

        const style = window.getComputedStyle(el);
        if (!includeHidden && (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')) return;
        if (!includeHidden && getEffectiveOpacity(el) < 0.1) return;

        // 1. CHECK TEXT CONTRAST (including simulated states if enabled)
        auditTextContrastForElement(el, 'default');
        if (simulateStates && isInteractiveElement(el)) {
            simulatedStates.forEach(state => {
                runWithSimulatedState(el, state, () => {
                    auditTextContrastForElement(el, `sim:${state}`);
                });
            });
        }

        // 1.5 CHECK UI PANEL CONTRAST (Sidebar, cards, panels vs background)
        // Check if element has significant background and could be a panel/container
        const elBgColor = getEffectiveElementBackground(el);
        if (
            elBgColor &&
            !el.closest('.task-chip') &&
            !isInteractiveElement(el) &&
            !(ignoreModalBackdropPanelWarnings && el.classList && el.classList.contains('modal-backdrop'))
        ) {
            // Get parent background to compare panels
            const parentEl = el.parentElement;
            if (parentEl) {
                const parentBgColor = getEffectiveBackgroundColor(parentEl);

                // If parent has background, check panel contrast
                if (parentBgColor) {
                    const panelRatio = getContrastRatio(elBgColor, parentBgColor);
                    const panelBoundary = getBestBoundaryContrastAgainstBackgrounds(style, [parentBgColor, elBgColor]);
                    const hasVisiblePanelBoundary = !!(panelBoundary.bestSegment && panelBoundary.bestRatio >= 1.5);
                    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
                    const isMicroAccent = !!(rect && rect.width <= 24 && rect.height <= 8);

                    // Panel should have at least 1.5:1 contrast from parent
                    // Lower ratios indicate they blend too much unless a visible contour separates them.
                    if (panelRatio < 1.2 && panelRatio > 1.0 && !hasVisiblePanelBoundary) {
                        warnings.push({
                            type: 'Panel Contrast (TOO LOW)',
                            el: el,
                            text: `${el.className || el.tagName}`,
                            ratio: panelRatio.toFixed(2),
                            required: '1.2+ (visual separation)',
                            fg: `bg: rgb(${elBgColor.r},${elBgColor.g},${elBgColor.b})`,
                            bg: `parent: rgb(${parentBgColor.r},${parentBgColor.g},${parentBgColor.b}) [Boundary: ${panelBoundary.bestSegment ? `${panelBoundary.boundaryType} ${panelBoundary.bestSegment.name} ${panelBoundary.bestRatio.toFixed(2)}` : 'none'}]`
                        });
                    }

                    // Panel contrast too high (> 8:1 may look harsh), but tiny indicators are exempt.
                    if (panelRatio > 8.0 && !isMicroAccent) {
                        warnings.push({
                            type: 'Panel Contrast (TOO HIGH)',
                            el: el,
                            text: `${el.className || el.tagName}`,
                            ratio: panelRatio.toFixed(2),
                            required: '< 8.0 (softer look)',
                            fg: `bg: rgb(${elBgColor.r},${elBgColor.g},${elBgColor.b})`,
                            bg: `parent: rgb(${parentBgColor.r},${parentBgColor.g},${parentBgColor.b})`
                        });
                    }
                }
            }
        }

        // 2. CHECK BADGE/BUTTON BORDERS (UI Components 3:1)
        // Heuristic: if element has a border width > 0
        const inputType = el.tagName === 'INPUT'
            ? String(el.getAttribute('type') || '').toLowerCase()
            : '';
        const isNativeToggle = inputType === 'radio' || inputType === 'checkbox';
        const boundarySummary = getBestBoundaryContrastAgainstBackgrounds(style, [
            getEffectiveBackgroundColor(el.parentElement || document.body),
            getEffectiveElementBackground(el)
        ]);
        if (
            boundarySummary.bestSegment &&
            !isPassiveContainerElement(el) &&
            !(ignoreNativeToggleBorderWarnings && isNativeToggle)
        ) {
            const bgColor = getEffectiveBackgroundColor(el.parentElement || document.body); // Border contrasts against adjacent surfaces
            if (bgColor) {
                if (boundarySummary.bestRatio < 3.0) {
                    warnings.push({
                        type: 'UI Border Contrast',
                        el: el,
                        text: `${boundarySummary.boundaryType === 'outline' ? 'Outline' : 'Border'} (${boundarySummary.bestSegment.name})`,
                        ratio: boundarySummary.bestRatio.toFixed(2),
                        required: 3.0,
                        fg: boundarySummary.bestSegment.color,
                        bg: boundarySummary.bestBackground
                            ? `rgb(${boundarySummary.bestBackground.r},${boundarySummary.bestBackground.g},${boundarySummary.bestBackground.b})`
                            : `rgb(${bgColor.r},${bgColor.g},${bgColor.b})`
                    });
                }
            }
        }

        // 3. CHECK GRAPHICAL OBJECTS (Heatmaps, Indicators, Icons without text)
        // WCAG 1.4.11: Non-text Contrast -> requires 3:1
        // Heuristic: No text content, but has title/aria-label and background color
        const hasText = ((el.innerText || '').trim().length > 0);

        // Element must have no visible text, AND have a label (indicating meaning), AND visible dimensions
        if (
            !hasText &&
            (el.hasAttribute('title') || el.hasAttribute('aria-label')) &&
            !(el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')
        ) {
            // Check dimensions
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {

                const elBg = getEffectiveElementBackground(el);

                // Must have a visible, non-transparent background to be a graphical object relying on color
                if (elBg) {
                    // Compare Element BG (as FG) against Parent BG
                    const parentBg = getEffectiveBackgroundColor(el.parentElement || document.body);

                    if (parentBg) {
                        const ratio = getContrastRatio(elBg, parentBg);
                        if (ratio < 3.0) {
                            issues.push({
                                type: 'UI Object Contrast',
                                el: el,
                                text: el.getAttribute('title') || el.getAttribute('aria-label') || 'Graphic',
                                ratio: ratio.toFixed(2),
                                required: 3.0,
                                fg: style.backgroundColor,
                                bg: `rgb(${parentBg.r},${parentBg.g},${parentBg.b})`
                            });
                        }
                    }
                }
            }

        }

        // 4. CHECK UI COMPONENT BOUNDARIES (WCAG 1.4.11 - Non-text Contrast)
        // Interactive elements must have 3:1 contrast against adjacent colors (parent bg)
        // unless they have a contrasting border.
        const isInteractive = isInteractiveElement(el);

        if (isInteractive) {
            const elBg = getEffectiveElementBackground(el);
            if (elBg) {
                const parentBg = getEffectiveBackgroundColor(el.parentElement || document.body);
                if (parentBg) {
                    const ratio = getContrastRatio(elBg, parentBg);

                    // WCAG 1.4.11 requires 3:1 for user interface components
                    // If the background itself is the boundary (no border), it must be 3:1
                    if (ratio < 3.0) {
                        let hasSufficientBoundary = false;
                        let boundaryDebug = "None";

                        const boundaryContrast = getBestBoundaryContrastAgainstBackgrounds(style, [parentBg, elBg]);
                        if (boundaryContrast.bestSegment) {
                            if (boundaryContrast.bestRatio >= 3.0) {
                                hasSufficientBoundary = true;
                            } else {
                                boundaryDebug = `${boundaryContrast.boundaryType} ${boundaryContrast.bestSegment.name} ${boundaryContrast.bestSegment.widthValue}px fail ${boundaryContrast.bestRatio.toFixed(2)}`;
                            }
                        }

                        // Shadows *can* provide contrast, but often they are too subtle. 
                        // For this strict audit, we warn if only shadow is present or if contrast is very low.
                        // We will Fail if < 3.0 and no sufficient border.

                        // NOTE: We rely on the "Background" being the indicator. 
                        // If contrast is < 3.0 and no border, it fails WCAG 1.4.11.

                        if (!hasSufficientBoundary) {
                            warnings.push({
                                type: 'UI Component Boundary',
                                el: el,
                                text: (el.innerText || '').substring(0, 20) || 'Control',
                                ratio: ratio.toFixed(2),
                                required: 3.0,
                                fg: `BG: ${style.backgroundColor}`,
                                bg: `Parent: rgb(${parentBg.r},${parentBg.g},${parentBg.b}) [Boundary: ${boundaryDebug}]`
                            });
                        }
                    }
                }
            } else if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
                // Transparent button with no border can visually disappear into parent.
                const transparentButtonBorder = getVisibleBorderSummary(style);
                const hasVisibleBorder = transparentButtonBorder.hasVisibleBorder;
                const bgRaw = parseColor(style.backgroundColor);
                const hasVisibleBg = !!(bgRaw && bgRaw.a > 0);
                const controlLabel = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
                if (!hasVisibleBorder && !hasVisibleBg && controlLabel.length === 0) {
                    warnings.push({
                        type: 'UI Component Boundary (MISSING)',
                        el: el,
                        text: (el.innerText || '').substring(0, 20) || 'Control',
                        ratio: 'N/A',
                        required: 'Visible bg or border',
                        fg: `BG: ${style.backgroundColor}`,
                        bg: `Border segments: ${transparentButtonBorder.segments.map((segment) => `${segment.name}:${segment.widthValue}px ${segment.color}`).join(', ') || 'none'}`
                    });
                }
            }
        }

        // 4.5 CHECK INPUT/TEXTAREA VALUE & PLACEHOLDER CONTRAST
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            if (el.tagName === 'INPUT') {
                const inputType = String(el.getAttribute('type') || 'text').toLowerCase();
                const textLikeInputTypes = new Set([
                    'text',
                    'search',
                    'email',
                    'password',
                    'url',
                    'tel',
                    'number',
                    'date',
                    'datetime-local',
                    'time',
                    'month',
                    'week',
                ]);
                if (!textLikeInputTypes.has(inputType)) return;
            }
            const fieldBg = getEffectiveElementBackground(el) || getEffectiveBackgroundColor(el);
            if (fieldBg) {
                const valueText = (el.value || '').trim();
                if (valueText.length > 0) {
                    const valueColor = parseColor(style.color);
                    if (valueColor) {
                        const effectiveValue = getEffectiveForegroundColor(valueColor, fieldBg);
                        const ratio = getContrastRatio(effectiveValue, fieldBg);
                        if (ratio < 4.5) {
                            issues.push({
                                type: 'Input Text Contrast (LOW)',
                                el: el,
                                text: valueText.substring(0, 30),
                                ratio: ratio.toFixed(2),
                                required: '4.5 min',
                                fg: style.color,
                                bg: `rgb(${fieldBg.r},${fieldBg.g},${fieldBg.b})`
                            });
                        }
                    }
                }

                const placeholder = (el.getAttribute('placeholder') || '').trim();
                if (placeholder.length > 0) {
                    const phStyle = window.getComputedStyle(el, '::placeholder');
                    const phColor = parseColor(phStyle.color);
                    if (phColor) {
                        const effectivePh = getEffectiveForegroundColor(phColor, fieldBg);
                        const ratio = getContrastRatio(effectivePh, fieldBg);
                        if (ratio < 4.5) {
                            issues.push({
                                type: 'Placeholder Contrast (LOW)',
                                el: el,
                                text: placeholder.substring(0, 30),
                                ratio: ratio.toFixed(2),
                                required: '4.5 min',
                                fg: phStyle.color,
                                bg: `rgb(${fieldBg.r},${fieldBg.g},${fieldBg.b})`
                            });
                        }
                    }
                }
            }
        }

        // 5. CHECK EXCESSIVE CONTRAST (UI Guide Rule 7.1 & Eye Strain)
        // Avoid Pure Black (#000000) 
        const checkElBg = parseColor(style.backgroundColor);
        if (checkElBg && checkElBg.a === 1) {
            // Check for Pure Black Background
            if (checkElBg.r === 0 && checkElBg.g === 0 && checkElBg.b === 0) {
                issues.push({
                    type: 'Excessive Contrast (Rule 7.1)',
                    el: el,
                    text: 'Pure Black Background',
                    ratio: 'N/A',
                    required: 'Use #1A1A1A',
                    fg: 'N/A',
                    bg: '#000000'
                });
            }
        }
    });

    // 3. REPORTING
    if (issues.length === 0) {
        if (!silent) {
            console.log("%c PASS ✓", "background: #008000; color: #fff; padding: 2px 5px;", "All scanned elements meet WCAG requirements and guideline thresholds.");
        }
        report = `\n# Contrast Audit Report - ${new Date().toLocaleString()}\n\n**Total Issues Found: 0**\n\n`;
        if (warnings.length > 0) {
            report += `**Warnings Found: ${warnings.length}**\n\n`;
            const warnByType = {};
            warnings.forEach(i => {
                if (!warnByType[i.type]) warnByType[i.type] = [];
                warnByType[i.type].push(i);
            });
            Object.entries(warnByType).forEach(([type, typeIssues]) => {
                report += `## ${type} (${typeIssues.length} warnings)\n\n`;
                report += `| Ratio | Required | Element | Text |\n|---|---|---|---|\n`;
                typeIssues.forEach(i => {
                    const elStr = formatElementLabel(i.el);
                    const cleanText = (i.text || '').replace(/\n/g, ' ').substring(0, 50);
                    report += `| **${i.ratio}** | ${i.required} | \`${elStr}\` | "${cleanText}" |\n`;
                });
                report += `\n`;
            });
        }
    } else {
        if (!silent) {
            console.log(`%c FOUND ISSUES `, "background: #ff6b35; color: #fff; padding: 2px 5px;", `Detected ${issues.length} contrast problems:`);
            if (warnings.length > 0) {
                console.log(`%c WARNINGS `, "background: #f0ad4e; color: #1a1a1a; padding: 2px 5px;", `Detected ${warnings.length} warnings:`);
            }
        }

        // Group by type
        const byType = {};
        issues.forEach(i => {
            if (!byType[i.type]) byType[i.type] = [];
            byType[i.type].push(i);
        });

        if (!silent) {
            Object.entries(byType).forEach(([type, typeIssues]) => {
                console.group(`📊 ${type} (${typeIssues.length})`);
                console.table(typeIssues.map(i => ({
                    'Ratio': i.ratio,
                    'Required': i.required,
                    'Element': formatElementLabel(i.el),
                    'Description': (i.text || '').substring(0, 30)
                })));
                console.groupEnd();
            });
        }

        if (warnings.length > 0 && !silent) {
            const warnByType = {};
            warnings.forEach(i => {
                if (!warnByType[i.type]) warnByType[i.type] = [];
                warnByType[i.type].push(i);
            });
            Object.entries(warnByType).forEach(([type, typeIssues]) => {
                console.group(`⚠️ ${type} (${typeIssues.length})`);
                console.table(typeIssues.map(i => ({
                    'Ratio': i.ratio,
                    'Required': i.required,
                    'Element': formatElementLabel(i.el),
                    'Description': (i.text || '').substring(0, 30)
                })));
                console.groupEnd();
            });
        }

        // Generate MARKDOWN Report for AI
        report = `\n# Contrast Audit Report - ${new Date().toLocaleString()}\n\n**Total Issues Found: ${issues.length}**\n\n`;
        if (warnings.length > 0) {
            report += `**Warnings Found: ${warnings.length}**\n\n`;
        }

        Object.entries(byType).forEach(([type, typeIssues]) => {
            report += `## ${type} (${typeIssues.length} issues)\n\n`;
            report += `| Ratio | Required | Element | Text |\n|---|---|---|---|\n`;
            typeIssues.forEach(i => {
                const elStr = formatElementLabel(i.el);
                const cleanText = (i.text || '').replace(/\n/g, ' ').substring(0, 50);
                report += `| **${i.ratio}** | ${i.required} | \`${elStr}\` | "${cleanText}" |\n`;
            });
            report += `\n`;
        });

        if (warnings.length > 0) {
            const warnByType = {};
            warnings.forEach(i => {
                if (!warnByType[i.type]) warnByType[i.type] = [];
                warnByType[i.type].push(i);
            });
            Object.entries(warnByType).forEach(([type, typeIssues]) => {
                report += `## ${type} (${typeIssues.length} warnings)\n\n`;
                report += `| Ratio | Required | Element | Text |\n|---|---|---|---|\n`;
                typeIssues.forEach(i => {
                    const elStr = formatElementLabel(i.el);
                    const cleanText = (i.text || '').replace(/\n/g, ' ').substring(0, 50);
                    report += `| **${i.ratio}** | ${i.required} | \`${elStr}\` | "${cleanText}" |\n`;
                });
                report += `\n`;
            });
        }

        if (!silent) {
            console.log("%c COPY THIS MARKDOWN FOR AI: ", "font-weight: bold; color: #00f; font-size: 14px;");
            console.log(report);
        }

        // Highlight logic
        if (!silent) {
            console.log("To highlight failing elements, run: highlightFailures()");
            window.highlightFailures = () => {
                issues.forEach(issue => {
                    issue.el.style.outline = "2px solid red";
                    issue.el.style.boxShadow = "0 0 10px red";
                    issue.el.title = `Contrast Fail: ${issue.ratio}:1 (Req: ${issue.required})`;
                });
            };
        }
    }

        const issuesLite = issues.map(i => ({
        type: i.type,
        state: i.state || 'default',
        ratio: i.ratio,
        required: i.required,
        text: i.text,
        fg: i.fg,
        bg: i.bg,
        element: formatElementLabel(i.el),
    }));
    const warningsLite = warnings.map(i => ({
        type: i.type,
        state: i.state || 'default',
        ratio: i.ratio,
        required: i.required,
        text: i.text,
        fg: i.fg,
        bg: i.bg,
        element: formatElementLabel(i.el),
    }));

    const result = {
        issues: issuesLite,
        warnings: warningsLite,
        report,
        timestamp: new Date().toISOString(),
    };
    window.__contrastAuditLast = result;
    return result;
}

window.runContrastAudit = runContrastAudit;
runContrastAudit();
})();
