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
      error: "Сервер вернул ошибку (502)",
    });
  });
});
