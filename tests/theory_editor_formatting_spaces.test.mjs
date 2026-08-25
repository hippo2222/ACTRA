import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

const theoryEditorSource = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/Editor/theory_editor.js"),
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

function extractFunctionFromSource(source, functionName) {
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

function buildTheoryEditorHelpers(dom) {
  bindDomGlobals(dom);
  const factory = new Function(`
    ${extractFunctionFromSource(theoryEditorSource, "escapeTheoryHtml")}
    ${extractFunctionFromSource(theoryEditorSource, "renderTheoryInline")}
    ${extractFunctionFromSource(theoryEditorSource, "renderTheoryLineContent")}
    ${extractFunctionFromSource(theoryEditorSource, "collectTheoryInlineOps")}
    return {
      escapeTheoryHtml,
      renderTheoryInline,
      renderTheoryLineContent,
      collectTheoryInlineOps,
    };
  `);
  return factory();
}

describe("Theory inline formatting whitespace preservation", () => {
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.URL;
  });

  it("places trailing spaces outside strong tag in renderTheoryInline", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const helpers = buildTheoryEditorHelpers(dom);

    const rendered = helpers.renderTheoryInline("Жирный ", { bold: true });
    expect(rendered).toBe("<strong>Жирный</strong> ");
  });

  it("places leading spaces outside strong tag in renderTheoryInline", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const helpers = buildTheoryEditorHelpers(dom);

    const rendered = helpers.renderTheoryInline(" Жирный", { bold: true });
    expect(rendered).toBe(" <strong>Жирный</strong>");
  });

  it("places both leading and trailing spaces outside formatting tags", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const helpers = buildTheoryEditorHelpers(dom);

    const rendered = helpers.renderTheoryInline(" Жирный и курсив ", { bold: true, italic: true });
    expect(rendered).toBe(" <em><strong>Жирный и курсив</strong></em> ");
  });

  it("handles whitespace-only text with bold attribute without creating empty bold tags", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const helpers = buildTheoryEditorHelpers(dom);

    const rendered = helpers.renderTheoryInline("   ", { bold: true });
    expect(rendered).toBe("   ");
  });

  it("renders line content with bold followed by plain text preserving the space", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const helpers = buildTheoryEditorHelpers(dom);

    const html = helpers.renderTheoryLineContent([
      { kind: "text", value: "Жирный ", attrs: { bold: true } },
      { kind: "text", value: "текст", attrs: {} },
    ]);

    expect(html).toBe("<strong>Жирный</strong> текст");
  });

  it("preserves formatted text in collectTheoryInlineOps without artificial splitting", () => {
    const dom = new JSDOM("<!doctype html><html><body><strong id='target'>Жирный </strong></body></html>");
    const helpers = buildTheoryEditorHelpers(dom);

    const target = dom.window.document.getElementById("target");
    const textNode = target.firstChild;
    const ops = [];
    helpers.collectTheoryInlineOps(textNode, { bold: true }, ops);

    expect(ops).toEqual([
      { insert: "Жирный ", attributes: { bold: true } },
    ]);
  });
});
