#!/usr/bin/env python3
"""Draw the Fraser of Lovat page stripe as SVG.

The stripe sequence repeats every 10 units: red, red, red, white, red, red, red,
green, navy, green. Where the two stripes differ, even pixels take the first
colour and odd pixels take the second. A white thread stays white on even
pixels and shows the other colour on odd pixels.

Writes site/public/tartan-fraser-of-lovat.svg.
"""
import pathlib

RED = "#B82E26"
GREEN = "#1F4D3A"
WHITE = "#FFFFFF"
NAVY = "#20284E"
SEQ = [RED, RED, RED, WHITE, RED, RED, RED, GREEN, NAVY, GREEN]


def colour(x, y):
    a, b = SEQ[x % 10], SEQ[y % 10]
    if a == b:
        return a
    if WHITE in (a, b):
        return WHITE if (x + y) % 2 == 0 else (b if a == WHITE else a)
    return a if (x + y) % 2 == 0 else b


def rects(scale=1):
    parts = []
    for y in range(10):
        for x in range(10):
            parts.append(
                f'<rect x="{x * scale:g}" y="{y * scale:g}" width="{scale:g}" height="{scale:g}" fill="{colour(x, y)}"/>'
            )
    return "".join(parts)


def svg(scale=1):
    size = 10 * scale
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size:g}" height="{size:g}" viewBox="0 0 {size:g} {size:g}">'
        f"<title>Fraser of Lovat, one repeat</title>{rects(scale)}</svg>\n"
    )


def pattern(pid="lovat", scale=1.2):
    size = 10 * scale
    return (
        f'<pattern id="{pid}" width="{size:g}" height="{size:g}" patternUnits="userSpaceOnUse" '
        f'patternTransform="rotate(35)">{rects(scale)}</pattern>'
    )


if __name__ == "__main__":
    root = pathlib.Path(__file__).resolve().parent.parent
    (root / "site/public/tartan-fraser-of-lovat.svg").write_text(svg())
    print(pattern())
