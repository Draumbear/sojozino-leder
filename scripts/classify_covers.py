"""
Decides how each cover photo should sit in its grid tile.

The catalogue mixes studio shots on a white backdrop with photos taken
outdoors (in a tree, on a patio). Showing everything "contained" makes the
outdoor ones look accidentally letterboxed against white; cropping
everything cuts the ends off the studio shots. So: sample the border of each
cover, and if it's light and uniform (a real backdrop) contain it on white,
which is seamless -- otherwise fill the tile, which looks deliberate.

Writes "fit": "contain" | "cover" onto each entry in products-index.json.
"""
import json
import os

import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")

CORNER = 0.10      # size of each corner patch, as a fraction of the image
MIN_MEAN = 200     # corners must be at least this bright (0-255)
MAX_STD = 22       # ...and this uniform


def border_stats(path):
    """Corner patches rather than full edge strips: on a tightly-cropped
    studio shot the product touches the top/bottom edge, which made whole-
    border sampling read a clean white backdrop as 'busy'. The corners are
    the last place the product reaches."""
    img = Image.open(path).convert("RGB")
    a = np.asarray(img).astype(np.float32)
    h, w, _ = a.shape
    ch, cw = max(1, int(h * CORNER)), max(1, int(w * CORNER))
    patches = np.concatenate([
        a[:ch, :cw].reshape(-1, 3),
        a[:ch, -cw:].reshape(-1, 3),
        a[-ch:, :cw].reshape(-1, 3),
        a[-ch:, -cw:].reshape(-1, 3),
    ])
    lum = patches @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    return float(lum.mean()), float(lum.std())


def main():
    path = os.path.join(DATA, "products-index.json")
    index = json.load(open(path, encoding="utf-8"))
    counts = {"contain": 0, "cover": 0}

    for entry in index:
        cover = os.path.join(BASE, entry["cover"]["src"].replace("/", os.sep))
        try:
            mean, std = border_stats(cover)
        except OSError:
            entry["fit"] = "cover"
            counts["cover"] += 1
            continue
        clean = mean >= MIN_MEAN and std <= MAX_STD
        entry["fit"] = "contain" if clean else "cover"
        counts[entry["fit"]] += 1
        print(f"  {entry['slug']:<38} mean={mean:6.1f} std={std:5.1f} -> {entry['fit']}")

    json.dump(index, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\n{counts['contain']} contained on white, {counts['cover']} filling the tile.")


if __name__ == "__main__":
    main()
