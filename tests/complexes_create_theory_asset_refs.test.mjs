import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/Complexes/create.html"),
  "utf8",
);

function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

function bindDomGlobals(dom) {
  defineGlobal("window", dom.window);
  defineGlobal("document", dom.window.document);
  defineGlobal("HTMLElement", dom.window.HTMLElement);
  defineGlobal("Node", dom.window.Node);
  defineGlobal("URL", dom.window.URL);
}

function extractLastFunction(functionName) {
  const token = `function ${functionName}(`;
  const lastIndex = source.lastIndexOf(token);
  if (lastIndex < 0) {
    throw new Error(`Could not find function ${functionName}`);
  }

  const bodyStart = source.indexOf("{", lastIndex);
  if (bodyStart < 0) {
    throw new Error(`Could not find body for function ${functionName}`);
  }

  let depth = 0;
  let endIndex = -1;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }

  if (endIndex < 0) {
    throw new Error(`Could not extract function ${functionName}`);
  }

  return source.slice(lastIndex, endIndex + 1);
}

function buildHelpers(dom) {
  bindDomGlobals(dom);
  const factory = new Function(`
    ${extractLastFunction("theoryLocalImageSrc")}
    ${extractLastFunction("isTheoryHostedAssetRef")}
    ${extractLastFunction("theoryAssetSrc")}
    ${extractLastFunction("escapeTheoryHtml")}
    ${extractLastFunction("normalizeTheoryImageRef")}
    ${extractLastFunction("renderTheoryInline")}
    ${extractLastFunction("renderTheoryLineContent")}
    return {
      theoryLocalImageSrc,
      isTheoryHostedAssetRef,
      theoryAssetSrc,
      normalizeTheoryImageRef,
      renderTheoryLineContent,
    };
  `);
  return factory();
}

describe("Complexes create theory asset refs", () => {
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.URL;
  });

  it("normalizes hosted local-image asset ids into canonical asset URLs", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://localhost/ui/complexes/create",
    });
    const helpers = buildHelpers(dom);

    expect(
      helpers.normalizeTheoryImageRef("/api/local-image?asset_id=asset_complex_theory_1"),
    ).toBe("/api/assets/asset_complex_theory_1/content");
  });

  it("renders hosted theory image segments with asset-first refs", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://localhost/ui/complexes/create",
    });
    const helpers = buildHelpers(dom);

    const html = helpers.renderTheoryLineContent([
      {
        kind: "image",
        value: "/api/assets/asset_complex_theory_2/content",
        attrs: {
          width: "420px",
          align: "center",
        },
      },
    ]);

    expect(html).toContain('data-asset-url="/api/assets/asset_complex_theory_2/content"');
    expect(html).toContain('src="/api/assets/asset_complex_theory_2/content"');
    expect(html).not.toContain("data-path=");
  });
});
