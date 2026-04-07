/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const scriptCode = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/S1/api-client.js"),
  "utf8"
);

function loadSessionApi() {
  delete window.SessionAPI;
  window.eval(scriptCode);
  return window.SessionAPI;
}

describe("SessionAPI contract", () => {
  beforeEach(() => {
    window.SessionRoutes = {
      API: {
        GET_TASK: (sessionId) => `/api/session/${sessionId}/task`,
        SAVE_UI_STATE: (sessionId) => `/api/session/${sessionId}/ui-state`,
        PAUSE: (sessionId) => `/api/session/${sessionId}/pause`,
        RESUME: (sessionId) => `/api/session/${sessionId}/resume`,
        CANCEL: (sessionId) => `/api/session/${sessionId}/cancel`,
      },
    };
    global.fetch = vi.fn();
  });

  it("preserves HTTP status when server returns non-JSON body", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue("<html>bad gateway</html>"),
    });

    const SessionAPI = loadSessionApi();
    const result = await SessionAPI.getCurrentTask("abc");

    expect(result.status).toBe(502);
    expect(result.data).toEqual({
      ok: false,
      error: "\u0421\u0435\u0440\u0432\u0435\u0440 \u0432\u0435\u0440\u043d\u0443\u043b \u043e\u0448\u0438\u0431\u043a\u0443 (502)",
    });
  });

  it("posts autosave ui-state payload to the dedicated endpoint", async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, saved: true })),
    });

    const SessionAPI = loadSessionApi();
    const payload = {
      task_ref: "m1/t1/task-1",
      task_index: 0,
      user_input: { answer: "draft" },
      view_state: { scrollTop: 24 },
    };

    const result = await SessionAPI.saveTaskUiState("abc", payload);

    expect(fetch).toHaveBeenCalledWith(
      "/api/session/abc/ui-state",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true, saved: true });
  });

  it("attaches explicit user_id to pause payload before sending it", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({ ok: true, user: { user_id: "audit_user" } })
        ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, paused: true })),
      });

    const SessionAPI = loadSessionApi();
    const payload = {
      task_ref: "m1/t1/task-1",
      task_index: 0,
      user_input: { answer: "draft" },
    };

    const result = await SessionAPI.pauseSession("session_audit_user_123", payload);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/users/current",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/session/session_audit_user_123/pause",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          user_id: "audit_user",
        }),
      })
    );
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true, paused: true });
  });

  it("falls back to user_id inferred from session id when current user lookup fails", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue(JSON.stringify({ ok: false, error: "boom" })),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, paused: false })),
      });

    const SessionAPI = loadSessionApi();
    const result = await SessionAPI.resumeSession("session_user_3506210d420d_1774586020.271989");

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/session/session_user_3506210d420d_1774586020.271989/resume",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: "user_3506210d420d",
        }),
      })
    );
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true, paused: false });
  });
});
