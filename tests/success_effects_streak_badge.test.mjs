/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

describe("SuccessEffects streak badge", () => {
  let SuccessEffects;

  beforeEach(() => {
    document.body.innerHTML = "";
    SuccessEffects = require("../frontend/S1/success-effects.js");
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
});
