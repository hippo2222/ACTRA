# ACTRA v1.0.0

## What's included

- Windows installer: `ACTRA-Setup.exe`
- Portable build: `ACTRA.exe` (from `dist/ACTRA/`)

## Release metadata

- Release date: 2026-03-03
- Build commit: `a6dbd0c`

## Packaging updates

- Added custom white icon embedding for `ACTRA.exe`.
- Added installer generation through Inno Setup in `scripts/build_release.py`.
- Added explicit Qt binding exclusions in build spec generation to avoid PyInstaller conflicts in mixed Qt environments.

## Checksums (SHA256)

- `ACTRA-Setup.exe`  
  `3EA96CCE826F02870149D86754D5143DB16B4680AB2E615344D0EA3189C20F2B`

- `ACTRA.exe`  
  `68072C300563256F56FF54A5E1A85ABF6F4CE0D03FEAF66AF31C57F26D245A61`

## Verification summary

- Release catalog validation passed (`modules=2`, `topics=2`, `tasks=6`, `complexes=2`, `theories=2`).
- Quality gates passed: frontend lint, `black --check`, `mypy`, `flake8`, full `pytest`.
- Portable build starts successfully.
- Silent installer install/start/uninstall smoke test completed successfully.

## Notes

- Installer is configured to ask for install directory (`DisableDirPage=no`, `UsePreviousAppDir=no`).
