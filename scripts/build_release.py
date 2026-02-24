#!/usr/bin/env python3
"""
ACTRA release build script for Windows.

Default output:
    dist/ACTRA/ACTRA.exe (portable folder build)

Optional output:
    dist/ACTRA-Setup.exe (Inno Setup installer)
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

APP_NAME = "ACTRA"
APP_VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DIST_DIR = PROJECT_ROOT / "dist"
BUILD_DIR = PROJECT_ROOT / "build"
SPEC_FILE = PROJECT_ROOT / f"{APP_NAME}.spec"
CATALOG_VALIDATOR = SCRIPT_DIR / "validate_release_catalog.py"
DEFAULT_ICON_FILE = PROJECT_ROOT / "frontend" / "assets" / "actra_white.ico"
INSTALLER_ISS_FILE = BUILD_DIR / f"{APP_NAME}_installer.iss"
INSTALLER_OUTPUT_NAME = f"{APP_NAME}-Setup"

# Directories to bundle as data
DATA_DIRS = [
    ("frontend", "frontend"),
    ("common", "common"),
    ("task_system", "task_system"),
    ("desktop-app/api", "desktop-app/api"),
    ("desktop-app/logic", "desktop-app/logic"),
    ("desktop-app/services", "desktop-app/services"),
    ("desktop-app/tools", "desktop-app/tools"),
]

DATA_FILES = [
    ("config.json", "."),
    ("desktop-app/server.py", "desktop-app"),
]


def _path_for_spec(path: Path) -> str:
    return str(path).replace("\\", "/")


def _path_for_iss(path: Path) -> str:
    return str(path).replace("\\", "\\\\")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build ACTRA release artifacts")
    parser.add_argument(
        "--installer",
        action="store_true",
        help="Also build Inno Setup installer (dist/ACTRA-Setup.exe).",
    )
    parser.add_argument(
        "--icon",
        default=str(DEFAULT_ICON_FILE) if DEFAULT_ICON_FILE.exists() else None,
        help=(
            "Path to .ico used for ACTRA.exe and installer icon. "
            "Defaults to frontend/assets/actra_white.ico if present."
        ),
    )
    parser.add_argument(
        "--no-icon",
        action="store_true",
        help="Disable custom icon embedding.",
    )
    return parser.parse_args()


def resolve_icon_path(icon_arg: str | None, no_icon: bool) -> Path | None:
    if no_icon or not icon_arg:
        return None

    icon_path = Path(icon_arg)
    if not icon_path.is_absolute():
        icon_path = PROJECT_ROOT / icon_path
    icon_path = icon_path.resolve()

    if not icon_path.exists():
        print(f"WARNING: Icon file not found: {icon_path}")
        print("         Build will continue without custom icon.")
        return None

    if icon_path.suffix.lower() != ".ico":
        print(f"WARNING: Icon must be .ico for Windows executable: {icon_path}")
        print("         Build will continue without custom icon.")
        return None

    return icon_path


def check_pyinstaller() -> bool:
    """Checks whether PyInstaller is installed."""
    try:
        import PyInstaller  # type: ignore[import-untyped] # noqa: F401

        return True
    except ImportError:
        print("ERROR: PyInstaller is not installed.")
        print("Install: pip install pyinstaller")
        return False


def clean_build() -> None:
    """Removes previous build artifacts."""
    for d in [DIST_DIR, BUILD_DIR]:
        if d.exists():
            print(f"  Cleaning {d}...")
            shutil.rmtree(d, ignore_errors=True)


def run_release_catalog_validation() -> bool:
    """Fail-fast validation of release catalog integrity."""
    if not CATALOG_VALIDATOR.exists():
        print(f"ERROR: Catalog validator not found: {CATALOG_VALIDATOR}")
        return False

    cmd = [
        sys.executable,
        str(CATALOG_VALIDATOR),
        "--data-dir",
        str(PROJECT_ROOT / "data"),
        "--require-non-demo",
    ]
    print(f"  Validating release catalog: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT))
    if result.returncode != 0:
        print("ERROR: Release catalog validation failed.")
        return False
    return True


def create_release_data_bundle() -> None:
    """Copy validated release catalog into dist/ACTRA/data."""
    app_dir = DIST_DIR / APP_NAME
    release_data = app_dir / "data"
    source_data = PROJECT_ROOT / "data"

    if release_data.exists():
        shutil.rmtree(release_data, ignore_errors=True)
    release_data.mkdir(parents=True, exist_ok=True)

    # Copy curated learning content.
    source_modules = source_data / "modules"
    source_complexes = source_data / "complexes"
    if not source_modules.exists():
        raise RuntimeError(f"Missing source modules directory: {source_modules}")
    if not source_complexes.exists():
        raise RuntimeError(f"Missing source complexes directory: {source_complexes}")

    shutil.copytree(source_modules, release_data / "modules", dirs_exist_ok=True)
    shutil.copytree(source_complexes, release_data / "complexes", dirs_exist_ok=True)

    # Ship bundled default avatars (if present).
    source_avatars = source_data / "avatars"
    if source_avatars.exists():
        shutil.copytree(source_avatars, release_data / "avatars", dirs_exist_ok=True)
    else:
        (release_data / "avatars").mkdir(parents=True, exist_ok=True)

    # Runtime directories must start empty (except bundled avatars above).
    runtime_dirs = [
        release_data / "users",
        release_data / "images",
        release_data / "user_calendar",
        release_data / "feedback" / "tickets",
        release_data / "import_manifests",
        release_data / "system",
    ]
    for d in runtime_dirs:
        d.mkdir(parents=True, exist_ok=True)

    # Keep essential static config.
    src_difficulty = source_data / "difficulty_config.json"
    if src_difficulty.exists():
        shutil.copy2(src_difficulty, release_data / "difficulty_config.json")
    src_update_manifest = source_data / "system" / "update_manifest.json"
    if src_update_manifest.exists():
        shutil.copy2(src_update_manifest, release_data / "system" / "update_manifest.json")

    # Drop mutable history from shipped content.
    history_dir = release_data / "complexes" / "history"
    if history_dir.exists():
        shutil.rmtree(history_dir, ignore_errors=True)
    history_dir.mkdir(parents=True, exist_ok=True)

    print(f"  Release data bundle created in {release_data}")


def build_spec_content(icon_path: Path | None = None) -> str:
    """Generate ACTRA.spec content for PyInstaller."""
    datas_lines = []
    for src, dest in DATA_DIRS:
        src_path = _path_for_spec(PROJECT_ROOT / src)
        datas_lines.append(f"    (r'{src_path}', '{dest}'),")
    for src, dest in DATA_FILES:
        src_path = _path_for_spec(PROJECT_ROOT / src)
        datas_lines.append(f"    (r'{src_path}', '{dest}'),")

    datas_str = "\n".join(datas_lines)
    icon_line = f"    icon=r'{_path_for_spec(icon_path)}'," if icon_path else ""

    return f"""# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for ACTRA
