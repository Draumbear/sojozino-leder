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
    "2 tassen rugzakken": ("tassen", "Tassen"),
    "3 riemen": ("riemen", "Riemen"),
    "4 kleine lederwaren": ("kleine-lederwaren", "Kleine Lederwaren"),
}

# Kleine Lederwaren is the one category the leathermaker wants broken down
# further. Fixed list (order matters -- shown in this order in filters and
# the dashboard); products not matched below fall into "allerlei".
SUBCATEGORIES = [
    ("portefeuilles", "Portefeuilles"),
    ("kaartenhouders", "Kaartenhouders"),
    ("toilettassen", "Toilettassen"),
    ("poepzakjeshouder", "Poepzakjeshouder"),
    ("sleutelhangers", "Sleutelhangers"),
    ("place-mats", "Place-mats"),
    ("onderleggers", "Onderleggers"),
    ("hoesjes", "Hoesjes"),
    ("brillendozen", "Brillendozen"),
    ("etuis", "Etuis"),
    ("boekenleggers", "Boekenleggers"),
    ("allerlei", "Allerlei"),
]

# Best-effort mapping from product slug (within Kleine Lederwaren) to one of
# the subcategories above, based on what each item actually is. Anything not
# listed here defaults to "allerlei" -- Tinkie can reassign any of these via
# the dashboard's product editor, this is just a sensible starting point.
SUBCATEGORY_MAP = {
    "bifold-de-nele-portefeuille": "portefeuilles",
    "driehoek-geldbeugels": "portefeuilles",
    "inges-longwallet": "portefeuilles",
    "kleine-geldbeugel": "portefeuilles",
    "portefeuille-den-stijn": "portefeuilles",
    "portefeuille-rood-zwart": "portefeuilles",
    "kaartenhouder-blauw": "kaartenhouders",
    "kaartenhouder-bruin-idem-grofleder": "kaartenhouders",
    "kaartenhouder-grof-leder": "kaartenhouders",
    "kaartenhouder-origami": "kaartenhouders",
    "kaartenhouder-schuifflap": "kaartenhouders",
    "kaartenhouders": "kaartenhouders",
    "kaartenhouders-duo-kleur": "kaartenhouders",
    "dopp-kit": "toilettassen",
    "poepzakjeshouder-handtasje": "poepzakjeshouder",
    "zakmeshouder-met-sleutelhanger": "sleutelhangers",
    "smartphonetasje": "hoesjes",
    "tablethoes": "hoesjes",
    "telefoonhoesje-prosper": "hoesjes",
    "henks-gsm-houder": "hoesjes",
    "mes-tasje": "etuis",
    "messenbeugel": "etuis",
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


def clean_variant_name(folder_name):
    # Some variant folders have an explanatory suffix after "=", e.g.
    # "den Sofie = kleine versie" -- keep just the short label for the swatch.
    return clean_name(folder_name.split("=")[0].strip())


def collect_images_recursive(dir_path):
    """All image files anywhere under dir_path, sorted by relative path so
    photos from the same sub-subfolder stay grouped together."""
    found = []
    for root, _dirs, fnames in os.walk(dir_path):
        for fname in fnames:
            if os.path.splitext(fname)[1].lower() in IMAGE_EXT:
                full = os.path.join(root, fname)
                found.append((os.path.relpath(full, dir_path), full))
    found.sort(key=lambda t: t[0])
    return [full for _rel, full in found]


def detect_variants(dir_path):
    """Returns [(label_or_None, [file_paths])] describing the real variant
    structure under dir_path, recursing wherever a variant itself splits
    further (see the call site for the "Tties/den Zita/{blauw, zwart croco}"
    example this is for)."""
    subfolders = sorted(
        d for d in os.listdir(dir_path) if os.path.isdir(os.path.join(dir_path, d))
    )
    non_empty = [
        sf for sf in subfolders
        if collect_images_recursive(os.path.join(dir_path, sf))
    ]

    if len(non_empty) < 2:
        files = collect_images_recursive(dir_path)
        return [(None, files)] if files else []

    result = []
    for sf in non_empty:
        sf_path = os.path.join(dir_path, sf)
        label = clean_variant_name(sf)
        deeper = detect_variants(sf_path)
        if len(deeper) > 1:
            for sub_label, sub_files in deeper:
                combined = f"{label} - {sub_label}" if sub_label else label
                result.append((combined, sub_files))
        else:
            result.append((label, collect_images_recursive(sf_path)))
    return result


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


def load_existing_products():
    """slug -> {description, subcategory}, for whatever's already on disk --
    so re-running the import doesn't clobber copy or subcategory
    reassignments Tinkie already made through the dashboard."""
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
            out[d["slug"]] = {
                "description": d.get("description") or None,
                "subcategory": d.get("subcategory") or None,
                "coverImage": d.get("coverImage") or None,
            }
        except (OSError, json.JSONDecodeError):
            continue
    return out


def main():
    existing = load_existing_products()

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
        cat_entry = {"slug": cat_slug, "name": cat_name, "order": cat_order}
        if cat_slug == "kleine-lederwaren":
            cat_entry["subcategories"] = [{"slug": s, "name": n} for s, n in SUBCATEGORIES]
        categories.append(cat_entry)

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
            # products have separate subfolders per colour/size/style variant
            # (e.g. "Driehoek geldbeugels/{blauwe geit, kaki, ...}" or
            # "Bordeauxrode riem/1", "2"), and some of those variants split
            # further still (e.g. "Tties/den Zita/{blauw, zwart croco}" --
            # one size that itself comes in two colours). detect_variants()
            # below handles this recursively: a folder with 2+ subfolders
            # that each contain a photo is a real split, and if one of THOSE
            # subfolders splits again the same way, it's expanded into
            # separate variants labelled "<parent> - <child>" rather than
            # merged into one mixed gallery. A folder with 0 or 1 such
            # subfolders is just a single flat variant (its whole subtree
            # walked recursively either way, so e.g. front/back shots with no
            # further split still all land in that one variant's photo set).
            src_dir = os.path.join(cat_path, pf)
            variant_sources = detect_variants(src_dir)

            if not variant_sources:
                continue

            variants = []
            seen_variant_slugs = set()
            for vname, vfiles in variant_sources:
                if vname:
                    vslug_base = slugify(vname)
                    vslug = vslug_base
                    n = 2
                    while vslug in seen_variant_slugs:
                        vslug = f"{vslug_base}-{n}"
                        n += 1
                    seen_variant_slugs.add(vslug)
                    out_dir_rel = f"{slug}/{vslug}"
                else:
                    out_dir_rel = slug

                images = []
                for i, src_path in enumerate(vfiles, start=1):
                    out_name = f"{i:02d}.jpg"
                    dst_path = os.path.join(ASSETS, out_dir_rel, out_name)
                    resize_save(src_path, dst_path, MAX_DIM)
                    images.append({
                        "src": f"assets/products/{out_dir_rel}/{out_name}",
                        "alt": f"{name} — {vname}" if vname else name,
                    })
                variants.append({"name": vname, "images": images})

            prior = existing.get(slug) or {}

            # Cover thumbnail (separate, smaller file for grid views).
            # Defaults to the first photo, but a cover picked by hand (see
            # scripts/set_covers.py) or through the dashboard is remembered
            # in the product's "coverImage" and wins -- the first photo is
            # often a detail shot rather than the whole product.
            flat = [(img["src"], src) for v, src_list in
                    zip(variants, [files for _n, files in variant_sources])
                    for img, src in zip(v["images"], src_list)]
            cover_src = variant_sources[0][1][0]
            cover_image = prior.get("coverImage")
            if cover_image:
                match = next((orig for out_src, orig in flat if out_src == cover_image), None)
                if match:
                    cover_src = match
                else:
                    cover_image = None
            cover_dst = os.path.join(ASSETS, slug, "cover.jpg")
            resize_save(cover_src, cover_dst, THUMB_DIM)
            cover = {"src": f"assets/products/{slug}/cover.jpg", "alt": name}
            description = prior.get("description") or (
                f"Handgemaakt in leder. Beschrijving volgt binnenkort — neem gerust "
                f"contact op voor meer details over {name.lower()}."
            )
            subcategory = None
            if cat_slug == "kleine-lederwaren":
                subcategory = prior.get("subcategory") or SUBCATEGORY_MAP.get(slug, "allerlei")

            products_index.append({
                "slug": slug,
                "name": name,
                "category": cat_slug,
                "subcategory": subcategory,
                "cover": cover,
                "order": prod_order,
                "featured": False,
            })

            with open(os.path.join(products_dir, f"{slug}.json"), "w", encoding="utf-8") as f:
                json.dump({
                    "slug": slug,
                    "name": name,
                    "category": cat_slug,
                    "subcategory": subcategory,
                    "description": description,
                    "coverImage": cover_image,
                    "variants": variants,
                }, f, ensure_ascii=False, indent=2)

            total_photos = sum(len(v["images"]) for v in variants)
            variant_note = f", {len(variants)} varianten" if len(variants) > 1 else ""
            print(f"  {cat_name} / {name} ({total_photos} photos{variant_note})")

    with open(os.path.join(DATA, "categories.json"), "w", encoding="utf-8") as f:
        json.dump(categories, f, ensure_ascii=False, indent=2)
    with open(os.path.join(DATA, "products-index.json"), "w", encoding="utf-8") as f:
        json.dump(products_index, f, ensure_ascii=False, indent=2)

    print(f"\nDone: {len(categories)} categories, {len(products_index)} products.")


if __name__ == "__main__":
    main()
