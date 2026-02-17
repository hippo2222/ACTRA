/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
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
});
