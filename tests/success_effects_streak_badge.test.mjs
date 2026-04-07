/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

describe("SuccessEffects streak badge", () => {
  let SuccessEffects;
  let originalGetContext;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;
  let originalMatchMedia;

  beforeEach(() => {
    document.body.innerHTML = "";
    delete require.cache[require.resolve("../frontend/S1/success-effects.js")];
    SuccessEffects = require("../frontend/S1/success-effects.js");
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    originalMatchMedia = window.matchMedia;

    HTMLCanvasElement.prototype.getContext = () => ({
      setTransform() {},
      clearRect() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      fillRect() {},
      beginPath() {},
      arc() {},
      fill() {},
      globalAlpha: 1,
      fillStyle: "",
    });
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    window.matchMedia = () => ({ matches: false });
  });

  it("renders material flame icons and streak text", () => {
    const header = document.createElement("div");

    SuccessEffects.renderStreakBadge(header, 5);

    const badge = header.querySelector(".streak-badge");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("5 подряд!");
    const icons = badge.querySelectorAll(".material-symbols-outlined");
    expect(icons.length).toBe(3);
    icons.forEach((icon) => {
      expect(icon.textContent).toBe("local_fire_department");
    });
    expect(
      badge.querySelector(".streak-badge-inner").className
    ).toContain("streak-badge-epic");
  });

  it("scopes confetti to the result card instead of the full viewport", () => {
    const resultInner = document.createElement("div");
    resultInner.id = "result-inner";
    resultInner.style.overflow = "hidden";
    resultInner.getBoundingClientRect = () => ({
      width: 320,
      height: 180,
      top: 0,
      left: 0,
      right: 320,
      bottom: 180,
    });
    document.body.appendChild(resultInner);

    SuccessEffects.launchConfetti({
      particleCount: 12,
      targetElement: resultInner,
      originX: 0.12,
      originY: 0.94,
      angleDeg: -58,
      spread: 34,
      duration: 1200,
    });

    const canvas = resultInner.querySelector("#success-confetti-canvas");
    expect(canvas).toBeTruthy();
    expect(canvas.parentNode).toBe(resultInner);
    expect(canvas.style.position).toBe("absolute");
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    window.matchMedia = originalMatchMedia;
  });
});
