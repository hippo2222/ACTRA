/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import TaskMetadataPanel from "../frontend/ClickUI/TaskMetadataPanel.js";

describe("TaskMetadataPanel lock state and annotation totals", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function getThresholdInfo(root) {
    return Array.from(root.querySelectorAll("div")).find((div) =>
      div.textContent.includes("аннотаций")
    );
  }

  it("updates threshold info based on annotation totals", () => {
    const metadata = TaskMetadataPanel.create({
      annotationTotals: { clicks: 5 },
    });
    document.body.appendChild(metadata.rootEl);

    const info = getThresholdInfo(metadata.rootEl);
    expect(info.textContent).toContain("из 5 аннотаций");

    metadata.api.updateAnnotationTotals({ polygons: 2, freehand: 3 });
    expect(info.textContent).toContain("из 5 аннотаций");

    metadata.api.updateAnnotationTotals(null);
    expect(info.textContent).toContain("из ? аннотаций");
  });

  it("disables/enables inputs when locked/unlocked", () => {
    const metadata = TaskMetadataPanel.create();
    document.body.appendChild(metadata.rootEl);

    const promptTextarea = metadata.rootEl.querySelector("#taskmeta-prompt");
    const thresholdInput = metadata.rootEl.querySelector('input[type="number"]');
    const typeSelect = metadata.rootEl.querySelector("select");

    metadata.api.setLocked(true);
    [promptTextarea, thresholdInput, typeSelect].forEach((el) =>
      expect(el.disabled).toBe(true)
    );

    metadata.api.setLocked(false);
    [promptTextarea, thresholdInput, typeSelect].forEach((el) =>
      expect(el.disabled).toBe(false)
    );
  });
});
