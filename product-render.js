// Product detail page: reads ?slug=<slug> from the URL, fetches
// data/products/<slug>.json, and renders:
//   - a variant picker (colour/style swatches) when the product has more
//     than one variant -- picking one swaps the whole spotlight gallery,
//     the way Amazon's colour swatches do, instead of mixing every
//     variant's photos into one long scroll
//   - the spotlight gallery for whichever variant is active: main image +
//     thumbnail strip + prev/next arrows + keyboard arrows + swipe +
//     click-to-zoom lightbox
//   - name/category/description

function escapeHTML(str) {
  // Quotes as well as angle brackets. The div/textContent trick escapes < > &
  // but leaves " and ' alone, which is silently fine in text and wrong in an
  // attribute: a value containing a quote closes the attribute and everything
  // after it is parsed as markup. Most of this file's interpolations are in
  // attributes.
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let product = null;
let variantIndex = 0;
let photoIndex = 0;

function currentVariant() { return product.variants[variantIndex]; }
function currentImages() { return currentVariant().images; }

function renderGallery() {
  const images = currentImages();
  photoIndex = 0;
  const img = images[0];

  const main = document.getElementById('spotlightImg');
  main.src = img.src; main.alt = img.alt || '';
  const lb = document.getElementById('lightboxImg');
  lb.src = img.src; lb.alt = img.alt || '';

  const multi = images.length > 1;
  document.getElementById('spotlightPrev').hidden = !multi;
  document.getElementById('spotlightNext').hidden = !multi;

  const thumbsEl = document.getElementById('spotlightThumbs');
  if (multi) {
    thumbsEl.hidden = false;
    thumbsEl.innerHTML = images.map((im, i) =>
      `<img src="${escapeHTML(thumbUrl(im.src))}" data-full="${escapeHTML(im.src)}"
            alt="${escapeHTML(im.alt || '')}" class="${i === 0 ? 'active' : ''}" data-idx="${i}"
            loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async">`).join('');
  } else {
    thumbsEl.hidden = true;
    thumbsEl.innerHTML = '';
  }

  updateLightboxChrome();
  // Deferred: the photo actually on screen should not queue behind its
  // neighbours for bandwidth.
  if (multi) setTimeout(preloadNeighbours, 400);
}

// Thumbnails live in a thumbs/ folder beside the original, written by
// scripts/build_thumbs.py. The path is derived rather than stored, so nothing
// has to be kept in sync -- and a photo Johnny uploaded since that script last
// ran simply has no thumb, which the error handler below turns back into the
// original instead of a broken image.
function thumbUrl(src) {
  const cut = src.lastIndexOf('/');
  return cut < 0 ? src : `${src.slice(0, cut)}/thumbs/${src.slice(cut + 1)}`;
}

// Capturing, on the document: <img onerror> would be an inline handler, which
// the site's Content-Security-Policy forbids, and error events do not bubble.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.dataset.full && !img.src.endsWith(img.dataset.full)) {
    img.src = img.dataset.full;
  }
}, true);

// Clicking through used to feel instant for the wrong reason: the thumbnail
// strip had already downloaded every full-size photo, so the next one was
// always in the cache. Now that the strip costs 5 KB a photo instead of 700,
// that accident is gone and the next click waits on a fresh download. Fetching
// the two neighbours in the background puts the responsiveness back without
// putting the eight megabytes back -- browsing a gallery means going forward or
// back, never jumping to photo seventeen.
function preloadNeighbours() {
  const images = currentImages();
  if (images.length < 2) return;
  for (const step of [1, -1]) {
    const im = images[((photoIndex + step) % images.length + images.length) % images.length];
    if (im && im.src) new Image().src = im.src;
  }
}

function setPhoto(i) {
  const images = currentImages();
  photoIndex = ((i % images.length) + images.length) % images.length;
  const img = images[photoIndex];
  document.getElementById('spotlightImg').src = img.src;
  document.getElementById('spotlightImg').alt = img.alt || '';
  document.getElementById('lightboxImg').src = img.src;
  document.getElementById('lightboxImg').alt = img.alt || '';
  document.querySelectorAll('#spotlightThumbs img').forEach((t, i2) => {
    t.classList.toggle('active', i2 === photoIndex);
  });
  updateLightboxChrome();
  preloadNeighbours();
}

// The lightbox's arrows and counter only make sense with more than one photo
// in the active variant, and the count changes when variants are swapped.
function updateLightboxChrome() {
  const images = currentImages();
  const multi = images.length > 1;
  document.getElementById('lightboxPrev').hidden = !multi;
  document.getElementById('lightboxNext').hidden = !multi;
  const counter = document.getElementById('lightboxCounter');
  counter.hidden = !multi;
  counter.textContent = multi ? `${photoIndex + 1} / ${images.length}` : '';
}

