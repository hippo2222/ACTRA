import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        exclude: [
            'node_modules/**',
            'BackupArchiveFiles/**',
            '.venv/**',
            // Untracked nested agent worktrees — not part of the active project
            'radioproject_git/**',
            // Playwright e2e suites share the *.test.mjs extension but run under
            // `npx playwright test` (see playwright.config.js), NOT vitest. Without
            // these excludes vitest sweeps them in and they fail en masse
            // (`@playwright/test` / `page` / `wt` not defined), which drowned out
            // real vitest regressions. Keep new browser e2e tests under
            // tests/complex_audit/ (or the theory-*/click_errors/debug_reload
            // names) so this stays a single, reliable signal.
            'tests/complex_audit/**',
            'tests/audit_suite/**',
            'tests/theory-*.test.mjs',
            'tests/click_errors_editor_audit.test.mjs',
            'tests/debug_reload.test.mjs',
        ]
    }
});
