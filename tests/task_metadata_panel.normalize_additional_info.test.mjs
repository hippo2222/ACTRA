import { describe, it, expect } from "vitest";
import TaskMetadataPanel from "../frontend/ClickUI/TaskMetadataPanel.js";

const normalize = TaskMetadataPanel.normalizeAdditionalInfo;

describe("_normalizeAdditionalInfo", () => {
  it("infers combined type and trims duplicates/limit", () => {
    const raw = {
      text: "Helpful text",
      images: ["img1.png", "img2.png", "img1.png", "img3.png", "img4.png"],
    };
    const result = normalize(raw);
    expect(result).toEqual({
      type: "combined",
      text: "Helpful text",
      images: ["img1.png", "img2.png", "img3.png"],
    });
  });

  it("returns null when image type missing paths", () => {
    expect(normalize({ type: "image", images: [] })).toBeNull();
    expect(normalize({ type: "image", image: "  " })).toBeNull();
  });

  it("promotes content field into images when needed", () => {
    const raw = {
      type: "image",
      content: "relative/path.png",
    };
    const result = normalize(raw);
    expect(result).toEqual({
      type: "image",
      images: ["relative/path.png"],
      text: "",
    });
  });

  it("treats data URL as valid image entry", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const raw = { images: [dataUrl] };
    const result = normalize(raw);
    expect(result).toEqual({
      type: "image",
      images: [dataUrl],
      text: "",
    });
  });

  it("returns null for empty/invalid combined resource", () => {
    expect(normalize({ type: "combined", text: "   ", images: [" ", "  "] })).toBeNull();
    expect(normalize({})).toBeNull();
  });
});
