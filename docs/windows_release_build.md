# Windows Release Build

This project now supports two release artifacts:

- Portable app folder: `dist/ACTRA/`
- Optional installer: `dist/ACTRA-Setup.exe`

## Prerequisites

- Python with project dependencies
- PyInstaller:
  - `pip install pyinstaller`
- Optional for installer build:
  - Inno Setup 6 (`ISCC.exe`)

## Build Commands

- Portable only:
  - `python scripts/build_release.py`
- Portable + installer:
  - `python scripts/build_release.py --installer`

## Icon Handling

`build_release.py` supports embedding a `.ico` in both `ACTRA.exe` and installer.

- Default icon path (if exists): `frontend/assets/actra_white.ico`
- Custom icon:
  - `python scripts/build_release.py --icon path\\to\\icon.ico`
- Disable icon embedding:
  - `python scripts/build_release.py --no-icon`

## Generate White Icon From SVG

Use this helper if you update `frontend/assets/logo.svg`:

- `python scripts/generate_white_icon.py`

It renders a white variant of the logo with transparent background and writes:

- `frontend/assets/actra_white.ico`

## Installer Path Selection

When built with `--installer`, setup shows directory selection explicitly:

- Inno script has `DisableDirPage=no`
- Inno script has `UsePreviousAppDir=no`

So the user can choose install path every time.
