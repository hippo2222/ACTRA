/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import TaskMetadataPanel from "../frontend/ClickUI/TaskMetadataPanel.js";

function triggerEvent(element, value, eventName = "input") {
  element.value = value;
  element.dispatchEvent(new Event(eventName, { bubbles: true }));
}

describe("TaskMetadataPanel metadata flow", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("collects prompt/threshold/additional info and applies them to DTO", () => {
    const initialDto = {
      task_data: {
        content: {
          prompt: "Исходная инструкция",
          settings: { success_threshold: 2 },
          additionalInfo: { type: "text", text: "старый текст" },
        },
      },
    };

    const metadata = TaskMetadataPanel.create({ taskDto: initialDto });
    document.body.appendChild(metadata.rootEl);

    const promptTextarea = metadata.rootEl.querySelector("#taskmeta-prompt");
    triggerEvent(promptTextarea, "Новая инструкция пользователя");

    const thresholdInput = metadata.rootEl.querySelector('input[type="number"]');
    triggerEvent(thresholdInput, "4");

    const typeSelect = metadata.rootEl.querySelector("select");
    typeSelect.value = "text";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const additionalTextarea = metadata.rootEl.querySelector(
      'textarea[placeholder="Введите дополнительный текст…"]'
    );
    triggerEvent(additionalTextarea, "Подсказка про сосудистые структуры");

    const snapshot = metadata.api.collect();
    expect(snapshot).toEqual({
      prompt: "Новая инструкция пользователя",
      successThreshold: 4,
      additionalInfo: {
        type: "text",
        text: "Подсказка про сосудистые структуры",
      },
    });

    const targetDto = {
      task_data: {
        content: {
          settings: { legacy: true },
        },
      },
    };

    metadata.api.applyToTaskDto(targetDto);

    expect(targetDto.task_data.content.prompt).toBe(
      "Новая инструкция пользователя"
    );
    expect(targetDto.task_data.content.settings.success_threshold).toBe(4);
    expect(targetDto.task_data.content.additionalInfo).toEqual({
      type: "text",
      text: "Подсказка про сосудистые структуры",
    });
  });

  it("removes success_threshold and additionalInfo when fields are cleared", () => {
    const metadata = TaskMetadataPanel.create({
      taskDto: {
        task_data: {
          content: {
            prompt: "Base",
            settings: { success_threshold: 3 },
            additionalInfo: { type: "text", text: "legacy" },
          },
        },
      },
    });
    document.body.appendChild(metadata.rootEl);

    const thresholdInput = metadata.rootEl.querySelector('input[type="number"]');
    triggerEvent(thresholdInput, "");

    const typeSelect = metadata.rootEl.querySelector("select");
    typeSelect.value = "none";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const targetDto = {
      task_data: {
        content: {
          settings: { success_threshold: 5 },
          additionalInfo: { type: "text", text: "старый" },
        },
      },
    };

    metadata.api.applyToTaskDto(targetDto);

    expect(targetDto.task_data.content.settings.success_threshold).toBeUndefined();
    expect("additionalInfo" in targetDto.task_data.content).toBe(false);
  });
});
