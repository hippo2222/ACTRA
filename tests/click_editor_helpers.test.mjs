import { describe, it, expect } from "vitest";
import helpers from "../frontend/Editor/click_editor_helpers.js";

const {
    computeLabelLayout,
    clampRequiredCorrectValue,
    getBaseLabelFontSize,
    getLabelScaleFactor,
    getLabelMaxWidth,
    shouldRenderLabelWithContext
} = helpers;

describe("computeLabelLayout", () => {
    it("wraps extremely long words without overflowing max width", () => {
        const text = "кардиодиафрагмальныйкупол".repeat(4);
        const layout = computeLabelLayout(text, { maxWidth: 180, maxLines: 10 });
        expect(layout.lines.length).toBeGreaterThan(1);
        expect(layout.width).toBeLessThanOrEqual(180);
        layout.lines.forEach((line) => {
            expect(line.length).toBeGreaterThan(0);
        });
    });

    it("preserves blank lines and trims whitespace", () => {
        const text = "Первая строка\n\n   Вторая   часть";
        const layout = computeLabelLayout(text, { maxWidth: 220 });
        expect(layout.lines).toContain("Первая строка");
        expect(layout.lines).toContain("Вторая часть");
        const blankLineCount = layout.lines.filter((line) => line === "").length;
        expect(blankLineCount).toBeGreaterThan(0);
    });

    it("shrinks font size when текст почти не помещается по высоте", () => {
        const text = Array.from({ length: 18 }, (_, idx) => `Сегмент${idx}`).join(" ");
        const layout = computeLabelLayout(text, {
            maxWidth: 150,
            maxLines: 3,
            baseFontSize: 16,
            maxFontSize: 18,
            minFontSize: 10
        });
        expect(layout.fontSize).toBeLessThan(16);
        expect(layout.lines.length).toBeGreaterThanOrEqual(3);
    });

    it("handles multi-paragraph hints with varying whitespace", () => {
        const text =
            "Шаг 1: Найдите область.\n\nШаг 2:\n - Укажите границы\n - Проверьте соседние структуры\n\n\nПримечание: ориентируйтесь на сосуды.";
        const layout = computeLabelLayout(text, { maxWidth: 260, maxLines: 8 });
        const contains = (needle) => layout.lines.some((line) => line === needle);
        expect(contains("Шаг 1: Найдите область.")).toBe(true);
        expect(contains("Шаг 2:")).toBe(true);
        expect(layout.lines.filter((line) => line === "").length).toBeGreaterThanOrEqual(2);
        expect(layout.lines.some((line) => line.includes("Укажите границы"))).toBe(true);
        expect(layout.lines.some((line) => line.includes("Проверьте соседние структуры"))).toBe(true);
        expect(layout.lines.some((line) => line.includes("Примечание"))).toBe(true);
    });
});

describe("clampRequiredCorrectValue", () => {
    it("allows zero when нет контуров", () => {
        const result = clampRequiredCorrectValue("5", 0, { clampToMax: true });
        expect(result.value).toBe(0);
        expect(result.min).toBe(0);
        expect(result.max).toBe(1);
        expect(result.adjusted).toBe(true);
    });

    it("clamps значение к количеству контуров", () => {
        const result = clampRequiredCorrectValue("10", 3, { clampToMax: true });
        expect(result.value).toBe(3);
        expect(result.min).toBe(1);
        expect(result.max).toBe(3);
        expect(result.adjusted).toBe(true);
    });

    it("normalizes нечисловые значения", () => {
        const result = clampRequiredCorrectValue("not-a-number", 2, { clampToMax: true });
        expect(result.value).toBe(1);
        expect(result.adjusted).toBe(true);
    });
});

describe("getBaseLabelFontSize", () => {
    it("scales down when zoomed in tightly", () => {
        const size = getBaseLabelFontSize(2.5, { baseFontSize: 16 });
        expect(size).toBeLessThan(16);
        expect(size).toBeGreaterThanOrEqual(8);
    });

    it("never goes below configured minimum even when zoomed far out", () => {
        const size = getBaseLabelFontSize(0.4, { baseFontSize: 13, minFontSize: 8 });
        expect(size).toBeGreaterThanOrEqual(8);
        expect(size).toBeLessThanOrEqual(13);
    });
});

describe("getLabelScaleFactor", () => {
    it("returns value within clamp range", () => {
        const values = [getLabelScaleFactor(0.25), getLabelScaleFactor(1), getLabelScaleFactor(3)];
        values.forEach((val) => {
            expect(val).toBeGreaterThanOrEqual(0.6);
            expect(val).toBeLessThanOrEqual(1.3);
        });
    });
});

describe("getLabelMaxWidth", () => {
    it("never exceeds hard max and respects canvas width", () => {
        const narrow = getLabelMaxWidth(160, { hardMax: 260, hardMin: 120 });
        const wide = getLabelMaxWidth(1200, { hardMax: 260, hardMin: 120 });
        expect(narrow).toBeGreaterThanOrEqual(120);
        expect(wide).toBe(260);
    });
});

describe("shouldRenderLabelWithContext", () => {
    it("forces visibility when mode is 'all' or forced", () => {
        expect(shouldRenderLabelWithContext({ mode: "all" })).toBe(true);
        expect(shouldRenderLabelWithContext({ mode: "smart", forceVisible: true })).toBe(true);
    });

    it("hides labels when zoom is below threshold", () => {
        const result = shouldRenderLabelWithContext({
            mode: "smart",
            zoomLevel: 0.4,
            thresholds: { minZoom: 0.7 }
        });
        expect(result).toBe(false);
    });

    it("hides tiny shapes unless they are points and skipping is disabled", () => {
        const hidden = shouldRenderLabelWithContext({
            mode: "smart",
            zoomLevel: 1,
            bounds: { width: 10, height: 9 },
            thresholds: { minSize: 20, skipSmallPointLabels: true }
        });
        expect(hidden).toBe(false);

        const pointVisible = shouldRenderLabelWithContext({
            mode: "smart",
            zoomLevel: 1,
            bounds: { width: 10, height: 9 },
            annotationType: "point",
            thresholds: { minSize: 20, skipSmallPointLabels: false }
        });
        expect(pointVisible).toBe(true);
    });
});
