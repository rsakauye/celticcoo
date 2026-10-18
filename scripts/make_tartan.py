#!/usr/bin/env python3
"""Render the Maple Leaf tartan (Canada's national tartan, David Weiser 1964) as SVG.

Sett (asymmetric / repeating), as published from the 1964 CIPO registration
(Tartans of Canada, http://www.stonearabie.com/ToC/01National/MapleLeaf2034.html; STA/SRT ref 2034):
    LT32 R32 G8 R8 G48 GO16 LT16 DT16 G48 R8 G8 R32
Colours are on-screen approximations of the published colour names (light tan, red, green,
gold, dark tan). Warp is drawn solid and weft at ~50% so crossings blend like a twill.
Writes site/public/tartan-maple-leaf.svg and prints a <pattern> snippet for the logo.
"""
import pathlib
SETT = [("LT", 32), ("R", 32), ("G", 8), ("R", 8), ("G", 48), ("GO", 16), ("LT", 16), ("DT", 16), ("G", 48), ("R", 8), ("G", 8), ("R", 32)]
COL = {"LT": "#b8925e", "R": "#b3141c", "G": "#1f5a34", "GO": "#e0a51e", "DT": "#6a4127"}
TOTAL = sum(n for _, n in SETT)  # 272 threads

def rects(scale=1.0):
    out, x = [], 0
    for c, n in SETT:  # weft (horizontal) first, then warp (vertical) at half opacity
        out.append(f'<rect x="0" y="{x*scale:g}" width="{TOTAL*scale:g}" height="{n*scale:g}" fill="{COL[c]}"/>')
        x += n
    x = 0
    for c, n in SETT:
        out.append(f'<rect x="{x*scale:g}" y="0" width="{n*scale:g}" height="{TOTAL*scale:g}" fill="{COL[c]}" opacity=".55"/>')
        x += n
    return "".join(out)

def pattern(pid="ml", scale=0.1):
    s = TOTAL * scale
    return f'<pattern id="{pid}" width="{s:g}" height="{s:g}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">{rects(scale)}</pattern>'

if __name__ == "__main__":
    root = pathlib.Path(__file__).resolve().parent.parent
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{TOTAL}" height="{TOTAL}" viewBox="0 0 {TOTAL} {TOTAL}">'
           f'<title>Maple Leaf tartan (Canada\'s national tartan), one sett</title>{rects()}</svg>\n')
    (root / "site/public/tartan-maple-leaf.svg").write_text(svg)
    print(pattern())
