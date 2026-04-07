import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

const themeManagerSource = fs.readFileSync(
    path.resolve(process.cwd(), "frontend/assets/ThemeManager.js"),
    "utf8",
);

const theoryEditorHtml = fs.readFileSync(
    path.resolve(process.cwd(), "frontend/Editor/Theory_Editor.html"),
    "utf8",
);

const theoryCenterHtml = fs.readFileSync(
    path.resolve(process.cwd(), "frontend/Editor/Theory_Center.html"),
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
    defineGlobal("navigator", dom.window.navigator);
    defineGlobal("localStorage", dom.window.localStorage);
    defineGlobal("sessionStorage", dom.window.sessionStorage);
    defineGlobal("CustomEvent", dom.window.CustomEvent);
    defineGlobal("requestAnimationFrame", dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0)));
}

describe("Theory theme persistence", () => {
    afterEach(() => {
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.HTMLElement;
        delete globalThis.Node;
        delete globalThis.navigator;
        delete globalThis.localStorage;
        delete globalThis.sessionStorage;
        delete globalThis.CustomEvent;
        delete globalThis.requestAnimationFrame;
    });

    it("boots both theory pages through ThemeManager.js", () => {
        expect(theoryEditorHtml).toContain('<script src="/assets/ThemeManager.js"></script>');
        expect(theoryCenterHtml).toContain('<script src="/assets/ThemeManager.js"></script>');
    });

    it("restores the saved theme from localStorage and keeps dark-mode compatibility flags", () => {
        const dom = new JSDOM("<!DOCTYPE html><html><body><main></main></body></html>", {
            url: "http://localhost/ui/editor/Theory_Editor.html",
            runScripts: "dangerously",
        });

        bindDomGlobals(dom);
        dom.window.localStorage.setItem("app-theme", "dark-b");
        dom.window.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
        dom.window.matchMedia = dom.window.matchMedia || (() => ({
            matches: false,
            media: "",
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent() { return false; },
        }));

        dom.window.eval(themeManagerSource);

        expect(dom.window.document.documentElement.getAttribute("data-theme")).toBe("dark-b");
        expect(dom.window.document.documentElement.classList.contains("dark")).toBe(true);

        dom.window.ThemeManager.setTheme("light-b");
        expect(dom.window.localStorage.getItem("app-theme")).toBe("light-b");
        expect(dom.window.document.documentElement.getAttribute("data-theme")).toBe("light-b");
        expect(dom.window.document.documentElement.classList.contains("dark")).toBe(false);
    });
});
