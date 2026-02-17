#!/usr/bin/env python3
"""
Скрипт очистки проекта от dev-артефактов перед релизом.

Использование:
    python scripts/clean_for_release.py          # Dry-run (только показывает что удалит)
    python scripts/clean_for_release.py --apply   # Реальное удаление

Безопасен: по умолчанию работает в режиме dry-run.
"""

import argparse
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Файлы/директории для удаления из корня проекта
# ---------------------------------------------------------------------------

ROOT_FILES_TO_DELETE = [
    # Одноразовые скрипты-фиксы
    "add_chains_logic.py",
    "fix_encoding.py",
    "fix_mojibake_v2.py",
    "fix_mojibake_v3.py",
    "optimize_layout.py",
    "refactor_layout.py",
    "run_sequence_tests.py",
    # Бэкапы и отладочные файлы
    "createbackup.html",
    "debug_input.css",
    "debug_tailwind.config.js",
    "image_map.json",
    "recommendations.md",
    "build_debug.log",
    "build_error.log",
    "test_output.txt",
    # Coverage артефакты
    "coverage.xml",
    ".coverage",
    "desktop-app/coverage.xml",
    "desktop-app/.coverage",
]

ROOT_DIRS_TO_DELETE = [
    ".pytest_cache",
    ".pytest_tmp",
]

# ---------------------------------------------------------------------------
# Frontend debug файлы
# ---------------------------------------------------------------------------

FRONTEND_FILES_TO_DELETE = [
    "frontend/test_tailwind_debug.html",
    "frontend/assets/ThemeDebug.js",
    "frontend/UI_AUDIT_MANUAL.md",
]

# ---------------------------------------------------------------------------
# Тестовые артефакты в tests/
# ---------------------------------------------------------------------------

TEST_ARTIFACTS_TO_DELETE = [
    "tests/reproduce_issue.py",
    "tests/repro_log.txt",
    "tests/error_report.txt",
    "tests/verify_output.txt",
    "tests/verify_statistics.py",
    "tests/verify_statistics_deep.py",
    "tests/run_all_integration_tests_7_1_7_2.py",
    "tests/run_all_tests.py",
    "tests/run_tests.bat",
]

# ---------------------------------------------------------------------------
# Тестовые данные в data/
# ---------------------------------------------------------------------------

DATA_DIRS_TO_DELETE = []

# Директории, содержимое которых нужно ПОЛНОСТЬЮ очистить (но сохранить саму папку).
# ВАЖНО: учебный каталог (data/modules, data/complexes, data/complexes/theories)
# не очищаем автоматически — это релизный контент.
DATA_DIRS_TO_WIPE_CONTENTS = [
    "data/images",
    "data/complexes/history",
    "data/avatars",
    "data/users",
    "data/user_calendar",
    "data/feedback/tickets",
    "data/import_manifests",
]

DATA_FILES_TO_DELETE = [
    "data/complexes/nonexistent.autosave.json",
    "data/app_state.json",
]

# Паттерны в data/ для удаления
DATA_GLOB_PATTERNS = [
    "data/**/*.backup",
    "data/**/*.backup_abs_paths",
]


def collect_targets(root: Path):
    """Собирает все файлы/директории для удаления."""
    targets = []
    seen = set()

    def add_target(kind: str, path: Path) -> None:
        key = (kind, str(path.resolve()))
        if key in seen:
            return
        seen.add(key)
        targets.append((kind, path))

    for rel in (
        ROOT_FILES_TO_DELETE
        + FRONTEND_FILES_TO_DELETE
        + TEST_ARTIFACTS_TO_DELETE
        + DATA_FILES_TO_DELETE
    ):
        p = root / rel
        if p.exists():
            add_target("file", p)

    for rel in ROOT_DIRS_TO_DELETE + DATA_DIRS_TO_DELETE:
        p = root / rel
        if p.exists():
            add_target("dir", p)

    # Полная очистка пользовательских данных для релиза
    for rel_dir in DATA_DIRS_TO_WIPE_CONTENTS:
        wipe_dir = root / rel_dir
        if wipe_dir.exists():
            for child in wipe_dir.iterdir():
                if child.is_dir():
                    add_target("dir", child)
                else:
                    add_target("file", child)

    # Autosave файлы в data/
    for p in root.glob("data/**/*.autosave.json"):
        add_target("file", p)

    # Glob patterns
    for pattern in DATA_GLOB_PATTERNS:
        for p in root.glob(pattern):
            add_target("file", p)

    # __pycache__ directories
    for p in root.rglob("__pycache__"):
        if "node_modules" not in str(p) and ".venv" not in str(p):
            add_target("dir", p)

    return targets


def main():
    parser = argparse.ArgumentParser(description="Очистка проекта от dev-артефактов")
    parser.add_argument(
        "--apply", action="store_true", help="Реально удалить файлы (без этого флага — dry-run)"
    )
    args = parser.parse_args()

    targets = collect_targets(PROJECT_ROOT)

    if not targets:
        print("Нечего удалять — проект чист.")
        return

    mode = "УДАЛЕНИЕ" if args.apply else "DRY-RUN (добавьте --apply для удаления)"
    print(f"\n{'='*60}")
    print(f"  Очистка проекта — {mode}")
    print(f"{'='*60}\n")

    total_size = 0
    for kind, path in sorted(targets, key=lambda x: str(x[1])):
        rel = path.relative_to(PROJECT_ROOT)
        if kind == "dir":
            size = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        else:
            size = path.stat().st_size if path.is_file() else 0
        total_size += size
        size_str = f"{size / 1024:.1f}KB" if size > 0 else ""
        marker = "[DIR] " if kind == "dir" else "[FILE]"
        print(f"  {marker} {rel}  {size_str}")

        if args.apply:
            try:
                if kind == "dir":
                    shutil.rmtree(path)
                else:
                    path.unlink()
            except Exception as e:
                print(f"    ERROR: {e}")

    print(f"\n  Итого: {len(targets)} объектов, ~{total_size / 1024:.0f}KB")
    if not args.apply:
        print("\n  Это dry-run. Для удаления запустите:")
        print("    python scripts/clean_for_release.py --apply")


if __name__ == "__main__":
    main()
