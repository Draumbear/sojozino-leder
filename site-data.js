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
      </div>
      <div class="footer-meta">${escapeHTML(site.location || '')} — © ${new Date().getFullYear()} ${escapeHTML(site.businessName)}</div>
    </footer>`;
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
  document.dispatchEvent(new CustomEvent('site:loaded', { detail: site }));
  // Late-added .reveal elements (e.g. rendered by a page's own script after
  // this fires) call initReveal() again themselves; call once now for pages
  // with static reveal content already in the DOM.
  initReveal();
});

window.SojozinoSite = { getSite, escapeHTML, initReveal };
