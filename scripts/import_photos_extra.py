"""
One-off: brings the photos Johnny sent over (logo file, a shot of him
working, and three market photos) into assets/ at web sizes.

The logo arrives as a JPEG with a white background and the wordmark curved
around the dragon. Two versions come out of it:
  - logo-full.png  -- the whole thing, white knocked out to transparent, for
                      the hero where it sits large enough to read
  - logo-mark.png  -- just the dragon, for the header/favicon where the
                      curved wordmark would be an illegible smudge next to
                      the text logo anyway
"""
import os
from collections import deque

import numpy as np
from PIL import Image, ImageOps

SRC = r"C:\Users\tangu\Sojozino\Whatsapp pictures"
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(BASE, "assets")


def knock_out_white(img, threshold=235):
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, _a = px[x, y]
            if r > threshold and g > threshold and b > threshold:
                px[x, y] = (r, g, b, 0)
    return img


def largest_blob(img):
    """Keeps only the biggest connected shape (plus anything red touching
    it). The wordmark curves around the dragon, so no rectangular crop can
    separate the two -- but the dragon is one big connected blob and each
    letter is its own small one, so component size does separate them."""
    alpha = np.array(img)[:, :, 3] > 0
    h, w = alpha.shape
    seen = np.zeros((h, w), dtype=bool)
    best_mask, best_size = None, 0

    for sy in range(h):
        for sx in range(w):
            if not alpha[sy, sx] or seen[sy, sx]:
                continue
            # Flood fill this component.
            pixels = []
            q = deque([(sy, sx)])
            seen[sy, sx] = True
            while q:
                y, x = q.popleft()
                pixels.append((y, x))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and alpha[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
            if len(pixels) > best_size:
                best_size, best_mask = len(pixels), pixels

    keep = np.zeros((h, w), dtype=bool)
    for y, x in best_mask:
        keep[y, x] = True

    # The flame is its own (unconnected) blob, and it's the only red in the
    # logo -- the wordmark is entirely black -- so keeping every red pixel
    # brings the flame back without bringing back any lettering.
    arr = np.array(img).astype(np.int16)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    red = (arr[:, :, 3] > 0) & (r > 120) & (r > g * 1.6) & (r > b * 1.6)
    keep |= red

    out = np.array(img)
    out[:, :, 3] = np.where(keep, out[:, :, 3], 0)
    return Image.fromarray(out)


def trim(img, pad=4):
    bbox = img.getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    w, h = img.size
    return img.crop((max(0, l - pad), max(0, t - pad), min(w, r + pad), min(h, b + pad)))


def save_photo(src_name, dst_name, max_dim, crop_ratio=None, crop_anchor="center"):
    """Resize (and optionally crop to an aspect ratio) one photo."""
    img = Image.open(os.path.join(SRC, src_name))
    img = ImageOps.exif_transpose(img).convert("RGB")
    w, h = img.size

    if crop_ratio:
        target_h = round(w / crop_ratio)
        if target_h <= h:
            if crop_anchor == "top":
                top = 0
            else:
                top = (h - target_h) // 2
            img = img.crop((0, top, w, top + target_h))
        else:
            target_w = round(h * crop_ratio)
            left = (w - target_w) // 2
            img = img.crop((left, 0, left + target_w, h))

    w, h = img.size
    if max(w, h) > max_dim:
        scale = max_dim / max(w, h)
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    dst = os.path.join(ASSETS, dst_name)
    img.save(dst, "JPEG", quality=84, optimize=True)
    print(f"  {dst_name} {img.size}")


def main():
    os.makedirs(ASSETS, exist_ok=True)

    logo = Image.open(os.path.join(SRC, "Logo.jpeg"))
    logo = knock_out_white(logo)

    full = trim(logo)
    full.save(os.path.join(ASSETS, "logo-full.png"))
    print(f"  logo-full.png {full.size}")

    mark = trim(largest_blob(logo))
    mark.save(os.path.join(ASSETS, "logo-mark.png"))
    print(f"  logo-mark.png {mark.size}")

    # Portrait shot of Johnny working -- cropped to the 4/5 slot the About
    # photo uses, anchored to the top so the crop drops the gravel at his
    # feet rather than his face.
    save_photo("AanHetWerk.jpeg", "about.jpg", 1200, crop_ratio=4 / 5, crop_anchor="top")

    # Market photos: left uncropped, the pages using them crop via CSS.
    save_photo("Markt.jpeg", "markt-tent.jpg", 1600)
    save_photo("Markt3.jpeg", "markt-stand.jpg", 1400)
    save_photo("Markt2.jpeg", "markt-team.jpg", 1400)


if __name__ == "__main__":
    main()
