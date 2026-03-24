#!/usr/bin/env python3
"""
Resize PNG/JPEG screenshots to Apple App Store 6.5" portrait size.

Valid sizes include 1284 × 2778 (this script uses that).

Usage:
  python scripts/resize_ios_appstore_screenshots.py input_dir output_dir
  python scripts/resize_ios_appstore_screenshots.py a.png b.png out/

Strategy: scale up so the image fully covers the target, then center-crop.
This preserves aspect ratio and avoids letterboxing (Apple wants exact pixels).
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as e:
    raise SystemExit("Install Pillow: pip install Pillow") from e

TARGET_W = 1284
TARGET_H = 2778


def resize_cover_to_target(img: Image.Image) -> Image.Image:
    w, h = img.size
    if w <= 0 or h <= 0:
        raise ValueError("Invalid image size")
    scale = max(TARGET_W / w, TARGET_H / h)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - TARGET_W) // 2
    top = (nh - TARGET_H) // 2
    return img.crop((left, top, left + TARGET_W, top + TARGET_H))


def main() -> None:
    args = [a for a in sys.argv[1:] if a]
    if len(args) < 2:
        print(
            __doc__.strip(),
            file=sys.stderr,
        )
        raise SystemExit(2)

    out_arg = Path(args[-1])
    inputs = [Path(p) for p in args[:-1]]

    if len(inputs) == 1 and inputs[0].is_dir():
        in_dir = inputs[0]
        out_dir = out_arg
        out_dir.mkdir(parents=True, exist_ok=True)
        files = sorted(
            list(in_dir.glob("*.png"))
            + list(in_dir.glob("*.jpg"))
            + list(in_dir.glob("*.jpeg"))
            + list(in_dir.glob("*.PNG"))
        )
        if not files:
            raise SystemExit(f"No images found in {in_dir}")
        for f in files:
            process_file(f, out_dir / f.name)
        print(f"Wrote {len(files)} file(s) to {out_dir}")
        return

    # Multiple file args: last is output dir
    out_dir = out_arg
    if not out_dir.exists():
        out_dir.mkdir(parents=True, exist_ok=True)
    elif not out_dir.is_dir():
        raise SystemExit(f"Output must be a directory: {out_dir}")

    for f in inputs:
        if not f.is_file():
            raise SystemExit(f"Not a file: {f}")
        process_file(f, out_dir / f.name)
    print(f"Wrote {len(inputs)} file(s) to {out_dir}")


def process_file(src: Path, dest: Path) -> None:
    img = Image.open(src)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    out = resize_cover_to_target(img)
    if out.mode == "RGBA":
        bg = Image.new("RGB", out.size, (255, 255, 255))
        bg.paste(out, mask=out.split()[3])
        out = bg
    else:
        out = out.convert("RGB")
    dest = dest.with_suffix(".png")
    out.save(dest, "PNG", optimize=True)
    print(f"{src.name} -> {dest.name} ({TARGET_W}x{TARGET_H})")


if __name__ == "__main__":
    main()
