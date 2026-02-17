(function (globalScope, factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        module.exports = factory();
    } else {
        const globalTarget = typeof globalThis !== "undefined" ? globalThis : globalScope;
        globalTarget.ClickEditorHelpers = factory();
    }
})(this, function factory() {
    let measureCanvas = null;
    let measureCtx = null;

    function getMeasureContext() {
        if (measureCtx) return measureCtx;

        if (typeof document !== "undefined" && typeof document.createElement === "function") {
            measureCanvas = document.createElement("canvas");
            measureCanvas.width = 512;
            measureCanvas.height = 128;
        } else if (typeof OffscreenCanvas !== "undefined") {
            measureCanvas = new OffscreenCanvas(512, 128);
        }

        if (measureCanvas && typeof measureCanvas.getContext === "function") {
            measureCtx = measureCanvas.getContext("2d");
        }

        return measureCtx;
    }

    function measureTextWidth(text, fontSize) {
        const ctx = getMeasureContext();
        if (!ctx) {
            return text.length * fontSize * 0.6;
        }
        ctx.font = `600 ${fontSize}px "Inter","Segoe UI",system-ui,sans-serif`;
        const metrics = ctx.measureText(text);
        return (metrics && metrics.width) || text.length * fontSize * 0.6;
    }

    function breakWord(word, fontSize, maxLineWidth) {
        if (!word) return [];
        const chunks = [];
        let buffer = "";
        for (const char of word.split("")) {
            const next = buffer + char;
            if (measureTextWidth(next, fontSize) <= maxLineWidth || buffer.length === 0) {
                buffer = next;
            } else {
                chunks.push(buffer);
                buffer = char;
            }
        }
        if (buffer) {
            chunks.push(buffer);
        }
        return chunks;
    }

    function buildLabelLayout(text, options = {}) {
        const {
            fontSize = 14,
            maxWidth = 220,
            paddingScale = 1
        } = options;
        const normalizedPaddingScale = Math.max(0.65, Math.min(1.2, paddingScale));
        const paddingX = 14 * normalizedPaddingScale;
        const paddingY = 10 * normalizedPaddingScale;
        const lineHeight = Math.round(fontSize * 1.3);
        const sanitized = (text ?? "").toString().trim() || "Без названия";
        const paragraphs = sanitized.replace(/\r/g, "").split(/\n+/);
        const lines = [];
        let widest = 0;
        let workingLine = "";
        const maxLineWidth = Math.max(60, maxWidth - paddingX * 2);

        const pushLine = (line) => {
            const content = line.trim();
            const width = content ? measureTextWidth(content, fontSize) : 0;
            widest = Math.max(widest, width);
            lines.push(content);
        };

        const flushLine = () => {
            if (workingLine) {
                pushLine(workingLine);
                workingLine = "";
            }
        };

        paragraphs.forEach((paragraph, index) => {
            const words = paragraph.split(/\s+/).filter(Boolean);
            if (!words.length) {
                flushLine();
                lines.push("");
                return;
            }

            words.forEach((word) => {
                const candidate = workingLine ? `${workingLine} ${word}` : word;
                if (measureTextWidth(candidate, fontSize) <= maxLineWidth) {
                    workingLine = candidate;
                    return;
                }

                flushLine();
                if (measureTextWidth(word, fontSize) <= maxLineWidth) {
                    workingLine = word;
                    return;
                }

                const segments = breakWord(word, fontSize, maxLineWidth);
                segments.forEach((segment) => {
                    if (!segment) return;
                    if (measureTextWidth(segment, fontSize) > maxLineWidth && segment.length > 1) {
                        breakWord(segment, fontSize, maxLineWidth).forEach((nested) => {
                            if (nested) {
                                pushLine(nested);
                            }
                        });
                        workingLine = "";
                    } else {
                        pushLine(segment);
                    }
                });
                workingLine = "";
            });

            flushLine();
            if (index < paragraphs.length - 1) {
                lines.push("");
            }
        });

        if (!lines.length) {
            lines.push(sanitized);
            widest = measureTextWidth(sanitized, fontSize);
        }

        const width = Math.min(maxWidth, Math.max(paddingX * 2 + widest, paddingX * 2 + fontSize * 2, 90));
        const height = Math.max(lineHeight + paddingY * 2, lines.length * lineHeight + paddingY * 2);

        return {
            fontSize,
            lineHeight,
            width: Math.round(width),
            height: Math.round(height),
            lines,
            paddingX,
            paddingY,
            paddingScale: normalizedPaddingScale
        };
    }

    function computeLabelLayout(text, options = {}) {
        const {
            maxWidth = 240,
            maxLines = 6,
            baseFontSize = 14,
            minFontSize = 11,
            maxFontSize = 16
        } = options;
        let fontSize = Math.max(minFontSize, Math.min(maxFontSize, baseFontSize));
        let layout = null;

        const paddingScale = Math.max(0.65, Math.min(1.2, options.paddingScale ?? 1));

        while (fontSize >= minFontSize) {
            layout = buildLabelLayout(text, { fontSize, maxWidth, paddingScale });
            if (layout.lines.length <= maxLines && layout.width <= maxWidth) {
                break;
            }
            fontSize -= 1;
        }

        if (!layout) {
            layout = buildLabelLayout(text, { fontSize: minFontSize, maxWidth, paddingScale });
        }

        return layout;
    }

    function clampRequiredCorrectValue(rawValue, annotationsCount, options = {}) {
        const { clampToMax = true } = options;
        const minAllowed = annotationsCount === 0 ? 0 : 1;
        const maxAllowed = annotationsCount;
        let value = parseInt(rawValue, 10);
        let adjusted = false;
        if (!Number.isFinite(value)) {
            value = minAllowed;
            adjusted = true;
        }

        if (value < minAllowed) {
            value = minAllowed;
            adjusted = true;
        }

        if (clampToMax) {
            if (annotationsCount === 0) {
                if (value !== 0) {
                    value = 0;
                    adjusted = true;
                }
            } else if (value > maxAllowed) {
                value = maxAllowed;
                adjusted = true;
            }
        }

        return {
            value,
            min: minAllowed,
            max: Math.max(maxAllowed, minAllowed || 1),
            adjusted
        };
    }

    function normalizeZoom(value) {
        return Math.max(0.25, Math.min(4, Number(value) || 1));
    }

    function getBaseLabelFontSize(zoomLevel = 1, options = {}) {
        const baseFontSize = options.baseFontSize ?? 12;
        const minFontSize = options.minFontSize ?? 8;
        const maxFontSize = options.maxFontSize ?? 16;
        const normalizedZoom = normalizeZoom(zoomLevel);
        const zoomFactor =
            normalizedZoom >= 1
                ? 1 / Math.pow(normalizedZoom, 0.85)
                : Math.pow(normalizedZoom, 0.85);
        const sized = baseFontSize * zoomFactor;
        return Math.round(Math.max(minFontSize, Math.min(maxFontSize, sized)));
    }

    function getLabelScaleFactor(zoomLevel = 1) {
        const normalizedZoom = normalizeZoom(zoomLevel);
        const scale =
            normalizedZoom >= 1
                ? 1 / Math.pow(normalizedZoom, 0.6)
                : Math.pow(normalizedZoom, 0.6);
        return Number(Math.max(0.6, Math.min(1.3, scale)));
    }

    function getLabelMaxWidth(canvasWidth = 0, options = {}) {
        const hardMax = options.hardMax ?? 240;
        const hardMin = options.hardMin ?? 110;
        const normalizedZoom = normalizeZoom(options.zoomLevel ?? 1);
        const baseWidth = Math.max(canvasWidth || 0, hardMin + 32) * 0.35;
        const zoomFactor =
            normalizedZoom >= 1
                ? 1 / Math.pow(normalizedZoom, 0.5)
                : Math.pow(normalizedZoom, 0.5);
        const computed = baseWidth * zoomFactor;
        return Math.max(hardMin, Math.min(hardMax, Math.round(computed)));
    }

    function shouldRenderLabelWithContext(context = {}) {
        const {
            mode = "smart",
            forceVisible = false,
            zoomLevel = 1,
            bounds = null,
            thresholds = {},
            annotationType = "polygon"
        } = context;

        if (mode === "off") {
            return false;
        }

        if (mode === "all" || forceVisible) {
            return true;
        }

        const minZoom = thresholds.minZoom ?? 0.65;
        const minSize = thresholds.minSize ?? 22;
        const skipSmallTypes = thresholds.skipSmallPointLabels ?? false;
        const normalizedZoom = Math.max(0.1, Number(zoomLevel) || 1);

        if (normalizedZoom < minZoom) {
            return false;
        }

        if (bounds) {
            if (bounds.width < minSize && bounds.height < minSize) {
                if (!(annotationType === "point" && !skipSmallTypes)) {
                    return false;
                }
            }
        }

        return true;
    }

    return {
        computeLabelLayout,
        clampRequiredCorrectValue,
        getBaseLabelFontSize,
        getLabelScaleFactor,
        getLabelMaxWidth,
        shouldRenderLabelWithContext
    };
});
