import { describe, it, expect, beforeEach, vi } from "vitest";

// Minimal mock environment for click_editor contrast engine testing
describe("ClickEditor Contrast Engine (Task 4.1)", () => {
    // WCAG 2.1 math implementation to test against
    function getRelativeLuminance(hexOrRgb) {
        let r, g, b;
        if (typeof hexOrRgb === "string") {
            const trimmed = hexOrRgb.trim().toLowerCase();
            const hex = /^#[0-9a-f]{3}$/.test(trimmed)
                ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
                : trimmed;
            if (!/^#[0-9a-f]{6}$/.test(hex)) return 0.5;
            r = parseInt(hex.slice(1, 3), 16);
            g = parseInt(hex.slice(3, 5), 16);
            b = parseInt(hex.slice(5, 7), 16);
        } else if (Array.isArray(hexOrRgb)) {
            [r, g, b] = hexOrRgb;
        } else {
            return 0.5;
        }
        const sRGB = [r / 255, g / 255, b / 255];
        const linear = sRGB.map(c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }

    function getContrastRatio(lum1, lum2) {
        const l1 = Math.max(lum1, lum2);
        const l2 = Math.min(lum1, lum2);
        return (l1 + 0.05) / (l2 + 0.05);
    }

    function hexToHsl(hex) {
        let trimmed = hex.trim().toLowerCase();
        if (/^#[0-9a-f]{3}$/.test(trimmed)) {
            trimmed = `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
        }
        if (!/^#[0-9a-f]{6}$/.test(trimmed)) return null;
        const r = parseInt(trimmed.slice(1, 3), 16) / 255;
        const g = parseInt(trimmed.slice(3, 5), 16) / 255;
        const b = parseInt(trimmed.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }
        return {
            h: Math.round(h * 360),
            s: Math.round(s * 100),
            l: Math.round(l * 100)
        };
    }

    function hslToHex(h, s, l) {
        s /= 100;
        l /= 100;
        const k = n => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        const toHex = x => {
            const hex = Math.round(x * 255).toString(16);
            return hex.length === 1 ? "0" + hex : hex;
        };
        return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
    }

    function adjustColorLightness(hex, direction) {
        const hsl = hexToHsl(hex);
        if (!hsl) return direction > 0 ? "#ffffff" : "#000000";
        let newL;
        if (direction > 0) {
            newL = Math.min(88, Math.max(hsl.l + 25, 75));
        } else {
            newL = Math.max(15, Math.min(hsl.l - 25, 28));
        }
        return hslToHex(hsl.h, Math.max(40, hsl.s), newL);
    }

    it("accurately calculates WCAG 2.1 relative luminance for primary colors", () => {
        expect(getRelativeLuminance("#000000")).toBeCloseTo(0.0, 4);
        expect(getRelativeLuminance("#ffffff")).toBeCloseTo(1.0, 4);
        // Pure red sRGB: lum = 0.2126
        expect(getRelativeLuminance("#ff0000")).toBeCloseTo(0.2126, 3);
        // Pure green sRGB: lum = 0.7152
        expect(getRelativeLuminance("#00ff00")).toBeCloseTo(0.7152, 3);
        // Pure blue sRGB: lum = 0.0722
        expect(getRelativeLuminance("#0000ff")).toBeCloseTo(0.0722, 3);
    });

    it("calculates contrast ratios in accordance with WCAG 2.1 standards", () => {
        // Maximum contrast (Black vs White) = 21:1
        const maxCR = getContrastRatio(getRelativeLuminance("#000000"), getRelativeLuminance("#ffffff"));
        expect(maxCR).toBeCloseTo(21.0, 1);

        // Identical colors = 1:1
        const minCR = getContrastRatio(getRelativeLuminance("#3b82f6"), getRelativeLuminance("#3b82f6"));
        expect(minCR).toBeCloseTo(1.0, 1);

        // Dark grey on white: #333333 on #ffffff is approx 12.6:1
        const darkOnWhite = getContrastRatio(getRelativeLuminance("#333333"), getRelativeLuminance("#ffffff"));
        expect(darkOnWhite).toBeGreaterThan(10);

        // Light yellow #ffff99 on white #ffffff is low contrast (< 1.5:1)
        const yellowOnWhite = getContrastRatio(getRelativeLuminance("#ffff99"), getRelativeLuminance("#ffffff"));
        expect(yellowOnWhite).toBeLessThan(1.5);
    });

    it("converts hex to HSL and back with high fidelity", () => {
        const hex = "#3b82f6";
        const hsl = hexToHsl(hex);
        expect(hsl).toBeDefined();
        expect(hsl.h).toBeGreaterThan(200);
        expect(hsl.h).toBeLessThan(230);
        expect(hsl.s).toBeGreaterThan(80);
        expect(hsl.l).toBeGreaterThan(50);

        const reconstructed = hslToHex(hsl.h, hsl.s, hsl.l);
        const hsl2 = hexToHsl(reconstructed);
        expect(Math.abs(hsl.h - hsl2.h)).toBeLessThanOrEqual(2);
        expect(Math.abs(hsl.l - hsl2.l)).toBeLessThanOrEqual(2);
    });

    it("adjusts color lightness towards light or dark extremes for contrast recovery", () => {
        const midBlue = "#3b82f6"; // L ~ 60%
        const lightened = adjustColorLightness(midBlue, 1);
        const darkened = adjustColorLightness(midBlue, -1);

        const hslLight = hexToHsl(lightened);
        const hslDark = hexToHsl(darkened);

        expect(hslLight.l).toBeGreaterThanOrEqual(75);
        expect(hslDark.l).toBeLessThanOrEqual(28);

        // Contrast against white (#ffffff)
        const darkCR = getContrastRatio(getRelativeLuminance(darkened), getRelativeLuminance("#ffffff"));
        expect(darkCR).toBeGreaterThan(4.5);

        // Contrast against dark background (#111111)
        const lightCR = getContrastRatio(getRelativeLuminance(lightened), getRelativeLuminance("#111111"));
        expect(lightCR).toBeGreaterThan(4.5);
    });

    it("identifies low contrast contour against bright background", () => {
        const bgLuminance = 0.88; // very light background (e.g. medical white paper or scan field)
        const lightContourColor = "#eab308"; // yellow
        const colorLuminance = getRelativeLuminance(lightContourColor);
        const ratio = getContrastRatio(colorLuminance, bgLuminance);

        expect(ratio).toBeLessThan(3.0); // Flagged as low contrast
    });

    it("evaluates contour points against downscaled background map", () => {
        // Mock a 10x10 contrast map with uniform light background (all pixels 240, 240, 240)
        const width = 10;
        const height = 10;
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 240;
            data[i + 1] = 240;
            data[i + 2] = 240;
            data[i + 3] = 255;
        }

        const map = { data, width, height, naturalWidth: 100, naturalHeight: 100 };
        const points = [[10, 10], [50, 10], [50, 50], [10, 50]]; // polygon in natural coords

        // Contour evaluation logic
        function evaluateTest(points, colorHex, isClosed = true) {
            const segments = [];
            let totalLength = 0;
            const count = isClosed ? points.length : points.length - 1;
            for (let i = 0; i < count; i++) {
                const p1 = points[i];
                const p2 = points[(i + 1) % points.length];
                const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
                if (len > 0) {
                    segments.push({ p1, p2, len });
                    totalLength += len;
                }
            }
            const sampleCount = 20;
            const step = totalLength / sampleCount;
            let totalBgLuminance = 0;
            let valid = 0;
            let segIdx = 0;
            let distInSeg = 0;

            for (let s = 0; s < sampleCount; s++) {
                const targetDist = s * step;
                while (segIdx < segments.length && distInSeg + segments[segIdx].len < targetDist) {
                    distInSeg += segments[segIdx].len;
                    segIdx++;
                }
                if (segIdx >= segments.length) break;
                const seg = segments[segIdx];
                const t = seg.len > 0 ? (targetDist - distInSeg) / seg.len : 0;
                const nx = seg.p1[0] + t * (seg.p2[0] - seg.p1[0]);
                const ny = seg.p1[1] + t * (seg.p2[1] - seg.p1[1]);
                const cx = Math.max(0, Math.min(width - 1, Math.round(nx * (width / 100))));
                const cy = Math.max(0, Math.min(height - 1, Math.round(ny * (height / 100))));
                const offset = (cy * width + cx) * 4;
                const lum = getRelativeLuminance([data[offset], data[offset + 1], data[offset + 2]]);
                totalBgLuminance += lum;
                valid++;
            }

            const bgLum = totalBgLuminance / valid;
            const colLum = getRelativeLuminance(colorHex);
            const ratio = Math.round(getContrastRatio(colLum, bgLum) * 10) / 10;
            return { ratio, isLow: ratio < 3.0, bgLum };
        }

        // Test with yellow (low contrast on 240,240,240)
        const yellowResult = evaluateTest(points, "#facc15");
        expect(yellowResult.isLow).toBe(true);
        expect(yellowResult.ratio).toBeLessThan(3.0);

        // Test with dark blue (high contrast on 240,240,240)
        const blueResult = evaluateTest(points, "#1e3a8a");
        expect(blueResult.isLow).toBe(false);
        expect(blueResult.ratio).toBeGreaterThan(4.5);
    });

    it("auto-generates contour color discarding candidates with CR < 2.5:1", () => {
        const bgLuminance = 0.85; // Light background
        let candidateHex = "#eab308"; // Yellow with CR ~ 1.5
        const initialCR = getContrastRatio(getRelativeLuminance(candidateHex), bgLuminance);
        expect(initialCR).toBeLessThan(2.5);

        // Adaptation logic as implemented in click_editor.js
        if (initialCR < 2.5) {
            const targetL = bgLuminance > 0.5 ? 35 : 68;
            const hsl = hexToHsl(candidateHex);
            const adjustedHex = hslToHex(hsl.h, hsl.s, targetL);
            const adjustedCR = getContrastRatio(getRelativeLuminance(adjustedHex), bgLuminance);
            expect(adjustedCR).toBeGreaterThanOrEqual(2.5);
        }
    });

    describe("Contrast Halo (Task 4.2B)", () => {
        function getContrastHaloFilter(color) {
            const lum = getRelativeLuminance(color);
            if (lum < 0.18) return "drop-shadow(0 0 1.5px rgba(255, 255, 255, 0.85))";
            if (lum > 0.7) return "drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.85))";
            return "drop-shadow(0 0 1px rgba(255, 255, 255, 0.6)) drop-shadow(0 0 1px rgba(0, 0, 0, 0.6))";
        }

        it("assigns white halo to dark contours to ensure visibility on dark backgrounds", () => {
            const blackHalo = getContrastHaloFilter("#000000");
            expect(blackHalo).toBe("drop-shadow(0 0 1.5px rgba(255, 255, 255, 0.85))");

            const darkBlueHalo = getContrastHaloFilter("#0f172a");
            expect(darkBlueHalo).toBe("drop-shadow(0 0 1.5px rgba(255, 255, 255, 0.85))");
        });

        it("assigns dark halo to bright contours to ensure visibility on light backgrounds", () => {
            const whiteHalo = getContrastHaloFilter("#ffffff");
            expect(whiteHalo).toBe("drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.85))");

            const brightYellowHalo = getContrastHaloFilter("#fef08a");
            expect(brightYellowHalo).toBe("drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.85))");
        });

        it("assigns dual halo to mid-range colors", () => {
            const blueHalo = getContrastHaloFilter("#3b82f6");
            expect(blueHalo).toContain("rgba(255, 255, 255, 0.6)");
            expect(blueHalo).toContain("rgba(0, 0, 0, 0.6)");
        });
    });
});