function updateVariantLabel() {
  const el = document.getElementById('variantCurrent');
  if (!el) return;
  const v = product.variants[variantIndex];
  el.textContent = v.name || `Variant ${variantIndex + 1}`;
}

function setVariant(vi) {
  if (vi === variantIndex) return;
  variantIndex = ((vi % product.variants.length) + product.variants.length) % product.variants.length;
  document.querySelectorAll('.variant-swatch').forEach((el, i) => {
    el.classList.toggle('active', i === variantIndex);
  });
  updateVariantLabel();
  renderGallery();
}

// Swipe threshold in px before a touch gesture counts as prev/next rather
// than a tap or a scroll.
const SWIPE_THRESHOLD = 40;

function addSwipe(el, onPrev, onNext) {
  if (!el) return;
  let startX = null, startY = null;
  el.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    startX = null;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) onNext(); else onPrev();
    }
  }, { passive: true });
}

function initSpotlight() {
  const prev = document.getElementById('spotlightPrev');
  const next = document.getElementById('spotlightNext');
  const main = document.getElementById('spotlightMain');
  const zoomBtn = document.getElementById('spotlightZoom');
  const lightbox = document.getElementById('lightbox');
  const closeBtn = document.getElementById('lightboxClose');
  const thumbsEl = document.getElementById('spotlightThumbs');
  const swatchesEl = document.getElementById('variantSwatches');
  const lbPrev = document.getElementById('lightboxPrev');
  const lbNext = document.getElementById('lightboxNext');

  prev.addEventListener('click', (e) => { e.stopPropagation(); setPhoto(photoIndex - 1); });
  next.addEventListener('click', (e) => { e.stopPropagation(); setPhoto(photoIndex + 1); });
  lbPrev.addEventListener('click', (e) => { e.stopPropagation(); setPhoto(photoIndex - 1); });
  lbNext.addEventListener('click', (e) => { e.stopPropagation(); setPhoto(photoIndex + 1); });

  // Clicking the photo opens the full-size lightbox — stepping through the
  // gallery is what the prev/next arrows are for, not a click on the image.
  main.addEventListener('click', (e) => {
    if (e.target.closest('.spotlight-nav')) return;
    lightbox.hidden = false;
  });
  zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); lightbox.hidden = false; });
  closeBtn.addEventListener('click', () => { lightbox.hidden = true; });
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.hidden = true; });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') setPhoto(photoIndex - 1);
    if (e.key === 'ArrowRight') setPhoto(photoIndex + 1);
    if (e.key === 'Escape') lightbox.hidden = true;
  });

  // Delegated (not bound per-<img>) since the thumbnail strip's contents
  // are replaced whenever the active variant changes.
  thumbsEl.addEventListener('click', (e) => {
    const t = e.target.closest('img[data-idx]');
    if (t) setPhoto(Number(t.dataset.idx));
  });
  if (swatchesEl) {
    swatchesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.variant-swatch');
      if (btn) setVariant(Number(btn.dataset.idx));
    });
  }

  addSwipe(main, () => setPhoto(photoIndex - 1), () => setPhoto(photoIndex + 1));
  addSwipe(lightbox, () => setPhoto(photoIndex - 1), () => setPhoto(photoIndex + 1));
}

function renderError(message) {
  const wrap = document.getElementById('productRoot');
  if (wrap) wrap.innerHTML = `<div class="section" style="padding-top:8rem;text-align:center;"><h1>${escapeHTML(message)}</h1><a class="btn outline" href="creaties.html" style="margin-top:1.5rem;">&larr; Terug naar creaties</a></div>`;
}

