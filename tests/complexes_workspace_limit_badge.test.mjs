import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const complexesIndexHtml = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/Complexes/index.html"),
  "utf8"
);

describe("Complexes workspace limit badge", () => {
  it("renders a dedicated breadcrumb badge host for complex limits", () => {
    expect(complexesIndexHtml).toContain('id="complex-library-limit-badge"');
    expect(complexesIndexHtml).toContain("cx-toolbar-main");
    expect(complexesIndexHtml).toContain("cx-breadcrumb-limit");
  });

  it("loads workspace limit summary for the complexes page", () => {
    expect(complexesIndexHtml).toContain('fetch("/api/workspace-limits/summary"');
    expect(complexesIndexHtml).toContain("renderComplexLibraryLimitBadge");
    expect(complexesIndexHtml).toContain("fetchComplexWorkspaceLimits()");
  });
});
