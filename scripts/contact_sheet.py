"""
Dev helper: builds numbered contact sheets of every product's photos so the
best cover shot can be picked by eye. Writes to scratch/ (not part of the
site). Usage: python scripts/contact_sheet.py [start] [count]
"""
import json
import os
import sys

from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
OUT = os.path.join(BASE, "scratch")

COLS = 6
CELL = 190


def sheet_for(product):
    """One labelled grid image per product, cells numbered to match the
    variant/photo indices printed alongside."""
    entries = []
    for vi, v in enumerate(product.get("variants", [])):
        for ii, img in enumerate(v.get("images", [])):
            entries.append((vi, ii, img["src"]))
    if not entries:
        return None, []

    rows = (len(entries) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + 22)), "white")
    draw = ImageDraw.Draw(sheet)

    for n, (vi, ii, src) in enumerate(entries):
        path = os.path.join(BASE, src.replace("/", os.sep))
        try:
            im = Image.open(path).convert("RGB")
        except OSError:
            continue
        im.thumbnail((CELL - 8, CELL - 8))
        x = (n % COLS) * CELL
        y = (n // COLS) * (CELL + 22)
        sheet.paste(im, (x + (CELL - im.width) // 2, y + (CELL - im.height) // 2))
        draw.text((x + 6, y + CELL + 4), f"[{n}] v{vi}.{ii}", fill="black")

    return sheet, entries


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 999
    os.makedirs(OUT, exist_ok=True)

    index = json.load(open(os.path.join(DATA, "products-index.json"), encoding="utf-8"))
    for p in index[start:start + count]:
        detail = json.load(open(os.path.join(DATA, "products", f"{p['slug']}.json"), encoding="utf-8"))
        sheet, entries = sheet_for(detail)
        if not sheet:
            continue
        dst = os.path.join(OUT, f"{p['slug']}.jpg")
        sheet.save(dst, "JPEG", quality=70, optimize=True)
        cover = p.get("cover", {}).get("src", "")
        cover_n = next((n for n, (_vi, _ii, s) in enumerate(entries) if s == cover), None)
        print(f"{p['slug']}: {len(entries)} photos, current cover = {cover_n}")


if __name__ == "__main__":
    main()
