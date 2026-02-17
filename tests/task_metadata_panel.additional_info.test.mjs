/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import TaskMetadataPanel from "../frontend/ClickUI/TaskMetadataPanel.js";

function typeIn(element, value, eventName = "input") {
  element.value = value;
  element.dispatchEvent(new Event(eventName, { bubbles: true }));
}

describe("TaskMetadataPanel additional materials behaviour", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("toggles between none/text/image/combined with proper sanitization", () => {
    const metadata = TaskMetadataPanel.create();
    document.body.appendChild(metadata.rootEl);

    const typeSelect = metadata.rootEl.querySelector("select");
    const textArea = metadata.rootEl.querySelector(
      'textarea[placeholder="Введите дополнительный текст…"]'
    );
    const addImageBtn = Array.from(
      metadata.rootEl.querySelectorAll("button")
    ).find((btn) => btn.textContent.includes("Добавить изображение"));
    expect(addImageBtn).toBeTruthy();

    // Switch to text and enter content
    typeSelect.value = "text";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    typeIn(textArea, "Текстовая подсказка");

    let snapshot = metadata.api.collect();
    expect(snapshot.additionalInfo).toEqual({
      type: "text",
      text: "Текстовая подсказка",
    });

    // Switch to image and ensure text cleared, images limited
    typeSelect.value = "image";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(addImageBtn.disabled).toBe(false);

    // simulate upload callback
    metadata.api.addImageForTest("img1.png");
    metadata.api.addImageForTest("img2.png");
    metadata.api.addImageForTest("img3.png");
    metadata.api.addImageForTest("img4.png"); // ignored due to limit

    snapshot = metadata.api.collect();
    expect(snapshot.additionalInfo).toEqual({
      type: "image",
      images: ["img1.png", "img2.png", "img3.png"],
    });
    expect(addImageBtn.disabled).toBe(true);

    // switch to combined, ensure text preserved and limit enforced
    typeSelect.value = "combined";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    typeIn(textArea, "Комбинированная подсказка");
    metadata.api.addImageForTest("extra.png"); // already 3 images => no change

    snapshot = metadata.api.collect();
    expect(snapshot.additionalInfo).toEqual({
      type: "combined",
      text: "Комбинированная подсказка",
      images: ["img1.png", "img2.png", "img3.png"],
    });

    // switch to none -> clear everything
    typeSelect.value = "none";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    snapshot = metadata.api.collect();
    expect(snapshot.additionalInfo).toBeNull();
  });
});
