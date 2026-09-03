"""
One-time bulk import: turns the raw WeTransfer photo dump into the site's
data/ + assets/products/ structure. Source photos are large (some >100MB,
originals total ~2.5GB) so everything is re-encoded down to a sane web size
on the way in -- GitHub hard-rejects any file over 100MB anyway.

Re-run is safe: it fully regenerates data/categories.json,
data/products-index.json and data/products/*.json, and re-writes
assets/products/. Hand-edited description text in data/products/*.json is
preserved across re-runs (matched by slug) so re-importing to pick up new
photos doesn't clobber copy Tinkie already wrote in the dashboard.
"""
import json
import os
import re
import unicodedata

from PIL import Image, ImageOps

SOURCE = r"C:\Users\tangu\Sojozino\wetransfer_fotos-tinkie-wupsite_2026-09-02_2136\fotos Tinkie wupsite"
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(BASE, "assets", "products")
DATA = os.path.join(BASE, "data")

CATEGORY_MAP = {
    "1 handtassen": ("handtassen", "Handtassen"),
    "2 tassen rugzakken": ("tassen-rugzakken", "Tassen & Rugzakken"),
    "3 riemen": ("riemen", "Riemen"),
    "4 kleine lederwaren": ("kleine-lederwaren", "Kleine Lederwaren"),
}

MAX_DIM = 1600
THUMB_DIM = 700
JPEG_QUALITY = 82
IMAGE_EXT = {".jpg", ".jpeg", ".png"}


def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "item"


def clean_name(folder_name):
    words = folder_name.strip().split()
    out = []
    for w in words:
        if w.isupper() and len(w) > 1:
            out.append(w.capitalize())
        else:
            out.append(w[:1].upper() + w[1:] if w else w)
    return " ".join(out)


def resize_save(src_path, dst_path, max_dim):
    img = Image.open(src_path)
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    elif img.mode == "L":
        img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > max_dim:
        scale = max_dim / max(w, h)
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    img.save(dst_path, "JPEG", quality=JPEG_QUALITY, optimize=True)


def load_existing_descriptions():
    """slug -> description, for whatever's already in data/products/*.json."""
    out = {}
    products_dir = os.path.join(DATA, "products")
    if not os.path.isdir(products_dir):
        return out
    for fname in os.listdir(products_dir):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(products_dir, fname), encoding="utf-8") as f:
                d = json.load(f)
            if d.get("description"):
                out[d["slug"]] = d["description"]
        except (OSError, json.JSONDecodeError):
            continue
    return out


def main():
    existing_desc = load_existing_descriptions()

    categories = []
    products_index = []
    seen_slugs = {}

    cat_folders = sorted(
        d for d in os.listdir(SOURCE) if os.path.isdir(os.path.join(SOURCE, d))
    )

    products_dir = os.path.join(DATA, "products")
    os.makedirs(products_dir, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)

    cat_order = 0
    for cat_folder in cat_folders:
        cat_slug, cat_name = CATEGORY_MAP.get(cat_folder, (slugify(cat_folder), cat_folder))
        cat_order += 1
        categories.append({"slug": cat_slug, "name": cat_name, "order": cat_order})

        cat_path = os.path.join(SOURCE, cat_folder)
        product_folders = sorted(
            d for d in os.listdir(cat_path) if os.path.isdir(os.path.join(cat_path, d))
        )

        prod_order = 0
        for pf in product_folders:
            name = clean_name(pf)
            base_slug = slugify(name)
            slug = base_slug
            n = 2
            while slug in seen_slugs:
                slug = f"{base_slug}-{n}"
                n += 1
            seen_slugs[slug] = True
            prod_order += 1

            # Photos aren't always directly inside the product folder -- some
            # products have nested subfolders for colour/view variants (e.g.
            # "Bordeauxrode riem/1", "2", or "Tties/den Sofie/lichtbruin").
            # Walk the whole subtree so nothing gets silently skipped, sorted
            # by full relative path so photos from the same subfolder stay
            # grouped together in a stable order.
            src_dir = os.path.join(cat_path, pf)
            found = []
            for root, _dirs, fnames in os.walk(src_dir):
                for fname in fnames:
                    if os.path.splitext(fname)[1].lower() in IMAGE_EXT:
                        full = os.path.join(root, fname)
                        found.append((os.path.relpath(full, src_dir), full))
            found.sort(key=lambda t: t[0])
            files = [full for _rel, full in found]
            if not files:
                continue

            images = []
            for i, src_path in enumerate(files, start=1):
                out_name = f"{i:02d}.jpg"
                dst_path = os.path.join(ASSETS, slug, out_name)
                resize_save(src_path, dst_path, MAX_DIM)
                images.append({
                    "src": f"assets/products/{slug}/{out_name}",
                    "alt": name,
                })

            # Cover thumbnail (separate, smaller file for grid views).
            cover_src = files[0]
            cover_dst = os.path.join(ASSETS, slug, "cover.jpg")
            resize_save(cover_src, cover_dst, THUMB_DIM)
            cover = {"src": f"assets/products/{slug}/cover.jpg", "alt": name}

            description = existing_desc.get(
                slug,
                f"Handgemaakt in leder. Beschrijving volgt binnenkort — neem gerust "
                f"contact op voor meer details over {name.lower()}.",
            )

            products_index.append({
                "slug": slug,
                "name": name,
                "category": cat_slug,
                "cover": cover,
                "order": prod_order,
                "featured": False,
            })

            with open(os.path.join(products_dir, f"{slug}.json"), "w", encoding="utf-8") as f:
                json.dump({
                    "slug": slug,
                    "name": name,
                    "category": cat_slug,
                    "description": description,
                    "images": images,
                }, f, ensure_ascii=False, indent=2)

            print(f"  {cat_name} / {name} ({len(images)} photos)")

    with open(os.path.join(DATA, "categories.json"), "w", encoding="utf-8") as f:
        json.dump(categories, f, ensure_ascii=False, indent=2)
    with open(os.path.join(DATA, "products-index.json"), "w", encoding="utf-8") as f:
        json.dump(products_index, f, ensure_ascii=False, indent=2)

    print(f"\nDone: {len(categories)} categories, {len(products_index)} products.")


if __name__ == "__main__":
    main()
