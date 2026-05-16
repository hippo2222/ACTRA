/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

describe("SessionFlow.handleNextTaskCompletion", () => {
  let SessionFlow;

  beforeEach(() => {
    // CommonJS module export
    SessionFlow = require("../frontend/S1/session_flow.js");
  });

  it("redirects to final results when status is 410", () => {
    const redirect = vi.fn();
    const res = SessionFlow.handleNextTaskCompletion({
      sessionId: "abc",
      status: 410,
      response: { ok: false, error: "session_completed" },
      redirect,
    });

    expect(res.handled).toBe(true);
    expect(res.action).toBe("redirect_final_results");
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/session/abc/results");
  });

  it("redirects to final results when response.error is session_completed", () => {
    const redirect = vi.fn();
    const res = SessionFlow.handleNextTaskCompletion({
      sessionId: "abc",
      status: 200,
      response: { ok: false, error: "session_completed" },
      redirect,
    });

    expect(res.handled).toBe(true);
    expect(redirect).toHaveBeenCalledWith("/session/abc/results");
  });

  it("does not redirect when response is ok", () => {
    const redirect = vi.fn();
    const res = SessionFlow.handleNextTaskCompletion({
      sessionId: "abc",
      status: 200,
      response: { ok: true, task: { task_id: "t1" } },
      redirect,
    });

    expect(res.handled).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does not redirect for other errors", () => {
    const redirect = vi.fn();
    const res = SessionFlow.handleNextTaskCompletion({
      sessionId: "abc",
      status: 400,
      response: { ok: false, error: "task_not_found" },
      redirect,
    });

    expect(res.handled).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });
});