async function renderProduct() {
  const slug = new URLSearchParams(window.location.search).get('slug');
  if (!slug) { renderError('Creatie niet gevonden'); return; }

  let data, categories;
  try {
    const [pRes, cRes] = await Promise.all([
      fetch(`data/products/${slug}.json?_=${Date.now()}`, { cache: 'no-store' }),
      fetch(`data/categories.json?_=${Date.now()}`, { cache: 'no-store' }),
    ]);
    if (!pRes.ok) throw new Error('not found');
    data = await pRes.json();
    categories = cRes.ok ? await cRes.json() : [];
  } catch {
    renderError('Creatie niet gevonden');
    return;
  }

  // Backward-compatible: older product files (or hand-edited ones) may still
  // use a flat `images` array instead of `variants`.
  product = data;
  if (!product.variants || !product.variants.length) {
    const images = (data.images && data.images.length) ? data.images : [{ src: 'assets/logo-mark.png', alt: data.name }];
    product = { ...data, variants: [{ name: null, images }] };
  }
  variantIndex = 0;

  const cat = categories.find(c => c.slug === data.category) || {};
  const sub = (cat.subcategories || []).find(s => s.slug === data.subcategory);
  const catLabel = window.SojozinoSite.categoryLabel;
  // The more specific of the two wins: a toilettas is a toilettas, and saying
  // it lives under kleine lederwaren adds nothing on the product's own page.
  const catName = sub ? catLabel(sub) : catLabel(cat);

  document.title = `${data.name} — Sojozino`;
  const canonical = document.querySelector('link[rel="canonical"]') ||
    document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'canonical' }));
  canonical.href = `${location.origin}${location.pathname}?slug=${encodeURIComponent(slug)}`;
  const desc = document.querySelector('meta[name="description"]');
  const text = (data.description || `${data.name} — handgemaakt in leder door Sojozino.`).slice(0, 300);
  if (desc) desc.content = text;

  // product is normalised into variants above; the flat images array only
  // exists on the raw file.
  const cover = product.variants[0]?.images?.[0]?.src || data.cover?.src;
  const meta = {
    'og:title': `${data.name} — Sojozino`,
    'og:description': text,
    'og:url': canonical.href,
    'twitter:title': `${data.name} — Sojozino`,
    'twitter:description': text,
  };
  if (cover) {
    meta['og:image'] = new URL(cover, location.href).href;
    meta['twitter:image'] = meta['og:image'];
  }
  for (const [key, value] of Object.entries(meta)) {
    const el = document.querySelector(`meta[property="${key}"], meta[name="${key}"]`);
    if (el) el.content = value;
  }

  // What puts a creation's photo in Google's image results rather than leaving
  // it as an anonymous file. No price and no availability: nothing here is sold
  // from the site, and inventing either would be a claim Google holds him to.
  const photos = product.variants.flatMap(v => v.images || [])
    .map(im => new URL(im.src, location.href).href).slice(0, 8);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: data.name,
    description: text,
    url: canonical.href,
    brand: { '@type': 'Brand', name: 'Sojozino' },
    material: 'Leder',
  };
  if (photos.length) ld.image = photos;
  if (catName) ld.category = catName;
  const holder = document.getElementById('productSchema') ||
    document.head.appendChild(Object.assign(document.createElement('script'),
      { type: 'application/ld+json', id: 'productSchema' }));
  holder.textContent = JSON.stringify(ld, null, 2);

  // Variant names live in a hover/focus tooltip rather than under each
  // swatch: printed labels wrap to two or three lines at different lengths,
  // which pushed the squares to uneven heights.
  const hasVariants = product.variants.length > 1;
  const swatchesHTML = hasVariants ? `
    <div class="variant-picker">
      <p class="eyebrow">Kies een variant</p>
      <div class="variant-swatches" id="variantSwatches">
        ${product.variants.map((v, i) => {
          const label = v.name || `Variant ${i + 1}`;
          return `
          <button type="button" class="variant-swatch${i === 0 ? ' active' : ''}" data-idx="${i}"
                  title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}">
            <img src="${escapeHTML(thumbUrl(v.images[0]?.src || ''))}" data-full="${escapeHTML(v.images[0]?.src || '')}" alt="" loading="lazy" decoding="async">
            <span>${escapeHTML(label)}</span>
          </button>`;
        }).join('')}
      </div>
      <p class="variant-current" id="variantCurrent"></p>
    </div>` : '';

  document.getElementById('productRoot').innerHTML = `
    <div class="product-detail">
      <a class="back-link" href="creaties.html">&larr; Terug naar creaties</a>
      <div class="spotlight">
        <div class="spotlight-main" id="spotlightMain">
          <img id="spotlightImg" src="" alt="" fetchpriority="high" decoding="async">
          <button class="spotlight-zoom" id="spotlightZoom" aria-label="Foto vergroten" type="button"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4.8-4.8"></path></svg></button>
          <div class="spotlight-nav prev" id="spotlightPrev" aria-label="Vorige foto">&#8249;</div>
          <div class="spotlight-nav next" id="spotlightNext" aria-label="Volgende foto">&#8250;</div>
        </div>
        <div class="spotlight-thumbs" id="spotlightThumbs"></div>
      </div>
      <div class="product-info">
        ${catName ? `<span class="cat-tag">${escapeHTML(catName)}</span>` : ''}
        <h1>${escapeHTML(data.name)}</h1>
        <p>${escapeHTML(data.description || '')}</p>
        ${swatchesHTML}
      </div>
    </div>
    <div class="lightbox" id="lightbox" hidden>
      <button class="lightbox-close" id="lightboxClose" aria-label="Sluiten">&times;</button>
      <button class="lightbox-nav prev" id="lightboxPrev" aria-label="Vorige foto" type="button">&#8249;</button>
      <img id="lightboxImg" src="" alt="">
      <button class="lightbox-nav next" id="lightboxNext" aria-label="Volgende foto" type="button">&#8250;</button>
      <div class="lightbox-counter" id="lightboxCounter"></div>
    </div>`;

  initSpotlight();
  updateVariantLabel();
  renderGallery();
}

document.addEventListener('site:loaded', renderProduct);
