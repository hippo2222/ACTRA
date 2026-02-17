#!/usr/bin/env python3
"""
Generate a white Windows .ico from frontend/assets/logo.svg.

Pipeline:
1) Render inline SVG in headless Chrome with white currentColor.
2) Save PNG with transparent background.
3) Convert PNG to multi-size ICO using Pillow.
"""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SVG = PROJECT_ROOT / "frontend" / "assets" / "logo.svg"
DEFAULT_OUTPUT = PROJECT_ROOT / "frontend" / "assets" / "actra_white.ico"

ICON_SIZES = [(256, 256), (128, 128), (96, 96), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate white ACTRA .ico from SVG")
    parser.add_argument("--svg", type=Path, default=DEFAULT_SVG, help=f"Source SVG (default: {DEFAULT_SVG})")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output .ico (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--chrome",
        type=Path,
        default=None,
        help="Optional path to chrome.exe / msedge.exe for headless render",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=1024,
        help="Intermediate render size in px (default: 1024)",
    )
    return parser.parse_args()


def find_browser(explicit: Path | None) -> Path | None:
    if explicit is not None and explicit.exists():
        return explicit

    candidates = [
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Users\%USERNAME%\AppData\Local\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    ]

    for candidate in candidates:
        expanded = Path(str(candidate).replace("%USERNAME%", str(Path.home().name)))
        if expanded.exists():
            return expanded

    return None


def render_svg_to_png(svg_text: str, png_path: Path, browser_path: Path, size: int) -> None:
    html = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
html, body {{
  margin: 0;
  width: 100%;
  height: 100%;
  background: transparent;
}}
body {{
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  overflow: hidden;
}}
svg {{
  width: 92%;
  height: 92%;
}}
</style>
</head>
<body>
{svg_text}
</body>
</html>
"""

    with tempfile.TemporaryDirectory(prefix="actra-icon-render-") as tmp_dir:
        tmp_path = Path(tmp_dir)
        html_path = tmp_path / "icon_render.html"
        html_path.write_text(html, encoding="utf-8")

        cmd = [
            str(browser_path),
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            f"--window-size={size},{size}",
            "--default-background-color=00000000",
            f"--screenshot={png_path}",
            html_path.resolve().as_uri(),
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(
                "Browser render failed.\n"
                f"Command: {' '.join(cmd)}\n"
                f"STDOUT: {result.stdout}\n"
                f"STDERR: {result.stderr}"
            )

    if not png_path.exists():
        raise RuntimeError(f"PNG was not created: {png_path}")


def convert_png_to_ico(png_path: Path, ico_path: Path) -> None:
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(png_path) as image:
        rgba = image.convert("RGBA")
        rgba.save(ico_path, format="ICO", sizes=ICON_SIZES)


def main() -> None:
    args = parse_args()

    svg_path = args.svg if args.svg.is_absolute() else (PROJECT_ROOT / args.svg)
    output_path = args.output if args.output.is_absolute() else (PROJECT_ROOT / args.output)

    if not svg_path.exists():
        raise FileNotFoundError(f"SVG not found: {svg_path}")

    browser = find_browser(args.chrome)
    if browser is None:
        raise RuntimeError(
            "No Chromium browser found. Install Chrome/Edge or pass --chrome <path-to-exe>."
        )

    svg_text = svg_path.read_text(encoding="utf-8")

    with tempfile.TemporaryDirectory(prefix="actra-icon-") as tmp_dir:
        tmp_png = Path(tmp_dir) / "actra_white.png"
        render_svg_to_png(svg_text, tmp_png, browser, args.size)
        convert_png_to_ico(tmp_png, output_path)

    print(f"White icon generated: {output_path}")


if __name__ == "__main__":
    main()
