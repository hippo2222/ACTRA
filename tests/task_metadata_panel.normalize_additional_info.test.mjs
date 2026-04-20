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
      images: [
        "/api/local-image?path=img1.png",
        "/api/local-image?path=img2.png",
        "/api/local-image?path=img3.png",
      ],
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
      images: ["/api/local-image?path=relative%2Fpath.png"],
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

  it("normalizes asset-backed images into canonical hosted asset URLs", () => {
    const raw = {
      type: "image",
      images: [{ asset_id: "asset_meta_1" }],
    };
    const result = normalize(raw);
    expect(result).toEqual({
      type: "image",
      images: ["/api/assets/asset_meta_1/content"],
      text: "",
    });
  });

  it("prefers canonical asset refs over legacy paths inside image entries", () => {
    const raw = {
      type: "image",
      images: [{ asset_id: "asset_meta_2", path: "legacy/meta.png" }],
    };
    const result = normalize(raw);
    expect(result).toEqual({
      type: "image",
      images: ["/api/assets/asset_meta_2/content"],
      text: "",
    });
  });
});
