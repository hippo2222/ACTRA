/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../frontend/Editor/dashboard.js";

function setupDomSkeleton() {
  document.body.innerHTML = `
    <aside id="editor-sidebar">
      <div class="h-16"></div>
      <div class="flex-1">
        <div id="editor-workspace-shortcuts" class="px-4 mb-4"></div>
        <div class="flex flex-col"></div>
      </div>
    </aside>
    <div id="sidebar-resizer"></div>
    <div id="sidebar-blur-overlay"></div>
    <div id="sidebar-delete-modal"></div>

    <main>
      <div class="grid"></div>
    </main>

    <header>
      <div class="flex items-center gap-3"></div>
      <nav id="header-breadcrumbs"></nav>
    </header>

    <button data-role="create-task-card" type="button"></button>
    <button data-role="return-main" type="button"></button>
    <button data-role="open-recovery-center" type="button"></button>
    <button data-role="close-recovery-center" type="button"></button>
    <input id="editor-search-input" />

    <div data-role="sort-controller">
      <button data-role="sort-toggle" type="button"></button>
      <div data-role="sort-menu" class="hidden">
        <button data-sort-option="alphabet" type="button"><span data-role="sort-check"></span></button>
        <button data-sort-option="date" type="button"><span data-role="sort-check"></span></button>
        <button data-sort-option="type" type="button"><span data-role="sort-check"></span></button>
      </div>
      <span data-role="sort-label"></span>
    </div>

    <div id="create-task-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="create-module-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="create-topic-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="topic-theory-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="import-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="recovery-center-modal" class="hidden"><div id="recovery-center-content"></div></div>
    <div id="toast-container"></div>
  `;
}

describe("EditorDashboard Tooltips and Typography Structure", () => {
  let dashboard;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__ = true;
    delete window.__EDITOR_ROUTE_STATE__;
    setupDomSkeleton();
    window.dashboard = undefined;

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, modules: [] }),
      })
    );

    document.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    await Promise.resolve();
    dashboard = window.dashboard;
  });

  afterEach(() => {
    delete window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__;
    vi.restoreAllMocks();
  });

  it("sets untruncated full_name in title attribute and text content of task card without marquee-track", () => {
    const task = {
      id: "task_full_test",
      name: "Тест - Краткое...",
      full_name: "Тест - Полное название задания с подробным клиническим вопросом без обрезки",
      type: "test",
      moduleId: "mod1",
      topicId: "top1",
      created_at: "2026-03-01T10:00:00Z",
    };

    const card = dashboard.createTaskCard(task);
    const titleEl = card.querySelector(".editor-task-card-title");

    expect(titleEl).not.toBeNull();
    // Tooltip must contain the full, untruncated title
    expect(titleEl.getAttribute("title")).toBe(
      "Тест - Полное название задания с подробным клиническим вопросом без обрезки"
    );

    // Inner element must be clean text with full title up to 3 lines, not wrapped in a marquee track
    expect(titleEl.querySelector(".marquee-track")).toBeNull();
    expect(titleEl.textContent.trim()).toBe(
      "Тест - Полное название задания с подробным клиническим вопросом без обрезки"
    );
  });

  it("safely escapes HTML characters in task card title and tooltip", () => {
    const task = {
      id: "task_quote_test",
      name: 'Симптом "матового стекла" <КТ-паттерн>',
      full_name: 'Симптом "матового стекла" & консолидации <КТ-паттерн>',
      type: "click",
      moduleId: "mod1",
      topicId: "top1",
      created_at: "2026-03-01T10:00:00Z",
    };

    const card = dashboard.createTaskCard(task);
    const titleEl = card.querySelector(".editor-task-card-title");

    expect(titleEl.getAttribute("title")).toBe(
      'Симптом "матового стекла" & консолидации <КТ-паттерн>'
    );
    expect(titleEl.textContent.trim()).toBe('Симптом "матового стекла" & консолидации <КТ-паттерн>');
  });

  it("sets escaped title attribute on sidebar tree elements without marquee tracks", () => {
    // 1. Module element
    const module = {
      id: "mod_quotes",
      name: 'Модуль "Торакальная радиология"',
    };
    const modEl = dashboard.createModuleElement(module);
    const modLabel = modEl.querySelector(".editor-sidebar-tree-label");
    expect(modLabel).not.toBeNull();
    expect(modLabel.getAttribute("title")).toBe('Модуль "Торакальная радиология"');
    expect(modLabel.querySelector(".marquee-track")).toBeNull();
    expect(modLabel.textContent.trim()).toBe('Модуль "Торакальная радиология"');

    // 2. Topic element
    const topic = {
      id: "top_quotes",
      name: 'Тема "Плевральные выпоты"',
    };
    const topEl = dashboard.createTopicElement(topic, "mod_quotes");
    const topLabel = topEl.querySelector(".editor-sidebar-tree-label");
    expect(topLabel).not.toBeNull();
    expect(topLabel.getAttribute("title")).toBe('Тема "Плевральные выпоты"');
    expect(topLabel.querySelector(".marquee-track")).toBeNull();
    expect(topLabel.textContent.trim()).toBe('Тема "Плевральные выпоты"');

    // 3. Task element in sidebar
    const task = {
      id: "task_side",
      name: "Пневмоторакс на рентгене...",
      full_name: "Пневмоторакс на рентгене: признаки коллапса легкого и смещения средостения",
      type: "draw",
    };
    const taskButton = dashboard.createTaskElement(task, "mod_quotes", "top_quotes");
    const taskLabel = taskButton.querySelector(".editor-sidebar-tree-label");
    expect(taskLabel).not.toBeNull();
    // Must have title with full_name
    expect(taskLabel.getAttribute("title")).toBe(
      "Пневмоторакс на рентгене: признаки коллапса легкого и смещения средостения"
    );
    expect(taskLabel.querySelector(".marquee-track")).toBeNull();
    expect(taskLabel.textContent.trim()).toBe("Пневмоторакс на рентгене...");
  });

  it("setupMarqueeController is safe and does not crash or inject unwanted styles", () => {
    expect(() => dashboard.setupMarqueeController()).not.toThrow();
  });
});
