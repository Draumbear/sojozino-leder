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

function initSpotlight() {
  const prev = document.querySelector('.spotlight-nav.prev');
  const next = document.querySelector('.spotlight-nav.next');
  const main = document.getElementById('spotlightMain');
  const lightbox = document.getElementById('lightbox');
  const closeBtn = document.getElementById('lightboxClose');

  if (prev) prev.addEventListener('click', (e) => { e.stopPropagation(); setActive(index - 1); });
  if (next) next.addEventListener('click', (e) => { e.stopPropagation(); setActive(index + 1); });
  if (main && lightbox) main.addEventListener('click', () => { lightbox.hidden = false; });
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
  const catName = (categories.find(c => c.slug === data.category) || {}).name || '';

  document.title = `${data.name} — Sojozino`;

  const thumbs = images.map((img, i) =>
    `<img src="${escapeHTML(img.src)}" alt="${escapeHTML(img.alt || '')}" class="${i === 0 ? 'active' : ''}">`).join('');

  document.getElementById('productRoot').innerHTML = `
    <div class="product-detail">
      <div class="spotlight">
        <div class="spotlight-main" id="spotlightMain">
          <img id="spotlightImg" src="${escapeHTML(images[0].src)}" alt="${escapeHTML(images[0].alt || '')}">
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
