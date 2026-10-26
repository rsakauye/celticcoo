#!/usr/bin/env python3
"""Wince frame for the drone tuner, laid over the standing Ceilidh sprite.

Same 64x64 grid and colours as scripts/make_ceilidh_coo.py. This does not
edit the dance strip (that file stays 640x64). Hooves sit on her ears, her
eyes close, and the smile turns down. Transparent everywhere else.

    python3 scripts/make_ceilidh_ears.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_PATH = os.path.join(ROOT, "site", "public", "ceilidh-coo-ears.png")
STRIP = os.path.join(ROOT, "site", "public", "ceilidh-coo-strip.png")

OUT = (59, 36, 20, 255)
HOOF = (85, 50, 30, 255)
FURL = (232, 150, 79, 255)
MUZ = (242, 206, 175, 255)
W = H = 64


def put(px, x, y, c):
    if 0 <= x < W and 0 <= y < H and c[3]:
        px[x, y] = c


def disc(px, cx, cy, rx, ry, fill):
    for y in range(cy - ry - 2, cy + ry + 3):
        for x in range(cx - rx - 2, cx + rx + 3):
            nx = (x - cx) / rx
            ny = (y - cy) / ry
            d = nx * nx + ny * ny
            if d <= 1:
                put(px, x, y, fill)
            elif d <= 1.45:
                put(px, x, y, OUT)


def main():
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    # Hooves over the ears of the standing frame (ears sit near y=16).
    for cx in (18, 46):
        disc(px, cx, 16, 6, 5, HOOF)
        put(px, cx - 1, 15, FURL)
        put(px, cx, 15, FURL)
    # Short forearms so the hooves read as raised, kept off her eyes.
    for x, y in (
        (13, 21), (12, 22), (12, 23), (11, 24), (11, 25), (11, 26),
        (51, 21), (52, 22), (52, 23), (53, 24), (53, 25), (53, 26),
    ):
        put(px, x, y, HOOF)
        put(px, x, y + 1, OUT)
    # Shut eyes. The open eyes are the 2x2 blocks at (27,16) and (36,16).
    for x in list(range(26, 30)) + list(range(35, 39)):
        put(px, x, 16, OUT)
        put(px, x, 17, OUT)
    # Worried brows.
    for x, y in ((26, 14), (27, 14), (28, 15), (35, 15), (36, 14), (37, 14)):
        put(px, x, y, OUT)
    # Cover the smile, then a small frown.
    for y in (26, 27, 28):
        for x in range(29, 36):
            put(px, x, y, MUZ)
    for x, y in ((30, 28), (31, 27), (32, 27), (33, 27), (34, 28)):
        put(px, x, y, OUT)
    img.save(OUT_PATH)
    if os.path.exists(STRIP):
        base = Image.open(STRIP).convert("RGBA").crop((0, 0, 64, 64))
        base.alpha_composite(img)
        preview = base.resize((256, 256), Image.NEAREST)
        preview.save(os.path.join("/tmp", "ceilidh-wince-preview.png"))
    print(OUT_PATH)


if __name__ == "__main__":
    main()
