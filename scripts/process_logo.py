"""One-off: turn the raw Instagram profile picture into a clean transparent logo mark."""
from PIL import Image
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(BASE, "assets", "ig_profile_raw.jpg")
out = os.path.join(BASE, "assets", "logo-mark.png")

img = Image.open(src).convert("RGBA")
w, h = img.size
px = img.load()
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        # Whitish background -> transparent; keep the dark/red dragon mark.
        if r > 235 and g > 235 and b > 235:
            px[x, y] = (r, g, b, 0)

# Trim to content bounds with a small margin.
bbox = img.getbbox()
if bbox:
    l, t, r, b = bbox
    pad = 4
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(w, r + pad); b = min(h, b + pad)
    img = img.crop((l, t, r, b))

img.save(out)
print("saved", out, img.size)

# Upscaled version for header use (nearest-safe upscale since source is tiny).
big = img.resize((img.width * 4, img.height * 4), Image.LANCZOS)
big.save(os.path.join(BASE, "assets", "logo-mark@4x.png"))
print("saved 4x", big.size)
