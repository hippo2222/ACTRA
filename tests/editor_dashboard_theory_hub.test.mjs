/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../frontend/Editor/dashboard.js";

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

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
    </header>

    <button data-role="create-task-card" type="button"></button>
    <button data-role="return-main" type="button"></button>
    <button data-role="open-recovery-center" type="button"></button>
    <button data-role="close-recovery-center" type="button"></button>
    <button data-role="open-theory-hub" type="button"></button>
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

    <div id="theory-hub-modal" class="hidden">
      <button data-role="theory-hub-close" type="button"></button>
      <button id="theory-hub-refresh-btn" type="button"></button>
      <button id="theory-hub-sync-all-btn" type="button"></button>
      <select id="theory-hub-focus-theory"></select>
      <select id="theory-hub-ownership-filter">
        <option value="all">all</option>
        <option value="mine">mine</option>
        <option value="shared">shared</option>
        <option value="imported">imported</option>
      </select>
      <input id="theory-hub-search" />
      <select id="theory-hub-propagation-mode">
        <option value="safe">safe</option>
        <option value="inherit_only_force">inherit_only_force</option>
        <option value="all_force">all_force</option>
      </select>
      <input id="theory-hub-dry-run" type="checkbox" />
      <button id="theory-hub-select-all-btn" type="button"><span class="material-symbols-outlined"></span></button>
      <button id="theory-hub-sync-selected-btn" type="button"></button>
      <button id="theory-hub-force-resolve-btn" type="button"></button>
      <div id="theory-hub-summary"></div>
      <div id="theory-hub-map"></div>
      <div id="theory-hub-conflicts"></div>
      <div id="theory-hub-impact"></div>
      <div id="theory-hub-ownership-note"></div>
    </div>

    <div id="toast-container"></div>
  `;
}

async function flushPromises(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

describe("EditorDashboard Theory Hub", () => {
  let topicSyncPayload = null;
  let complexSyncPayload = null;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    window.NotificationUI = {
      toast: vi.fn(),
      confirm: vi.fn(async () => true),
    };
    window.navigateWithTransition = vi.fn();
    window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__ = true;
    window.sessionStorage.clear();

    topicSyncPayload = null;
    complexSyncPayload = null;

    global.fetch = vi.fn(async (input, init = {}) => {
      const url = typeof input === "string" ? input : String(input?.url || "");
      const method = String(init?.method || "GET").toUpperCase();

      if (url === "/api/editor/catalog") {
        return createJsonResponse({
          ok: true,
          modules: [
            {
              id: "m1",
              name: "Module 1",
              topics: [
                { id: "t1", name: "Topic 1", tasks: [], theory_link: { theory_id: "th_a", relation: "link" } },
                { id: "t2", name: "Topic 2", tasks: [], theory_link: { theory_id: "th_b", relation: "link" } },
              ],
            },
          ],
        });
      }

      if (url === "/api/complexes") {
        return createJsonResponse({
          ok: true,
          items: [
            {
              id: "cx_ok",
              name: "Complex OK",
              tasks: ["m1/t1/task_1"],
              theory_mode: "inherit",
              theory_link: { theory_id: "th_a" },
              theory_sync_status: "ok",
              ownership: {
                created_by_user_id: "owner_a",
                created_via: "manual_editor",
                has_owner: true,
                is_owned_by_current_user: false,
              },
            },
            {
              id: "cx_conflict",
              name: "Complex Conflict",
              tasks: ["m1/t1/task_2", "m1/t2/task_3"],
              theory_mode: "inherit",
              theory_link: { theory_id: "th_a" },
              theory_sync_status: "conflict",
              ownership: {
                created_by_user_id: "feedback_user",
                created_via: "archive_import",
                has_owner: true,
                is_owned_by_current_user: true,
              },
            },
          ],
        });
      }

      if (url === "/api/theories") {
        return createJsonResponse({
          ok: true,
          items: [
            { id: "th_a", title: "Theory A" },
            { id: "th_b", title: "Theory B" },
          ],
        });
      }

      if (url.includes("/api/editor/topic/m1/t1/theory-link") && method === "GET") {
        return createJsonResponse({
          ok: true,
          item: {
            module_id: "m1",
            topic_id: "t1",
            theory_link: { theory_id: "th_a", relation: "link" },
          },
          propagation_preview: {
            mode: "safe",
            dry_run: true,
            impacted_complexes: 2,
            would_update: 1,
            updated: 0,
            skipped: 1,
          },
        });
      }

      if (url.includes("/api/editor/topic/m1/t1/theory-link") && method === "PUT") {
        topicSyncPayload = JSON.parse(String(init?.body || "{}"));
        return createJsonResponse({
          ok: true,
          propagation: {
            summary: {
              mode: topicSyncPayload.propagation_mode || "safe",
              dry_run: !!topicSyncPayload.dry_run,
              impacted_complexes: 2,
              would_update: topicSyncPayload.dry_run ? 1 : 0,
              updated: topicSyncPayload.dry_run ? 0 : 1,
              skipped: 1,
            },
            items: [],
          },
        });
      }

      if (url.includes("/api/complexes/cx_conflict/sync-theory-from-topics") && method === "POST") {
        complexSyncPayload = JSON.parse(String(init?.body || "{}"));
        return createJsonResponse({
          ok: true,
          summary: {
            complex_id: "cx_conflict",
            mode: complexSyncPayload.propagation_mode || "safe",
            dry_run: !!complexSyncPayload.dry_run,
            action: "updated",
            status: "ok",
          },
        });
      }

      if (url === "/api/session/cx_ok/start" && method === "POST") {
        return createJsonResponse({
          ok: true,
          session_id: "sess_th_a",
        });
      }

      return createJsonResponse({ ok: true });
    });

    setupDomSkeleton();
    window.dashboard = undefined;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await flushPromises();
  });

  afterEach(() => {
    delete window.NotificationUI;
    delete window.navigateWithTransition;
    delete window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__;
    vi.restoreAllMocks();
  });

  it("renders relation map and conflict queue", async () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    await dashboard.showTheoryHub();
    await flushPromises();

    const modal = document.getElementById("theory-hub-modal");
    const mapHost = document.getElementById("theory-hub-map");
    const queueHost = document.getElementById("theory-hub-conflicts");

    expect(modal.classList.contains("hidden")).toBe(false);
    expect(modal.classList.contains("flex")).toBe(true);
    expect(mapHost.textContent).toContain("Topic 1");
    expect(queueHost.textContent).toContain("Complex Conflict");
    expect(queueHost.textContent).toContain("моё");
    expect(queueHost.textContent).toContain("Импорт");

    const theoryHubTriggerBadge = document.querySelector(
      '[data-role="open-theory-hub"] [data-role="theory-hub-queue-count"]',
    );
    expect(theoryHubTriggerBadge).toBeTruthy();
    expect(theoryHubTriggerBadge.textContent).toBe("1");
  });

  it("uses selected mode and dry-run for topic sync from hub", async () => {
    const dashboard = window.dashboard;
    await dashboard.showTheoryHub();
    await flushPromises();

    const modeEl = document.getElementById("theory-hub-propagation-mode");
    const dryRunEl = document.getElementById("theory-hub-dry-run");
    modeEl.value = "all_force";
    dryRunEl.checked = true;

    const syncTopicBtn = document.querySelector('[data-action="hub-sync-topic"][data-module-id="m1"][data-topic-id="t1"]');
    expect(syncTopicBtn).toBeTruthy();

    syncTopicBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(topicSyncPayload).toEqual({
      theory_link: { theory_id: "th_a", relation: "link" },
      apply_to_complexes: true,
      dry_run: true,
      propagation_mode: "all_force",
    });
  });

  it("uses selected mode for complex sync from conflict queue", async () => {
    const dashboard = window.dashboard;
    await dashboard.showTheoryHub();
    await flushPromises();

    const modeEl = document.getElementById("theory-hub-propagation-mode");
    const dryRunEl = document.getElementById("theory-hub-dry-run");
    modeEl.value = "inherit_only_force";
    dryRunEl.checked = false;

    const syncComplexBtn = document.querySelector('[data-action="hub-sync-complex"][data-complex-id="cx_conflict"]');
    expect(syncComplexBtn).toBeTruthy();

    syncComplexBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(complexSyncPayload).toEqual({
      propagation_mode: "inherit_only_force",
      dry_run: false,
    });
  });

  it("sync all reports skipped topics without theory", async () => {
    const dashboard = window.dashboard;
    await dashboard.showTheoryHub();
    await flushPromises();

    const syncAllBtn = document.getElementById("theory-hub-sync-all-btn");
    expect(syncAllBtn).toBeTruthy();

    syncAllBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises(16);

    const calls = window.NotificationUI.toast.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [message] = calls[calls.length - 1];
    const topicPutCalls = global.fetch.mock.calls.filter(([input, init = {}]) => {
      const url = typeof input === "string" ? input : String(input?.url || "");
      const method = String(init?.method || "GET").toUpperCase();
      return method === "PUT" && url.includes("/api/editor/topic/");
    });

    expect(topicPutCalls).toHaveLength(1);
    expect(String(topicPutCalls[0][0])).toContain("/api/editor/topic/m1/t1/theory-link");
    expect(String(message)).toContain("Sync all");
    expect(String(message)).toContain("conflicts: 0");
  });
  it("starts theory-focused training and stores roundtrip bridge context", async () => {
    const dashboard = window.dashboard;
    await dashboard.showTheoryHub({ focusTheoryId: "th_a" });
    await flushPromises();

    const startBtn = document.querySelector('[data-action="hub-start-theory-training"][data-theory-id="th_a"]');
    expect(startBtn).toBeTruthy();

    startBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(window.navigateWithTransition).toHaveBeenCalledWith("/ui/session/sess_th_a");
    const rawBridge = window.sessionStorage.getItem("theory_training_bridge_v1:sess_th_a");
    expect(rawBridge).toBeTruthy();
    const bridge = JSON.parse(rawBridge);
    expect(bridge.theoryId).toBe("th_a");
    expect(bridge.theoryTitle).toBe("Theory A");
    expect(bridge.complexId).toBe("cx_ok");
    expect(bridge.returnUrl).toBe("/ui/editor?theory_hub=1&theory_id=th_a");
  });

  it("opens theory hub from deep-link query after catalog load", async () => {
    window.history.replaceState({}, "", "/ui/editor?theory_hub=1&theory_id=th_a");

    setupDomSkeleton();
    window.dashboard = undefined;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await flushPromises(16);

    const dashboard = window.dashboard;
    const modal = document.getElementById("theory-hub-modal");

    expect(dashboard).toBeDefined();
    expect(dashboard.theoryHubState.focusTheoryId).toBe("th_a");
    expect(modal.classList.contains("hidden")).toBe(false);
    expect(modal.classList.contains("flex")).toBe(true);
    expect(document.getElementById("theory-hub-impact").textContent).toContain("Theory A");
  });

  it("filters theory hub by ownership scope and keeps impact map consistent", async () => {
    const dashboard = window.dashboard;
    await dashboard.showTheoryHub({ focusTheoryId: "th_a" });
    await flushPromises();

    const ownershipEl = document.getElementById("theory-hub-ownership-filter");
    expect(ownershipEl).toBeTruthy();

    ownershipEl.value = "shared";
    ownershipEl.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    expect(document.getElementById("theory-hub-map").textContent).toContain("Topic 1");
    expect(document.getElementById("theory-hub-map").textContent).not.toContain("Topic 2");
    expect(document.getElementById("theory-hub-conflicts").textContent).not.toContain("Complex Conflict");
    expect(document.getElementById("theory-hub-impact").textContent).toContain("Complex OK");
    expect(document.getElementById("theory-hub-impact").textContent).not.toContain("Complex Conflict");
    expect(document.getElementById("theory-hub-summary").textContent).toContain("Общее");
    expect(document.getElementById("theory-hub-ownership-note").textContent).toContain("Общее");
  });
});
