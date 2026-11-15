#!/usr/bin/env python3
"""Sans-serif high-contrast large-text PNG for Argo iMessage (PIL / Arial Bold)."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"

# Color guidance (WCAG AAA aims for ≥7:1 normal / ≥4.5:1 large text;
# APH / VisionAware / Perkins: bold black on cream·ivory·yellow, or light on black).
# Ratios below are approximate WCAG relative-luminance contrast.
THEMES = {
    # ~19.7:1 — APH-style black print on cream/ivory paper (less glare than pure white)
    "dark-on-cream": {
        "bg": (255, 248, 220),  # cornsilk / warm paper
        "fg": (0, 0, 0),
        "muted": (55, 45, 25),
        "accent": (0, 0, 0),
    },
    # ~19.6:1 — classic low-vision black-on-yellow
    "black-on-yellow": {
        "bg": (255, 255, 0),
        "fg": (0, 0, 0),
        "muted": (40, 40, 0),
        "accent": (0, 0, 0),
    },
    # 21:1 — maximum luminance contrast
    "black-on-white": {
        "bg": (255, 255, 255),
        "fg": (0, 0, 0),
        "muted": (60, 60, 60),
        "accent": (0, 0, 0),
    },
    # ~15.5:1 — yellow on pure black (helps some with glare sensitivity)
    "yellow-on-black": {
        "bg": (0, 0, 0),
        "fg": (255, 235, 59),
        "muted": (200, 180, 40),
        "accent": (255, 235, 59),
    },
    # 21:1 — white on pure black
    "white-on-black": {
        "bg": (0, 0, 0),
        "fg": (255, 255, 255),
        "muted": (180, 180, 180),
        "accent": (255, 255, 255),
    },
    # alias
    "white-on-soft-black": {
        "bg": (0, 0, 0),
        "fg": (255, 255, 255),
        "muted": (180, 180, 180),
        "accent": (255, 235, 59),
    },
}

W = 900
PAD_X = 56
PAD_TOP = 72
PAD_BOT = 64
TITLE_SIZE = 40
BODY_SIZE = 60
LINE_GAP = 24
MAX_H = 1600


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def render_png(text: str, theme_name: str = "dark-on-cream") -> bytes:
    theme = THEMES.get(theme_name) or THEMES["dark-on-cream"]
    font_title = ImageFont.truetype(FONT_BOLD, TITLE_SIZE)
    font_body = ImageFont.truetype(FONT_BOLD, BODY_SIZE)
    font_meta = ImageFont.truetype(FONT_REG, 22)

    tmp = Image.new("RGB", (W, 100), theme["bg"])
    d = ImageDraw.Draw(tmp)
    max_w = W - PAD_X * 2

    blocks: list[str] = []
    body = (text or "").strip() or "(no text)"
    for para in body.split("\n"):
        para = para.strip()
        if not para:
            continue
        blocks.extend(wrap(d, para, font_body, max_w))
        blocks.append("")
    while blocks and blocks[-1] == "":
        blocks.pop()

    line_h = BODY_SIZE + LINE_GAP
    content_h = 0
    for b in blocks:
        content_h += (LINE_GAP // 2) if b == "" else line_h

    h = min(MAX_H, PAD_TOP + 70 + content_h + PAD_BOT)
    img = Image.new("RGB", (W, h), theme["bg"])
    draw = ImageDraw.Draw(img)

    draw.rectangle([0, 0, W, 10], fill=theme["accent"])
    draw.text((PAD_X, 28), "ARGO READ", font=font_title, fill=theme["accent"])

    y = PAD_TOP + 20
    for b in blocks:
        if b == "":
            y += LINE_GAP // 2
            continue
        if y + line_h > h - PAD_BOT:
            draw.text((PAD_X, y), "… (more in next message)", font=font_body, fill=theme["muted"])
            break
        draw.text((PAD_X, y), b, font=font_body, fill=theme["fg"])
        y += line_h

    footer = "Pinch to zoom in Messages"
    fw = draw.textlength(footer, font=font_meta)
    draw.text(((W - fw) / 2, h - 40), footer, font=font_meta, fill=theme["muted"])

    from io import BytesIO

    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--theme", default=os.environ.get("MAGNIFIER_THEME", "dark-on-cream"))
    parser.add_argument("--out", required=True)
    parser.add_argument("text", nargs="?", default="")
    args = parser.parse_args()
    text = args.text
    if not text and not sys.stdin.isatty():
        text = sys.stdin.read()
    png = render_png(text, args.theme)
    Path(args.out).write_bytes(png)
    print(args.out, len(png), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
