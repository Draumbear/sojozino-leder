# Sojozino — website + dashboard

A static site (no server, no build step) for Sojozino's handmade leather goods, with an `/admin`
dashboard that lets Tinkie manage everything himself — products, photos, the About text, and
upcoming markets — without touching code.

## How it works

- The public site (`index.html`, `creaties.html`, `product.html`, …) reads its content from the
  JSON files in `data/`.
- `admin.html` is a private dashboard. It edits those same JSON files (and photos in `assets/`)
  by committing straight to this repo via the GitHub API, using a personal access token that's
  only ever stored in the browser it's entered into.
- Once this repo is on GitHub with **Pages** enabled, every save in the dashboard republishes the
  live site automatically (usually within a minute) — no separate deploy step.

## One-time setup (for you, or whoever hosts this)

1. Create a new **GitHub repository** and push this folder to it.
2. In the repo's Settings → Pages, set the source to deploy from the `main` branch, root folder.
   The site will be live at `https://<username>.github.io/<repo-name>/`.
3. Open `admin.html` on that live URL (or locally) and connect it:
   - Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - Under "Repository access" choose **Only select repositories** → pick this repo
   - Under "Permissions" → "Repository permissions", set **Contents** to **Read and write**
   - Generate the token, paste it into the dashboard's connect screen along with the GitHub
     username and repo name.
4. That's it — the dashboard remembers the connection in that browser from then on.

## Day-to-day use (Tinkie)

Open `admin.html` (bookmark it). From there:
- **Producten** — add a new item, edit an existing one's name/category/description, add or
  remove photos, drag the order, pick which photo is the cover shown on the overview page.
- **Categorieën** — add/rename the four product categories (or more).
- **Over mij** — edit the About text and photo.
- **Aanwezigheid** — add/remove upcoming markets; past ones automatically move to "eerder te
  vinden op" on the public site.
- **Instellingen** — business name, tagline, contact info, accent color, logo.

Every "Opslaan & publiceren" button is one save = one commit = one site update.

## Local preview (for development)

No install needed beyond Python (already used to import the photos):

```
python -m http.server 8123
```

Then open `http://localhost:8123`. Note: the admin dashboard's Save buttons need a real GitHub
connection to work (they commit to the repo) — local preview is for checking the public pages
and the dashboard's UI, not for saving changes offline.

## Re-running the photo import

`scripts/import_photos.py` did the one-time bulk import from the original WeTransfer photo dump
into `assets/products/` and `data/products/*.json` + `data/products-index.json` +
`data/categories.json`. It's safe to re-run (e.g. if more raw photos get added to that source
folder later) — it regenerates those files but preserves any product descriptions already edited
through the dashboard.

## Logo

The dragon mark (`assets/logo-mark.png`) was pulled from the public Instagram profile picture
(@sojozino_leder), which is low-resolution (150×150). It reads fine as a small mark since it's
high-contrast, but if a higher-resolution version of the logo exists, replace it via **Instellingen**
in the dashboard, or by swapping `assets/logo-mark.png` directly.