# Generated by scripts/build_release.py

import sys
from pathlib import Path

block_cipher = None

PROJECT_ROOT = r'{_path_for_spec(PROJECT_ROOT)}'

a = Analysis(
    [PROJECT_ROOT + '/desktop-app/webview_launcher.py'],
    pathex=[
        PROJECT_ROOT,
        PROJECT_ROOT + '/desktop-app',
    ],
    binaries=[],
    datas=[
{datas_str}
    ],
    hiddenimports=[
        'flask',
        'flask.json',
        'werkzeug',
        'werkzeug.serving',
        'werkzeug.utils',
        'webview',
        'webview.platforms.winforms',
        'clr_loader',
        'pythonnet',
        'pydantic',
        'pydantic.deprecated',
        'pydantic.deprecated.decorator',
        'bcrypt',
        'PIL',
        'PIL.Image',
        'Levenshtein',
        'pymorphy2',
        'pymorphy2.units',
        'packaging',
        'task_system',
        'task_system.core',
        'task_system.types',
        'task_system.models',
        'common',
        'common.config_loader',
        'common.extension_points_config',
        'common.watchdog',
        'services',
        'logic',
        'api',
        'api.session_api',
        'api.calendar_api',
        'api.complexes_api',
    ],
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'scipy',
        'pandas',
        'numpy',
        'IPython',
        'jupyter',
        'notebook',
        # Force non-Qt packaging path (pywebview WinForms on Windows).
        'qtpy',
        'PyQt5',
        'PyQt5.QtCore',
        'PyQt5.QtGui',
        'PyQt5.QtWidgets',
        'PyQt5.QtWebEngineCore',
        'PyQt5.QtWebEngineWidgets',
        'PyQt6',
        'PyQt6.QtCore',
        'PyQt6.QtGui',
        'PyQt6.QtWidgets',
        'PyQt6.QtWebEngineCore',
        'PyQt6.QtWebEngineWidgets',
        'PySide2',
        'PySide6',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ACTRA',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
{icon_line}
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='ACTRA',
)
"""


def run_build(icon_path: Path | None) -> bool:
    """Run PyInstaller build."""
    spec_content = build_spec_content(icon_path)
    with open(SPEC_FILE, "w", encoding="utf-8") as f:
        f.write(spec_content)
    print(f"  Spec file created: {SPEC_FILE}")

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        str(SPEC_FILE),
    ]
    print(f"  Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT))

    if result.returncode != 0:
        print(f"\nERROR: PyInstaller failed with code {result.returncode}")
        return False
    return True


def post_build() -> bool:
    """Post-build steps: data bundle and config copy."""
    app_dir = DIST_DIR / APP_NAME
    if not app_dir.exists():
        print(f"ERROR: Directory {app_dir} was not created")
        return False

    create_release_data_bundle()

    config_src = PROJECT_ROOT / "config.json"
    if config_src.exists():
        shutil.copy2(config_src, app_dir / "config.json")

    print(f"\n{'='*60}")
    print("  PORTABLE BUILD COMPLETED")
    print(f"  Output: {app_dir}")
    print(f"  Run: {app_dir / f'{APP_NAME}.exe'}")
    print(f"{'='*60}")
    return True


def find_inno_compiler() -> Path | None:
    """Locate ISCC.exe (Inno Setup compiler)."""
    candidates: list[Path] = []
    from_path = shutil.which("iscc")
    if from_path:
        candidates.append(Path(from_path))

    candidates.extend(
        [
            Path(r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"),
            Path(r"C:\Program Files\Inno Setup 6\ISCC.exe"),
        ]
    )

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def build_inno_script_content(app_dir: Path, output_dir: Path, icon_path: Path | None) -> str:
    """Generate Inno Setup .iss script content."""
    lines = [
        f'#define SourceDir "{_path_for_iss(app_dir)}"',
        f'#define OutputDir "{_path_for_iss(output_dir)}"',
        "",
        "[Setup]",
        "AppId={{7A5D483E-E5E8-4BC9-A2A6-4EA72B8E17E7}",
        f"AppName={APP_NAME}",
        f"AppVersion={APP_VERSION}",
        f"AppPublisher={APP_NAME}",
        "DefaultDirName={localappdata}\\ACTRA",
        "DefaultGroupName=ACTRA",
        "DisableDirPage=no",
        "UsePreviousAppDir=no",
        "DisableProgramGroupPage=yes",
        "OutputDir={#OutputDir}",
        f"OutputBaseFilename={INSTALLER_OUTPUT_NAME}",
        "Compression=lzma2",
        "SolidCompression=yes",
        "WizardStyle=modern",
        "PrivilegesRequired=lowest",
        "ArchitecturesAllowed=x64compatible",
        "ArchitecturesInstallIn64BitMode=x64compatible",
        "UninstallDisplayIcon={app}\\ACTRA.exe",
    ]

    if icon_path:
        lines.append(f"SetupIconFile={_path_for_iss(icon_path)}")

    lines.extend(
        [
            "",
            "[Languages]",
            'Name: "english"; MessagesFile: "compiler:Default.isl"',
            'Name: "russian"; MessagesFile: "compiler:Languages\\Russian.isl"',
            "",
            "[Tasks]",
            'Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked',
            "",
            "[Files]",
            'Source: "{#SourceDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs',
            "",
            "[Icons]",
            'Name: "{autoprograms}\\ACTRA"; Filename: "{app}\\ACTRA.exe"',
            'Name: "{autodesktop}\\ACTRA"; Filename: "{app}\\ACTRA.exe"; Tasks: desktopicon',
            "",
            "[Run]",
            'Filename: "{app}\\ACTRA.exe"; Description: "Launch ACTRA"; Flags: nowait postinstall skipifsilent',
            "",
        ]
    )

    return "\n".join(lines)


def build_installer(icon_path: Path | None) -> bool:
    """Build Windows installer with Inno Setup."""
    app_dir = DIST_DIR / APP_NAME
    if not app_dir.exists():
        print(f"ERROR: Portable app directory not found: {app_dir}")
        return False

    iscc = find_inno_compiler()
    if not iscc:
        print("ERROR: Inno Setup compiler (iscc/ISCC.exe) not found.")
        print("Install Inno Setup 6: https://jrsoftware.org/isinfo.php")
        return False

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    iss_content = build_inno_script_content(app_dir, DIST_DIR, icon_path)
    INSTALLER_ISS_FILE.write_text(iss_content, encoding="utf-8")
    print(f"  Installer script created: {INSTALLER_ISS_FILE}")

    cmd = [str(iscc), str(INSTALLER_ISS_FILE)]
    print(f"  Running installer build: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT))
    if result.returncode != 0:
        print(f"ERROR: Inno Setup build failed with code {result.returncode}")
        return False

    installer_file = DIST_DIR / f"{INSTALLER_OUTPUT_NAME}.exe"
    if installer_file.exists():
        print(f"  Installer created: {installer_file}")
    else:
        print("WARNING: Inno Setup finished, but installer file was not found in dist/")

    return True


def main() -> None:
    args = parse_args()
    icon_path = resolve_icon_path(args.icon, args.no_icon)

    print("=" * 60)
    print(f"  {APP_NAME} release build")
    print("=" * 60)

    print("\n[0/5] Validating release catalog...")
    if not run_release_catalog_validation():
        sys.exit(1)

    if not check_pyinstaller():
        sys.exit(1)

    print("\n[1/5] Cleaning previous build...")
    clean_build()

    print("\n[2/5] Generating spec file...")
    print(f"  Icon: {icon_path if icon_path else 'none'}")

    print("\n[3/5] Building PyInstaller executable...")
    if not run_build(icon_path):
        sys.exit(1)

    print("\n[4/5] Post-build (data bundle + config)...")
    if not post_build():
        sys.exit(1)

    if args.installer:
        print("\n[5/5] Building installer (.exe)...")
        if not build_installer(icon_path):
            sys.exit(1)
    else:
        print("\n[5/5] Installer step skipped (use --installer to enable).")


if __name__ == "__main__":
    main()
