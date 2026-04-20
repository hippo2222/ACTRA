import { defineConfig } from "@playwright/test";

const hostedGateFiles = [
  "complex_wave1_smoke.test.mjs",
  "complex_wave1_active_sessions.test.mjs",
  "complex_wave1_queue_pause_difficulty.test.mjs",
  "complex_wave1_queue_retry.test.mjs",
  "complex_wave1_reload.test.mjs",
  "complex_wave1_restart.test.mjs",
  "complex_wave1_flow_results.test.mjs",
  "complex_wave1_types.test.mjs",
  "complex_wave1_validation.test.mjs",
  "complex_wave1_propagation.test.mjs",
  "complex_wave2_types_levels.test.mjs",
  "complex_wave2_validation.test.mjs",
  "complex_wave2_adaptive.test.mjs",
  "complex_wave2_mechanics.test.mjs",
  "complex_wave2_main_entry.test.mjs",
  "complex_wave2_reload.test.mjs",
  "complex_wave2_flow_results.test.mjs",
  "complex_wave2_propagation.test.mjs",
  "complex_wave2_reentry_cancel.test.mjs",
];

export default defineConfig({
  testDir: "./tests/complex_audit",
  testMatch: hostedGateFiles,
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    video: "off",
  },
});
