# ACTRA v1.0.0 (Draft)

## What's included

- Windows installer: `ACTRA-Setup.exe`
- Portable build: `ACTRA.exe` (from `dist/ACTRA/`)

## Packaging updates

- Added custom white icon embedding for `ACTRA.exe`.
- Added installer generation through Inno Setup in `scripts/build_release.py`.
- Added explicit Qt binding exclusions in build spec generation to avoid PyInstaller conflicts in mixed Qt environments.

## Checksums (SHA256)

- `ACTRA-Setup.exe`  
  `F7216970D5F6964B38C9A22090F060B4926E57724A70D9C58CE61FE7A637949F`

- `ACTRA.exe`  
  `C1E4F950E48B905782DFA69699402523DDCE8FA626496B9769D0A217B9B62B25`

## Notes

- Build date: 2026-02-17.
- Installer is configured to ask for install directory (`DisableDirPage=no`, `UsePreviousAppDir=no`).

