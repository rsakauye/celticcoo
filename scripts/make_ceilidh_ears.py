#!/usr/bin/env python3
"""Two-frame wince strip for the drone tuner.

Same 64x64 grid and palette as scripts/make_ceilidh_coo.py. Frame 0 and
frame 1 are a small wiggle: hooves up, covering the ears. This does not
edit the dance strip (that file stays 640x64).

    python3 scripts/make_ceilidh_ears.py
"""
import importlib.util
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_PATH = os.path.join(ROOT, "site", "public", "ceilidh-coo-ears.png")


def load_coo():
    path = os.path.join(HERE, "make_ceilidh_coo.py")
    spec = importlib.util.spec_from_file_location("make_ceilidh_coo", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    coo = load_coo()
    frames = [coo.palettize(coo.draw_wince_frame(i)) for i in (0, 1)]
    strip = coo.palettize(Image.new("P", (coo.W * 2, coo.H), 0))
    for i, frame in enumerate(frames):
        strip.paste(frame, (i * coo.W, 0))
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    strip.save(OUT_PATH, optimize=True, transparency=0, bits=4)
    preview = strip.resize((coo.W * 2 * 4, coo.H * 4), Image.NEAREST)
    preview.save("/tmp/ceilidh-wince-preview.png")
    close = frames[0].resize((coo.W * 8, coo.H * 8), Image.NEAREST)
    close.save("/tmp/ceilidh-wince-close.png")
    print(OUT_PATH, strip.size)


if __name__ == "__main__":
    main()
