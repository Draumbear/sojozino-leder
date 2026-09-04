// Shared across every public page: loads data/site.json, injects the header
// (logo + nav) and footer, applies the accent color, and wires up the
// mobile nav toggle + scroll-reveal animation. Each page's own <div id="siteHeader">
// / <div id="siteFooter"> placeholders get filled in here so nav/footer stay
// identical everywhere without copy-pasting markup into every .html file.

const NAV_LINKS = [
  { href: 'index.html', label: 'Home' },
  { href: 'over-mij.html', label: 'Over mij' },
  { href: 'creaties.html', label: 'Creaties' },
  { href: 'bestellen.html', label: 'Bestellen' },
  { href: 'waar-vind-je-mij.html', label: 'Waar vind je mij' },
  { href: 'contact.html', label: 'Contact' },
];

function currentPage() {
  const p = window.location.pathname.split('/').pop();
  return p || 'index.html';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

async function loadSite() {
  const res = await fetch(`data/site.json?_=${Date.now()}`, { cache: 'no-store' });
  return res.json();
}

function renderHeader(site) {
  const el = document.getElementById('siteHeader');
  if (!el) return;
  const page = currentPage();
  const links = NAV_LINKS.map(l =>
    `<li><a href="${l.href}" class="${l.href === page ? 'active' : ''}">${escapeHTML(l.label)}</a></li>`
  ).join('');
  el.innerHTML = `
    <header class="site-header">
      <nav class="nav">
        <a href="index.html" class="brand">
          <img src="${escapeHTML(site.logo?.mark || 'assets/logo-mark.png')}" alt="${escapeHTML(site.businessName)}">
          <span class="brand-text">${escapeHTML(site.businessName)}<small>Handgemaakt leder</small></span>
        </a>
        <button class="nav-toggle" id="navToggle" aria-label="Menu"><span></span></button>
        <ul class="nav-links" id="navLinks">${links}</ul>
      </nav>
    </header>`;

  const toggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  if (toggle && navLinks) {
    toggle.addEventListener('click', () => navLinks.classList.toggle('open'));
  }
}

function renderFooter(site) {
  const el = document.getElementById('siteFooter');
  if (!el) return;
  el.innerHTML = `
    <footer class="site-footer">
      <div class="brand-text">${escapeHTML(site.businessName)}</div>
      <p style="max-width:40ch;margin:0 auto;">${escapeHTML(site.tagline || '')}</p>
      <div class="footer-links">
        <a href="creaties.html">Creaties</a>
        <a href="waar-vind-je-mij.html">Waar vind je mij</a>
        <a href="${escapeHTML(site.instagramUrl || '#')}" target="_blank" rel="noopener">Instagram</a>
        <a href="mailto:${escapeHTML(site.email || '')}">${escapeHTML(site.email || '')}</a>
        <a href="privacy.html">Privacy</a>
      </div>
      <div class="footer-meta">${escapeHTML(site.location || '')} — © ${new Date().getFullYear()} Tanguy Swerts</div>
    </footer>`;
}

// Hero wording, so it can be changed from the dashboard rather than by
// editing index.html. Each field is left alone when it's missing or empty,
// so the markup's own text stays as the fallback. The title is the one place
// a line break matters -- she controls where the line turns -- so newlines
// become <br> after escaping, never before.
function renderHero(site) {
  const set = (id, value, { allowBreaks = false } = {}) => {
    const el = document.getElementById(id);
    if (!el || !value) return;
    const safe = escapeHTML(value);
    el.innerHTML = allowBreaks ? safe.replace(/\r?\n/g, '<br>') : safe;
  };
  set('heroEyebrow', site.heroEyebrow);
  set('heroTitle', site.heroTitle, { allowBreaks: true });
  set('heroTagline', site.heroTagline);
  // Labels only -- where the two buttons go is structural, not wording.
  set('heroPrimaryBtn', site.heroPrimaryLabel);
  set('heroSecondaryBtn', site.heroSecondaryLabel);
}

// The Instagram call to action. Only ever lived in the footer and on the
// contact page, which is nowhere near the moment someone has just looked
// through his work. Rendered from site.instagramUrl so it follows the
// dashboard, and skipped entirely when no URL is set.
function renderInstagramCta(site) {
  const el = document.getElementById('instagramCta');
  if (!el) return;
  const url = (site.instagramUrl || '').trim();
  if (!url) { el.remove(); return; }
  const handle = url.replace(/\/+$/, '').split('/').pop();
  el.innerHTML = `
    <section class="section insta-cta">
      <div class="section-inner">
        <p class="eyebrow reveal">Volg het atelier</p>
        <h2 class="reveal">Nieuw werk zie je hier het eerst.</h2>
        <p class="reveal">Elk stuk dat de deur uitgaat passeert eerst op Instagram — samen met de markten waar je ${escapeHTML(site.businessName || 'Sojozino')} kan vinden.</p>
        <a class="btn reveal" href="${escapeHTML(url)}" target="_blank" rel="noopener">
          Volg ${escapeHTML(handle ? '@' + handle : 'op Instagram')}
        </a>
      </div>
    </section>`;
}

// A market's address as a link to a map. He can paste a Google Maps URL if he
// has one to hand, or just type the address -- typing is the likelier of the
// two on a phone, so both are accepted and a search URL is built from plain
// text. Deliberately a link and not an embedded map: an iframe would load
// Google on every visit and undo the point of self-hosting the fonts.
function mapsLink(address) {
  const value = (address || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
}

// A market's own website. Typed by hand, so "wapenplein.be" has to work as
// well as the full URL -- nobody types https:// on a phone. Anything carrying
// some other scheme is refused rather than guessed at: a link this site prints
// should only ever be an ordinary web address.
function externalLink(value) {
  const v = (value || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  return `https://${v}`;
}

function applyAccent(site) {
  if (site.accentColor) {
    document.documentElement.style.setProperty('--rust', site.accentColor);
  }
}

function initReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  items.forEach(el => io.observe(el));
}

let sitePromise = null;
function getSite() {
  if (!sitePromise) sitePromise = loadSite();
  return sitePromise;
}

// The hero uses the full logo (dragon + curved wordmark), the header uses
// the dragon on its own -- so a logo replaced through the dashboard has to
// update both, not just the header mark.
function applyHeroLogo(site) {
  const heroMark = document.querySelector('.hero-mark');
  if (heroMark && site.logo?.full) heroMark.src = site.logo.full;
}

document.addEventListener('DOMContentLoaded', async () => {
  const site = await getSite();
  renderHeader(site);
  renderFooter(site);
  applyAccent(site);
  applyHeroLogo(site);
  renderHero(site);
  renderInstagramCta(site);
  document.dispatchEvent(new CustomEvent('site:loaded', { detail: site }));
  // Late-added .reveal elements (e.g. rendered by a page's own script after
  // this fires) call initReveal() again themselves; call once now for pages
  // with static reveal content already in the DOM.
  initReveal();
});

// A category label attached to one item reads in the singular -- a card for
// one bag says "Handtas", not "Handtassen". Dutch plurals are too irregular to
// strip, so it's a field set in the dashboard; collective names like "Kleine
// lederwaren" have no singular and simply fall back. Category tiles, which
// stand for the whole group, keep the plural name.
function categoryLabel(cat) {
  return (cat && (cat.singular || cat.name)) || '';
}

window.SojozinoSite = { getSite, escapeHTML, initReveal, categoryLabel, mapsLink, externalLink };
