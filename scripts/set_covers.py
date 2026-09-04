"""
Applies hand-picked cover photos. The import script defaults every product's
cover to its first photo, which for a lot of items landed on a detail
close-up, a work-in-progress shot or (for the ROK grinder lid) the appliance
rather than the leather. Each entry below is the index -- counting across all
variants in order, matching the numbering in scripts/contact_sheet.py -- of
the photo that best shows the whole product.

The choice is written into data/products/<slug>.json as "coverImage" so
re-running the import keeps it, and the cover.jpg thumbnail is regenerated
from that photo.
"""
import json
import os

from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
THUMB_DIM = 700
JPEG_QUALITY = 82

# slug -> index of the chosen photo (omitted/0 = keep the first photo)
COVERS = {
    "tties": 1,
    "clutch": 1,
    "den-grace": 1,
    "driehoek-handtasje": 1,
    "geel-tasje-met-rode-accenten": 1,
    "handtas-den-mimi": 1,
    "lotustasje": 2,
    "paarse-dokterstas-handtas": 19,
    "plooitasje-lamsleder": 11,
    "rugbyhandtas": 11,
    "schimmeltas": 1,
    "slingbags": 6,
    "stovebuze": 1,
    "barrel-bag-lapjes": 8,
    "lucs-boekentas": 4,
    "t-tas-fushia": 10,
    "bordeauxrode-riem": 7,
    "dopp-kit": 2,
    "henks-gsm-houder": 9,
    "inges-longwallet": 1,
    "noors-boekenbox": 1,
    "bifold-de-nele-portefeuille": 2,
    "boekenbox-handtas": 1,
    "boekenbox-rood-print": 4,
    "deksel-koffiemaler-rok": 4,
    "kaartenhouder-bruin-idem-grofleder": 1,
    "kaartenhouder-grof-leder": 1,
    "kaartenhouder-schuifflap": 2,
    "kaartenhouders": 1,
    "kaartenhouders-duo-kleur": 1,
    "mes-tasje": 4,
    "messenbeugel": 13,
    "poepzakjeshouder-handtasje": 4,
    "portefeuille-den-stijn": 1,
    "tablethoes": 3,
    "telefoonhoesje-prosper": 1,
    "vide-poche": 1,
    "zakmeshouder-met-sleutelhanger": 9,
}


def flat_images(product):
    return [img for v in product.get("variants", []) for img in v.get("images", [])]


def main():
    index_path = os.path.join(DATA, "products-index.json")
    index = json.load(open(index_path, encoding="utf-8"))
    changed = 0

    for entry in index:
        slug = entry["slug"]
        pick = COVERS.get(slug, 0)
        detail_path = os.path.join(DATA, "products", f"{slug}.json")
        detail = json.load(open(detail_path, encoding="utf-8"))

        images = flat_images(detail)
        if not images:
            continue
        if pick >= len(images):
            print(f"  !! {slug}: index {pick} out of range ({len(images)} photos), skipped")
            continue

        chosen = images[pick]
        detail["coverImage"] = chosen["src"]
        json.dump(detail, open(detail_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

        src_path = os.path.join(BASE, chosen["src"].replace("/", os.sep))
        img = Image.open(src_path).convert("RGB")
        w, h = img.size
        if max(w, h) > THUMB_DIM:
            scale = THUMB_DIM / max(w, h)
            img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
        img.save(os.path.join(BASE, "assets", "products", slug, "cover.jpg"),
                 "JPEG", quality=JPEG_QUALITY, optimize=True)

        if pick:
            changed += 1
            print(f"  {slug}: cover -> photo {pick}")

    json.dump(index, open(index_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nDone: {changed} covers changed, {len(index)} thumbnails regenerated.")


if __name__ == "__main__":
    main()
