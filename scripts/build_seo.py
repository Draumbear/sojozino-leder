"""Generates robots.txt + sitemap.xml and keeps every page's <link rel=canonical>
in step with them.

Run it after adding or removing a page. Product pages come from
data/products-index.json, so the 47 creations stay listed as Johnny adds and
removes them -- but nothing here runs when he saves from the dashboard, so the
sitemap goes stale for new products until someone runs this. That is a fair
trade for a site with no build step: a slightly stale sitemap costs a little
crawl latency, while a build pipeline would cost the dashboard its independence.

SITE_ORIGIN is the one thing to change when the domain moves. A canonical URL
pointing at a domain that does not resolve is worse than none at all -- it tells
Google the real page lives somewhere broken -- so this stays on the origin the
site is actually served from until the new one is live.
"""

import hashlib
import json
import os
import re
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- change this, and re-run, the day sojozinoleder.be goes live -------------
SITE_ORIGIN = "https://draumbear.github.io/sojozino-leder"
# SITE_ORIGIN = "https://sojozinoleder.be"
# -----------------------------------------------------------------------------

# Pages worth finding in a search engine. index.html is deliberately absent:
# it is listed as the bare origin instead, so the homepage has one address
# rather than two.
PUBLIC_PAGES = [
    "over-mij.html",
    "creaties.html",
    "bestellen.html",
    "waar-vind-je-mij.html",
    "contact.html",
    "privacy.html",
]

# Reachable, but nothing a search result should ever point at: a dashboard
# nobody but Johnny can use, an error page, and a thank-you page that means
# nothing without the form submission that leads to it.
PRIVATE_PAGES = ["admin.html", "404.html", "bestellen-bedankt.html"]

CANONICAL_RE = re.compile(r'\n?[ \t]*<link rel="canonical"[^>]*>')
ROBOTS_META_RE = re.compile(r'\n?[ \t]*<meta name="robots"[^>]*>')


def url_for(page):
    return SITE_ORIGIN + "/" + ("" if page == "index.html" else page)


def lastmod(*paths):
    newest = max((os.path.getmtime(p) for p in paths if os.path.exists(p)), default=time.time())
    return time.strftime("%Y-%m-%d", time.gmtime(newest))


def set_head_tag(html, pattern, tag):
    """Replace an existing tag or insert one just before </head>."""
    if pattern.search(html):
        return pattern.sub("\n" + tag, html, count=1)
    return html.replace("</head>", tag + "\n</head>", 1)


def main():
    products = json.load(open(os.path.join(BASE, "data", "products-index.json"), encoding="utf-8"))

    # ---- canonicals -------------------------------------------------------
    # product.html is skipped on purpose: one static canonical there would tell
    # Google that all 47 creations are the same page. product-render.js sets it
    # per slug once it knows which one it is showing.
    touched = []
    for page in ["index.html"] + PUBLIC_PAGES:
        path = os.path.join(BASE, page)
        html = open(path, encoding="utf-8").read()
        updated = set_head_tag(html, CANONICAL_RE,
                               '<link rel="canonical" href="%s">' % url_for(page))
        if updated != html:
            open(path, "w", encoding="utf-8", newline="").write(updated)
            touched.append(page)

    for page in PRIVATE_PAGES:
        path = os.path.join(BASE, page)
        html = open(path, encoding="utf-8").read()
        updated = set_head_tag(html, ROBOTS_META_RE,
                               '<meta name="robots" content="noindex, nofollow">')
        if updated != html:
            open(path, "w", encoding="utf-8", newline="").write(updated)
            touched.append(page)

    # ---- sitemap ----------------------------------------------------------
    entries = [(SITE_ORIGIN + "/", lastmod(os.path.join(BASE, "index.html"),
                                           os.path.join(BASE, "data", "site.json")), "1.0")]
    for page in PUBLIC_PAGES:
        entries.append((url_for(page), lastmod(os.path.join(BASE, page),
                                               os.path.join(BASE, "data", "site.json")), "0.8"))
    for p in products:
        entries.append((
            "%s/product.html?slug=%s" % (SITE_ORIGIN, p["slug"]),
            lastmod(os.path.join(BASE, "data", "products", p["slug"] + ".json")),
            "0.6",
        ))

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, mod, prio in entries:
        lines += ["  <url>",
                  "    <loc>%s</loc>" % loc.replace("&", "&amp;"),
                  "    <lastmod>%s</lastmod>" % mod,
                  "    <priority>%s</priority>" % prio,
                  "  </url>"]
    lines.append("</urlset>")
    write(os.path.join(BASE, "sitemap.xml"), "\n".join(lines) + "\n")

    # ---- robots -----------------------------------------------------------
    robots = ["User-agent: *", "Allow: /", ""]
    robots += ["Disallow: /%s" % p for p in PRIVATE_PAGES]
    robots += ["", "Sitemap: %s/sitemap.xml" % SITE_ORIGIN, ""]
    write(os.path.join(BASE, "robots.txt"), "\n".join(robots))

    print("origin      %s" % SITE_ORIGIN)
    print("sitemap     %d urls (%d products)" % (len(entries), len(products)))
    print("head tags   %s" % (", ".join(touched) if touched else "already current"))


def write(path, text):
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != text:
        open(path, "w", encoding="utf-8", newline="").write(text)


if __name__ == "__main__":
    main()
