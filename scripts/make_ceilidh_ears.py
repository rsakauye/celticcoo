#!/usr/bin/env python3
"""Check the shipped Ceilidh strips. This does not redraw them.

site/public/tartans/fraser-of-lovat keeps a 256x64 ears strip (4 frames)
and a 640x64 dance strip (10 frames).
"""
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TARTANS = os.path.join(ROOT, "site", "public", "tartans")
EXPECT = {
    "ceilidh-coo-strip.png": (640, 64),
    "ceilidh-coo-ears-covered-strip.png": (256, 64),
}


def size(path):
    with open(path, "rb") as handle:
        handle.seek(16)
        return struct.unpack(">II", handle.read(8))


def main():
    folders = sorted(
        name for name in os.listdir(TARTANS) if os.path.isdir(os.path.join(TARTANS, name))
    )
    if folders != ["fraser-of-lovat"]:
        print(f"expected only fraser-of-lovat, found {folders}", file=sys.stderr)
        return 1
    failed = False
    for folder in folders:
        for name, expect in EXPECT.items():
            path = os.path.join(TARTANS, folder, name)
            if not os.path.isfile(path):
                print("missing", path, file=sys.stderr)
                failed = True
                continue
            found = size(path)
            if found != expect:
                print(path, found, "expected", expect, file=sys.stderr)
                failed = True
    if failed:
        return 1
    print(f"{len(folders)} tartan folders ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
