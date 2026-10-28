#!/usr/bin/env python3
"""Ceilidh Coo 8-bit sprite generator (Highland fling loop).

Everything is drawn in code at 1x on a 64x64 grid, using a fixed palette.
Edit PALETTE / POSES below and re-run:  python3 scripts/make_ceilidh_coo.py
Writes site/public/tartans/fraser-of-lovat/ceilidh-coo-strip.png.
Previews go to /tmp and are not part of the site.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W = H = 64
FPS = 10
SCALE = 4

# ---- palette (index 0 = transparent). Sampled from coo-x-avatar-400.png + FB cover.
PALETTE = [
    (0, 0, 0),        # 0 transparent
    (59, 36, 20),     # 1 outline (avatar outline #3b2414)
    (207, 105, 43),   # 2 fur mid (#cf692b)
    (232, 150, 79),   # 3 fur light / highlight
    (150, 72, 30),    # 4 fur dark (ears, shading)
    (242, 206, 175),  # 5 muzzle (#f2ceaf)
    (232, 140, 120),  # 6 cheek blush
    (246, 236, 214),  # 7 horn cream
    (31, 77, 58),     # 8 tartan green (FB cover green #1f4d3a)
    (60, 122, 78),    # 9 tartan light green
    (184, 46, 38),    # 10 Fraser of Lovat red
    (224, 165, 38),   # 11 tartan gold (celticcoo.ca gold)
    (85, 50, 30),     # 12 hoof / tartan brown
    (255, 255, 255),  # 13 eye highlight,
    (32, 40, 78),     # 14 navy (Fraser of Lovat dark blue)
]
T, OUT, FUR, FURL, FURD, MUZ, BLUSH, HORN, GRN, LGRN, RED, GOLD, HOOF, WHT = range(14)


def new_layer():
    return Image.new("L", (W, H), 0)


class Canvas:
    def __init__(self):
        self.img = Image.new("P", (W, H), 0)
        self.px = self.img.load()

    def stamp(self, mask, fill, outline=OUT, pattern=None):
        """Paint a part: 1px outline around mask, then fill (colour index or pattern fn)."""
        dil = mask.filter(ImageFilter.MaxFilter(3))
        m, d = mask.load(), dil.load()
        if outline is not None:
            for y in range(H):
                for x in range(W):
                    if d[x, y] and not m[x, y]:
                        self.px[x, y] = outline
        for y in range(H):
            for x in range(W):
                if m[x, y]:
                    self.px[x, y] = pattern(x, y) if pattern else fill

    def put(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.px[x, y] = c


def ellipse(cx, cy, rx, ry):
    m = new_layer()
    ImageDraw.Draw(m).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
    return m


def poly(pts):
    m = new_layer()
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m


def limb(pts, width):
    m = new_layer()
    d = ImageDraw.Draw(m)
    d.line(pts, fill=255, width=width, joint="curve")
    r = width / 2 - 0.5
    for x, y in pts:  # round joints/ends
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    return m


NAVY = 14
# Fraser of Lovat, simplified for 1x pixels: red ground, a white pivot,
# green bands, and navy blocks.
LOVAT = [RED, RED, RED, WHT, RED, RED, RED, GRN, NAVY, GRN]


def tartan(x0, y0, step=None):
    """Fraser of Lovat tartan at 1x: warp and weft stripes from LOVAT,
    woven as a 2/2-style twill check (alternate pixels show warp or weft)."""
    n = len(LOVAT)
    def f(x, y):
        a, b = LOVAT[(x - x0) % n], LOVAT[(y - y0) % n]
        if a == b:
            return a
        if WHT in (a, b):
            return WHT if (x + y) % 2 == 0 else (b if a == WHT else a)
        return a if (x + y) % 2 == 0 else b
    return f


def sash_fill(x, y):
    """Diagonal sash: red ground, green edges, navy bars, a white fleck."""
    k = (x - y) % 5
    if k in (0, 4):
        return GRN
    if k == 2:
        band = (x + y) % 4
        if band == 0:
            return WHT
        if band == 1:
            return NAVY
        return RED
    if k in (1, 3) and (x + 2 * y) % 7 == 0:
        return NAVY
    return RED


# ---- poses: dy = hop, arms/legs as joint lists (relative to body, before dy)
# Shoulders ~ (25,33)/(39,33); hips ~ (28,47)/(36,47). L = viewer's left.
DOWN_L = [(25, 34), (22, 40), (24, 44)]          # hand on hip
DOWN_R = [(39, 34), (42, 40), (40, 44)]
UP_L = [(25, 33), (17, 24), (21, 8)]              # arm curved overhead
UP_R = [(39, 33), (47, 24), (43, 8)]
MID_L = [(25, 33), (17, 30), (14, 23)]
MID_R = [(39, 33), (47, 30), (50, 23)]
STAND_L = [(28, 47), (27, 54), (27, 59)]
STAND_R = [(36, 47), (37, 54), (37, 59)]
KICK_L = [(28, 47), (21, 51), (14, 50)]           # leg kicked out to side
KICK_R = [(36, 47), (43, 51), (50, 50)]
POINT_L = [(28, 47), (21, 51), (32, 53)]          # foot to the other knee (fling "shed")
POINT_R = [(36, 47), (43, 51), (32, 53)]
LIFT_L = [(28, 47), (24, 52), (24, 56)]
LIFT_R = [(36, 47), (40, 52), (40, 56)]

POSES = [  # (dy, armL, armR, legL, legR, kilt swing, head dx)
    (0, DOWN_L, DOWN_R, STAND_L, STAND_R, 0, 0),
    (-1, DOWN_L, MID_R, LIFT_L, STAND_R, -1, 0),
    (-3, DOWN_L, UP_R, KICK_L, STAND_R, -2, 1),
    (-2, DOWN_L, UP_R, POINT_L, STAND_R, -1, 1),
    (0, DOWN_L, MID_R, LIFT_L, STAND_R, 0, 0),
    (0, DOWN_L, DOWN_R, STAND_L, STAND_R, 0, 0),
    (-1, MID_L, DOWN_R, STAND_L, LIFT_R, 1, 0),
    (-3, UP_L, DOWN_R, STAND_L, KICK_R, 2, -1),
    (-2, UP_L, DOWN_R, STAND_L, POINT_R, 1, -1),
    (0, MID_L, DOWN_R, STAND_L, LIFT_R, 0, 0),
]


def sh(pts, dx, dy):
    return [(x + dx, y + dy) for x, y in pts]


def draw_leg(c, pts, dy):
    p = sh(pts, 0, dy)
    c.stamp(limb(p, 5), FUR)
    fx, fy = p[-1]
    c.stamp(ellipse(fx, fy + 1, 2.5, 1.5), HOOF)


def draw_arm(c, pts, dy):
    p = sh(pts, 0, dy)
    c.stamp(limb(p, 4), FUR)
    hx, hy = p[-1]
    c.stamp(ellipse(hx, hy, 1.6, 1.6), HOOF)


def draw_frame(pose, arms_on_top=False, pre=None, mid=None, post=None):
    """Hooks (used by make_stickers.py): pre/mid(c, dy) draw props behind the body / before the arms;
    post(c, hx, hy, dy) draws on top. arms_on_top draws arms after the head."""
    dy, armL, armR, legL, legR, swing, hdx = pose
    c = Canvas()
    if pre:
        pre(c, dy)
    # back layer: tail, legs
    tail = sh([(38, 44), (44, 42), (47, 45)], 0, dy)
    c.stamp(limb(tail, 2), FURD)
    c.stamp(ellipse(tail[-1][0], tail[-1][1] + 1, 1.6, 2), FURD)
    for leg in (legL, legR):
        draw_leg(c, leg, dy)
    # torso
    c.stamp(ellipse(32, 38 + dy, 8, 9), FUR)
    c.stamp(ellipse(30, 35 + dy, 3, 2.5), FURL, outline=None)  # chest highlight
    # kilt (trapezoid that swings at the hem)
    top, bot = 42 + dy, 51 + dy
    kilt = poly([(24, top), (40, top), (42 + swing, bot), (22 + swing, bot)])
    c.stamp(kilt, None, pattern=tartan(24, top))
    for x in (27, 31, 35, 39):  # pleat shadows in the lower half
        for y in range(bot - 3, bot + 1):
            if kilt.getpixel((x + swing // 2, y)):
                c.put(x + swing // 2, y, OUT if y == bot else GRN)
    c.stamp(poly([(24, top), (40, top), (40, top + 1), (24, top + 1)]), HOOF, outline=None)  # belt
    c.put(32, top, GOLD); c.put(33, top, GOLD)  # buckle
    # sporran
    c.stamp(ellipse(32.5, top + 5, 2, 2.5), HORN)
    for x in (31, 32, 33, 34):
        c.put(x, top + 3, HOOF)
    c.put(32, top + 6, GOLD); c.put(33, top + 6, GOLD)
    # sash across the chest, with a gold brooch
    sash = limb(sh([(26, 30), (38, 41)], 0, dy), 3)
    c.stamp(sash, None, pattern=sash_fill)
    c.stamp(ellipse(28, 32 + dy, 1, 1), GOLD)
    if mid:
        mid(c, dy)
    # arms over body
    if not arms_on_top:
        for arm in (armL, armR):
            draw_arm(c, arm, dy)
    # ---- head
    hx, hy = 32 + hdx, 18 + dy
    for s in (-1, 1):  # horns: curve outward and up
        horn = limb([(hx + s * 8, hy - 6), (hx + s * 13, hy - 8), (hx + s * 16, hy - 12)], 3)
        c.stamp(horn, HORN)
    for s in (-1, 1):  # ears
        c.stamp(ellipse(hx + s * 12, hy - 1, 3.5, 2.2), FURD)
    # forelock tuft (drawn before the head so its lower outline is hidden)
    c.stamp(poly([(hx - 5, hy - 8), (hx - 3, hy - 13), (hx - 1, hy - 9), (hx + 1, hy - 13), (hx + 3, hy - 8)]), FURL)
    c.stamp(ellipse(hx, hy, 11, 10), FUR)
    # zig-zag fringe (signature look of the logo): lighter fur above, 2px zigzag line
    zig = {}
    for x in range(hx - 10, hx + 11):
        zig[x] = hy - 6 + (abs(x - hx) % 4 if abs(x - hx) % 4 <= 2 else 4 - abs(x - hx) % 4)
    for x, zy in zig.items():
        for y in range(hy - 11, zy):
            if c.px[x, y] == FUR:
                c.px[x, y] = FURL
        if c.px[x, zy] in (FUR, FURL):
            c.px[x, zy] = OUT
    # eyes (2x2 with a highlight), sitting between fringe and muzzle
    for ex in (hx - 5, hx + 4):
        for xx in (ex, ex + 1):
            for yy in (hy - 2, hy - 1):
                c.put(xx, yy, OUT)
        c.put(ex + 1, hy - 2, WHT)
    # blush
    for x in (hx - 9, hx - 8, hx + 7, hx + 8):
        c.put(x, hy + 1, BLUSH)
    # muzzle: wide and short so it reads as a cow nose, not a face
    c.stamp(ellipse(hx, hy + 6, 7, 4), MUZ)  # sits on the bottom of the head, like the logo
    for x in (hx - 3, hx + 3):  # nostrils: single soft-brown dots so they never read as eyes
        c.put(x, hy + 6, FURD)
    for x in (hx - 1, hx, hx + 1):  # small smile
        c.put(x, hy + 9, OUT)
    c.put(hx - 2, hy + 8, OUT); c.put(hx + 2, hy + 8, OUT)
    # tartan bow on top-right of head
    bx, by = hx + 5, hy - 10
    c.stamp(ellipse(bx - 2, by, 2, 1.6), RED)
    c.stamp(ellipse(bx + 3, by, 2, 1.6), RED)
    c.put(bx - 2, by, GRN); c.put(bx + 3, by, GRN)  # tartan hint
    c.put(bx, by, GOLD); c.put(bx + 1, by, GOLD)
    if arms_on_top:
        for arm in (armL, armR):
            draw_arm(c, arm, dy)
    if post:
        post(c, hx, hy, dy)
    return c.img


def palettize(img):
    flat = [v for rgb in PALETTE for v in rgb]
    img.putpalette(flat + [0] * (768 - len(flat)))
    img.info["transparency"] = 0
    return img


def main():
    frames = [palettize(draw_frame(p)) for p in POSES]
    n = len(frames)
    strip = palettize(Image.new("P", (W * n, H), 0))
    for i, f in enumerate(frames):
        strip.paste(f, (i * W, 0))
    out = os.path.join(os.path.dirname(HERE), "site", "public", "tartans", "fraser-of-lovat", "ceilidh-coo-strip.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    strip.save(out, optimize=True, transparency=0, bits=4)
    strip.resize((W * n * SCALE, H * SCALE), Image.NEAREST).save(
        "/tmp/ceilidh-coo-preview-4x.png", optimize=True, transparency=0)
    big = [f.resize((W * SCALE, H * SCALE), Image.NEAREST) for f in frames]
    big[0].save("/tmp/ceilidh-coo-preview.gif", save_all=True, append_images=big[1:],
                duration=int(1000 / FPS), loop=0, transparency=0, disposal=2, optimize=False)
    used = set()
    for f in frames:
        used |= {i for _, i in f.getcolors()}
    print(f"{n} frames, {W}x{H}, {FPS} fps, colours used (incl. transparent): {len(used)}")


if __name__ == "__main__":
    main()
