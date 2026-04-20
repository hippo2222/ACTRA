/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from "vitest";
import "../frontend/DrawUI/DrawUI.web.js";

const DrawUI = window.DrawUI;

if (!DrawUI || !DrawUI.__testing) {
  throw new Error("DrawUI test utilities are not available");
}

describe("DrawUI metadata synchronization", () => {
  const testing = DrawUI.__testing;

  function resetState() {
    Object.assign(testing.state, {
      taskDto: {
        task_data: {
          content: {
            prompt: "legacy",
            settings: { success_threshold: 2 },
            additionalInfo: { type: "text", text: "legacy text" },
          },
        },
      },
      metadataApi: null,
      metadataSnapshot: null,
    });
  }

  beforeEach(() => {
    resetState();
  });

  it("applies collect/apply snapshot to taskDto", () => {
    const snapshot = {
      prompt: "Новый draw prompt",
      successThreshold: 5,
      additionalInfo: { type: "combined", text: "memo", images: ["a.png"] },
    };

    testing.state.metadataApi = {
      collect: () => snapshot,
      applyToTaskDto: (dto) => {
        const content = dto.task_data.content;
        content.prompt = snapshot.prompt;
        content.settings.success_threshold = snapshot.successThreshold;
        content.additionalInfo = snapshot.additionalInfo;
      },
    };

    const result = testing.syncMetadataToTaskDto();

    expect(result).toEqual(snapshot);
    expect(testing.state.metadataSnapshot).toEqual(snapshot);
    expect(
      testing.state.taskDto.task_data.content.settings.success_threshold
    ).toBe(5);
    expect(
      testing.state.taskDto.task_data.content.additionalInfo.images
    ).toEqual(["a.png"]);
  });

  it("falls back to internal merge when applyToTaskDto is missing", () => {
    testing.state.metadataApi = {
      collect: () => ({
        prompt: "Только collect",
        successThreshold: null,
        additionalInfo: null,
      }),
    };

    testing.syncMetadataToTaskDto();

    const content = testing.state.taskDto.task_data.content;
    expect(content.prompt).toBe("Только collect");
    expect(content.settings.success_threshold).toBeUndefined();
    expect("additionalInfo" in content).toBe(false);
  });

  it("restores saved draw payload into runtime state", () => {
    const setLocked = vi.fn();
    Object.assign(testing.state, {
      maxPolygons: 1,
      maxLines: 1,
      metadataApi: { setLocked },
      _updateToolbar: vi.fn(),
      _updateLiveProgress: vi.fn(),
      labelsContainer: null,
      drawLayer: null,
      refLayer: null,
      img: null,
    });

    const draft = {
      brush_radius: 12,
      polygons: [
        {
          points: [
            [10, 10],
            [20, 10],
            [20, 20],
            [10, 10],
          ],
        },
      ],
      lines: [
        {
          points: [
            [30, 30],
            [50, 35],
          ],
        },
      ],
      labels_polygons: ["Контур A"],
      labels_lines: ["Штрих B"],
    };

    DrawUI.restoreInput(draft);

    expect(testing.state.polygons).toEqual(draft.polygons);
    expect(testing.state.lines).toEqual(draft.lines);
    expect(testing.state.labelsPolygons).toEqual(["Контур A"]);
    expect(testing.state.labelsLines).toEqual(["Штрих B"]);
    expect(testing.state.actionHistory).toEqual([{ kind: "polygon" }, { kind: "line" }]);
    expect(testing.state.stage).toBe("lines");
    expect(testing.state.mode).toBe("brush");
    expect(testing.state.brushRadius).toBe(12);
    expect(testing.state.locked).toBe(false);
    expect(testing.state.showRef).toBe(false);
    expect(setLocked).toHaveBeenCalledWith(false);
  });

  it("captures and reapplies draw view state", () => {
    Object.assign(testing.state, {
      img: { complete: true, naturalWidth: 800 },
      contentLayer: document.createElement("div"),
      drawLayer: document.createElement("div"),
      refLayer: document.createElement("div"),
      viewport: {},
      labelsContainer: null,
      _updateToolbar: vi.fn(),
      _updateLiveProgress: vi.fn(),
      showRef: false,
      showRefContours: true,
      showRefPolygons: true,
      showRefLines: true,
      showRefLabels: true,
      mode: "brush",
      stage: "polygons",
      zoom: 1.1,
      panX: 14,
      panY: 18,
    });

    const viewState = DrawUI.getViewState();

    DrawUI.restoreViewState({
      ...viewState,
      mode: "pan",
      stage: "lines",
      zoom: 2,
      panX: 40,
      panY: 50,
      showRef: true,
      showRefLabels: false,
    });

    expect(testing.state.mode).toBe("pan");
    expect(testing.state.stage).toBe("lines");
    expect(testing.state.zoom).toBe(2);
    expect(testing.state.panX).toBe(40);
    expect(testing.state.panY).toBe(50);
    expect(testing.state.showRef).toBe(true);
    expect(testing.state.showRefLabels).toBe(false);
  });

  it("treats a stroke as closed once it returns to the start point", () => {
    const closedPoints = testing.getClosedStrokePoints([
      [10, 10],
      [24, 10],
      [24, 24],
      [10, 28],
      [10, 10],
      [14, 10],
    ]);

    expect(closedPoints).toEqual([
      [10, 10],
      [24, 10],
      [24, 24],
      [10, 28],
      [10, 10],
    ]);
  });

  it("does not close a stroke prematurely when early points stay near the start", () => {
    const closedPoints = testing.getClosedStrokePoints([
      [94.89212419445508, 94.50536121640886],
      [91.4750006110328, 94.50536121640886],
      [88.4849808135698, 94.50536121640886],
      [86.1027718188126, 95.35982471726444],
      [84.4393675634011, 97.64397071954607],
      [83.7712358617652, 101.05353106531842],
    ]);

    expect(closedPoints).toBeNull();
  });

  it("keeps contour closure stable for high-resolution images rendered smaller on screen", () => {
    testing.state.img = {
      naturalWidth: 2000,
      naturalHeight: 1000,
      getBoundingClientRect: () => ({ width: 500, height: 250 }),
    };

    const closedPoints = testing.getClosedStrokePoints([
      [40, 40],
      [200, 40],
      [200, 200],
      [40, 200],
      [72, 48],
      [56, 40],
    ]);

    expect(closedPoints).toEqual([
      [40, 40],
      [200, 40],
      [200, 200],
      [40, 200],
      [72, 48],
    ]);
  });

  it("includes display dimensions in draw payload for scale-aware evaluation", () => {
    const img = document.createElement("img");
    Object.defineProperty(img, "naturalWidth", { value: 2000, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 1000, configurable: true });
    img.getBoundingClientRect = () => ({ width: 500, height: 250 });

    Object.assign(testing.state, {
      img,
      brushRadius: 10,
      polygons: [{ points: [[10, 10], [40, 10], [40, 40], [10, 10]] }],
      lines: [],
      activeStroke: null,
    });

    const payload = DrawUI.getUserAnswerPayload();

    expect(payload.image_width).toBe(2000);
    expect(payload.image_height).toBe(1000);
    expect(payload.display_width).toBe(500);
    expect(payload.display_height).toBe(250);
    expect(payload.brush_radius).toBe(10);
  });

  it("prefers canonical asset refs over legacy paths in draw image helpers", () => {
    const resolved = testing.resolveAssetUrl({
      image_asset_id: "asset_draw_1",
      image_path: "legacy/draw.png",
    });

    expect(resolved).toBe("/api/assets/asset_draw_1/content");
  });
});
