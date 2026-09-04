"""Generates small copies of the product photos for the thumbnail strip and the
variant swatches.

The gallery used to point those at the originals: 1600x1200 files around 700 KB,
displayed at 62 and 92 pixels. A creation with two dozen photos pulled well over
8 MB before anything was readable. Lazy loading halved that; this removes it.

Thumbs land beside the photo they came from, in a thumbs/ subfolder, so the
mapping needs no index and nothing to keep in sync -- product-render.js derives
the path from the original and falls back to the original if the thumb is
missing. That fallback is what makes this safe to run late: Johnny's dashboard
uploads photos straight to GitHub with no build step, so his newest photos have
no thumb until someone runs this, and until then they simply look as they did
before.

    python scripts/build_thumbs.py            # only what is missing or stale
    python scripts/build_thumbs.py --force    # rebuild everything
"""

import os
import sys

from PIL import Image, ImageOps

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRODUCTS = os.path.join(BASE, "assets", "products")

# Twice the largest size any of these is displayed at (92px swatches), so they
# stay sharp on a retina screen and no larger.
MAX_EDGE = 240
QUALITY = 78
EXTS = (".jpg", ".jpeg", ".png", ".webp")

THUMB_DIR = "thumbs"


def targets():
    # Recursive: a product with variants keeps each variant's photos in its own
    # subfolder. The thumb always lands in a thumbs/ folder beside its original,
    # so the same rule -- insert thumbs/ before the filename -- derives the path
    # at every depth.
    for folder, dirs, files in os.walk(PRODUCTS):
        dirs[:] = sorted(d for d in dirs if d != THUMB_DIR)
        for name in sorted(files):
            src = os.path.join(folder, name)
            if not name.lower().endswith(EXTS):
                continue
            yield src, os.path.join(folder, THUMB_DIR, name)


def stale(src, dst):
    return not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src)


# Every photo on the site is portrait; a share card is 1200x630. Cropping one
# to fit beats letting Facebook and WhatsApp letterbox it themselves.
OG_SOURCE = os.path.join(BASE, "assets", "about.jpg")
OG_TARGET = os.path.join(BASE, "assets", "og-default.jpg")
OG_SIZE = (1200, 630)


def build_og_image():
    if not os.path.exists(OG_SOURCE):
        return
    if os.path.exists(OG_TARGET) and os.path.getmtime(OG_TARGET) >= os.path.getmtime(OG_SOURCE):
        return
    with Image.open(OG_SOURCE) as im:
        im = ImageOps.exif_transpose(im)
        # Bias the crop upward: on a portrait photo of someone working, the
        # centre of the frame is the bench, not the person.
        card = ImageOps.fit(im, OG_SIZE, Image.LANCZOS, centering=(0.5, 0.35))
        card.convert("RGB").save(OG_TARGET, "JPEG", quality=82, optimize=True, progressive=True)
    print("og image    assets/og-default.jpg %dx%d" % OG_SIZE)


def main():
    force = "--force" in sys.argv
    build_og_image()
    made = skipped = 0
    before = after = 0

    for src, dst in targets():
        before += os.path.getsize(src)
        if not force and not stale(src, dst):
            after += os.path.getsize(dst)
            skipped += 1
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with Image.open(src) as im:
            # exif_transpose first: a photo taken sideways carries its rotation
            # in metadata that thumbnailing would drop, leaving it on its side.
            im = ImageOps.exif_transpose(im)
            im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
            if dst.lower().endswith((".jpg", ".jpeg")):
                im.convert("RGB").save(dst, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            else:
                im.save(dst, optimize=True)
        after += os.path.getsize(dst)
        made += 1

    mb = lambda n: n / 1048576.0
    print("thumbs      %d written, %d already current" % (made, skipped))
    print("originals   %.1f MB" % mb(before))
    print("thumbs      %.1f MB  (%.0f%% smaller)" % (mb(after), 100 - 100.0 * after / max(before, 1)))


if __name__ == "__main__":
    main()
