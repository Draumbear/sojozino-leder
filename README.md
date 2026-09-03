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
- Hosted on **Netlify**, connected to this repo: every save in the dashboard is a commit, and
  every commit triggers a Netlify redeploy (usually live within a minute) — no separate deploy
  step, no server to run.
- The **Bestellen** (order) page is a real form, not a mailto link — Netlify detects and handles
  it automatically (see "Netlify Forms" below), so submissions land in the Netlify dashboard and
  can email Johnny directly.

## One-time setup (for you, or whoever hosts this)

1. Create a new **GitHub repository** and push this folder to it.
2. On [netlify.com](https://app.netlify.com), **Add new site → Import an existing project**, pick
   this GitHub repo. No build command needed, publish directory is `.` (already set in
   `netlify.toml`). Netlify gives it a URL immediately; a custom domain can be added later under
   Site settings → Domain management.
3. **Netlify Forms**: nothing to configure to start collecting submissions — Netlify detects the
   `bestellen.html` form automatically on deploy. To get an email for every new order, go to
   Site settings → Forms → Form notifications → Add notification → Email notification, and enter
   Johnny's address. Submissions are also always visible under Site → Forms in the Netlify
   dashboard.
4. Open `admin.html` on the live URL (or locally) and connect it:
   - Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - Under "Repository access" choose **Only select repositories** → pick this repo
   - Under "Permissions" → "Repository permissions", set **Contents** to **Read and write**
   - Generate the token, paste it into the dashboard's connect screen along with the GitHub
     username and repo name.
5. That's it — the dashboard remembers the connection in that browser from then on.

## Day-to-day use (Tinkie)

Open `admin.html` (bookmark it). From there:
- **Producten** — add a new item, edit an existing one's name/category/subcategory/description,
  add or remove photos, reorder them, pick which photo is the cover shown on the overview page.
- **Categorieën** — add/rename the product categories, plus the onderverdelingen (subcategories)
  nested under Kleine Lederwaren.
- **Over mij** — edit the About text and photo.
- **Aanwezigheid** — add/remove upcoming markets; past ones automatically move to "eerder te
  vinden op" on the public site.
- **Instellingen** — business name, tagline, contact info, accent color, logo.

Every "Opslaan & publiceren" button is one save = one commit = one site update. Orders placed via
the **Bestellen** page don't go through the dashboard at all — they land directly in Netlify's
Forms dashboard (and Johnny's inbox, once notifications are set up — see above).

## Local preview (for development)

No install needed beyond Python (already used to import the photos):

```
python -m http.server 8123
```

Then open `http://localhost:8123`. Two things only work once this is actually live on Netlify,
not in local preview: the admin dashboard's Save buttons (they commit to the GitHub repo, so need
a real connection) and the **Bestellen** form (Netlify Forms only exists on Netlify's own
infrastructure — submitting it locally will show the error message, which is expected).

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
