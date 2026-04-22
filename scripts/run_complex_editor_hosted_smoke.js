const { spawnSync } = require("child_process");

function runStep(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runStep("pytest", [
  "tests/test_hosted_complex_service.py",
  "tests/test_complex_editor_hosted_gate.py",
  "-q",
  "--cov-fail-under=0",
]);

runStep("npx", ["vitest", "run", "tests/complex_autosave_manager.test.mjs"]);
