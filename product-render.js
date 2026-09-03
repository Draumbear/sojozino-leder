// Product detail page: reads ?slug=<slug> from the URL, fetches
// data/products/<slug>.json, and renders the spotlight gallery (main image +
// thumbnail strip + prev/next + keyboard arrows + click-to-zoom lightbox)
// plus name/category/description.

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

let images = [];
let index = 0;

function setActive(i) {
  index = ((i % images.length) + images.length) % images.length;
  const img = images[index];
  const main = document.getElementById('spotlightImg');
  const lb = document.getElementById('lightboxImg');
  if (main) { main.src = img.src; main.alt = img.alt || ''; }
  if (lb) { lb.src = img.src; lb.alt = img.alt || ''; }
  document.querySelectorAll('.spotlight-thumbs img').forEach((t, i2) => {
    t.classList.toggle('active', i2 === index);
  });
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
  const prev = document.querySelector('.spotlight-nav.prev');
  const next = document.querySelector('.spotlight-nav.next');
  const main = document.getElementById('spotlightMain');
  const zoomBtn = document.getElementById('spotlightZoom');
  const lightbox = document.getElementById('lightbox');
  const closeBtn = document.getElementById('lightboxClose');

  if (prev) prev.addEventListener('click', (e) => { e.stopPropagation(); setActive(index - 1); });
  if (next) next.addEventListener('click', (e) => { e.stopPropagation(); setActive(index + 1); });

  // Clicking the photo itself steps through the gallery — left half = previous,
  // right half = next — so browsing a product's photos doesn't require aiming
  // for the small arrow buttons. Zooming in has its own dedicated control.
  if (main) {
    main.addEventListener('click', (e) => {
      if (e.target.closest('.spotlight-nav') || e.target.closest('#spotlightZoom')) return;
      if (images.length < 2) return;
      const rect = main.getBoundingClientRect();
      const clickedLeftHalf = (e.clientX - rect.left) < rect.width / 2;
      setActive(clickedLeftHalf ? index - 1 : index + 1);
    });
  }
  if (zoomBtn && lightbox) zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); lightbox.hidden = false; });
  if (closeBtn && lightbox) closeBtn.addEventListener('click', () => { lightbox.hidden = true; });
  if (lightbox) lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.hidden = true; });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') setActive(index - 1);
    if (e.key === 'ArrowRight') setActive(index + 1);
    if (e.key === 'Escape' && lightbox) lightbox.hidden = true;
  });

  document.querySelectorAll('.spotlight-thumbs img').forEach((t, i) => {
    t.addEventListener('click', () => setActive(i));
  });

  addSwipe(main, () => setActive(index - 1), () => setActive(index + 1));
  addSwipe(lightbox, () => setActive(index - 1), () => setActive(index + 1));
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

  images = data.images && data.images.length ? data.images : [{ src: 'assets/logo-mark.png', alt: data.name }];
  const cat = categories.find(c => c.slug === data.category) || {};
  const sub = (cat.subcategories || []).find(s => s.slug === data.subcategory);
  const catName = sub ? `${cat.name} — ${sub.name}` : (cat.name || '');

  document.title = `${data.name} — Sojozino`;

  const thumbs = images.map((img, i) =>
    `<img src="${escapeHTML(img.src)}" alt="${escapeHTML(img.alt || '')}" class="${i === 0 ? 'active' : ''}">`).join('');

  document.getElementById('productRoot').innerHTML = `
    <div class="product-detail">
      <div class="spotlight">
        <div class="spotlight-main" id="spotlightMain">
          <img id="spotlightImg" src="${escapeHTML(images[0].src)}" alt="${escapeHTML(images[0].alt || '')}">
          <button class="spotlight-zoom" id="spotlightZoom" aria-label="Foto vergroten" type="button">&#128269;</button>
          ${images.length > 1 ? `
            <div class="spotlight-nav prev" aria-label="Vorige foto">&#8249;</div>
            <div class="spotlight-nav next" aria-label="Volgende foto">&#8250;</div>` : ''}
        </div>
        ${images.length > 1 ? `<div class="spotlight-thumbs">${thumbs}</div>` : ''}
      </div>
      <div class="product-info">
        <a class="back-link" href="creaties.html">&larr; Terug naar creaties</a>
        ${catName ? `<span class="cat-tag">${escapeHTML(catName)}</span>` : ''}
        <h1>${escapeHTML(data.name)}</h1>
        <p>${escapeHTML(data.description || '')}</p>
      </div>
    </div>
    <div class="lightbox" id="lightbox" hidden>
      <button class="lightbox-close" id="lightboxClose" aria-label="Sluiten">&times;</button>
      <img id="lightboxImg" src="${escapeHTML(images[0].src)}" alt="${escapeHTML(images[0].alt || '')}">
    </div>`;

  initSpotlight();
}

document.addEventListener('site:loaded', renderProduct);
