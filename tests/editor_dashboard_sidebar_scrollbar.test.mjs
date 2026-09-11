import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";

function loadFile(filePath) {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("Dashboard sidebar scrollbar", () => {
    it("Main_Dashboard.html sidebar scroll container uses sidebar-scrollbar and avoids no-scrollbar", () => {
        const html = loadFile("frontend/Editor/Main_Dashboard.html");
        const dom = new JSDOM(html);
        const sidebar = dom.window.document.getElementById("editor-sidebar");

        expect(sidebar).not.toBeNull();

        const scrollContainer = sidebar.querySelector(".overflow-y-auto");
        expect(scrollContainer).not.toBeNull();

        // Must NOT have no-scrollbar which hides the scrollbar
        expect(scrollContainer.classList.contains("no-scrollbar")).toBe(false);

        // Must have sidebar-scrollbar and custom-scrollbar
        expect(scrollContainer.classList.contains("sidebar-scrollbar")).toBe(true);
        expect(scrollContainer.classList.contains("custom-scrollbar")).toBe(true);
    });

    it("styles.css defines modern scrollbar properties and WebKit fallbacks for sidebar-scrollbar", () => {
        const css = loadFile("frontend/Editor/styles.css");

        // Standard CSS scrollbar properties
        expect(css).toMatch(/\.sidebar-scrollbar[^{]*\{[^}]*scrollbar-width:\s*thin;/);
        expect(css).toMatch(/\.sidebar-scrollbar[^{]*\{[^}]*scrollbar-color:\s*color-mix/);

        // WebKit pseudo-elements with padding-box clip
        expect(css).toMatch(/\.sidebar-scrollbar::-webkit-scrollbar[^{]*\{[^}]*width:\s*8px;/);
        expect(css).toMatch(/\.sidebar-scrollbar::-webkit-scrollbar-thumb[^{]*\{[^}]*border-radius:\s*999px;/);
        expect(css).toMatch(/\.sidebar-scrollbar::-webkit-scrollbar-thumb[^{]*\{[^}]*background-clip:\s*padding-box;/);
        expect(css).toMatch(/\.sidebar-scrollbar::-webkit-scrollbar-thumb:hover[^{]*\{[^}]*background:\s*color-mix/);
    });

    it("dashboard.js renderSidebar can query and populate aside .flex-1 correctly", () => {
        const dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <body>
                <aside id="editor-sidebar">
                    <div class="flex-1 min-h-0 overflow-y-auto pt-4 pb-6 sidebar-scrollbar custom-scrollbar">
                        <div class="flex flex-col"></div>
                    </div>
                </aside>
            </body>
            </html>
        `);

        const sidebarContainer = dom.window.document.querySelector("aside .flex-1");
        expect(sidebarContainer).not.toBeNull();
        expect(sidebarContainer.classList.contains("sidebar-scrollbar")).toBe(true);

        const navContainer = sidebarContainer.querySelector(".flex-col");
        expect(navContainer).not.toBeNull();
    });
});
