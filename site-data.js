// Shared across every public page: loads data/site.json, injects the header
// (logo + nav) and footer, and wires up the
// mobile nav toggle + scroll-reveal animation. Each page's own <div id="siteHeader">
// / <div id="siteFooter"> placeholders get filled in here so nav/footer stay
// identical everywhere without copy-pasting markup into every .html file.

// The pages, and what they are called by default. The names are his to change
// from the dashboard -- site.navLabels overrides by filename -- but which pages
// exist, and where they live, stays here: renaming a menu item should never be
// able to break a link.
const NAV_LINKS = [
  { href: 'index.html', label: 'Home' },
  { href: 'over-mij.html', label: 'Over mij' },
  { href: 'creaties.html', label: 'Creaties' },
  { href: 'bestellen.html', label: 'Bestellen' },
  { href: 'waar-vind-je-mij.html', label: 'Waar vind je mij' },
  { href: 'contact.html', label: 'Contact' },
];

function navLabel(site, href) {
  const custom = ((site && site.navLabels || {})[href] || '').trim();
  return custom || (NAV_LINKS.find(l => l.href === href) || {}).label || href;
}

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
    `<li><a href="${l.href}" class="${l.href === page ? 'active' : ''}">${escapeHTML(navLabel(site, l.href))}</a></li>`
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
        ${site.instagramUrl ? `<a class="nav-instagram" href="${escapeHTML(site.instagramUrl)}" target="_blank" rel="noopener" aria-label="Sojozino op Instagram" title="Volg op Instagram">${INSTAGRAM_SVG}</a>` : ''}
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
        <a href="creaties.html">${escapeHTML(navLabel(site, 'creaties.html'))}</a>
        <a href="waar-vind-je-mij.html">${escapeHTML(navLabel(site, 'waar-vind-je-mij.html'))}</a>
        <a href="${escapeHTML(site.instagramUrl || '#')}" target="_blank" rel="noopener">Instagram</a>
        <a href="mailto:${escapeHTML(site.email || '')}">${escapeHTML(site.email || '')}</a>
        <a href="privacy.html">Privacy</a>
      </div>
      <div class="footer-meta">${escapeHTML(site.location || '')} — © ${new Date().getFullYear()} Tanguy Swerts</div>
    </footer>`;
}

// Fills an element from site.json, leaving the markup's own text in place when
// the field is missing or empty. Newlines become <br> only where the author is
// meant to control the line break, and always after escaping.
function setEditableText(id, value, { allowBreaks = false } = {}) {
  const el = document.getElementById(id);
  if (!el || !value) return;
  const safe = escapeHTML(value);
  el.innerHTML = allowBreaks ? safe.replace(/\r?\n/g, '<br>') : safe;
}

function renderHero(site) {
  setEditableText('heroEyebrow', site.heroEyebrow);
  setEditableText('heroTitle', site.heroTitle, { allowBreaks: true });
  setEditableText('heroTagline', site.heroTagline);
  // Labels only -- where the two buttons go is structural, not wording.
  setEditableText('heroPrimaryBtn', site.heroPrimaryLabel);
  setEditableText('heroSecondaryBtn', site.heroSecondaryLabel);
}

// The contact page was written into the markup the same way the hero was, so
// changing a word meant editing the file.
function renderContact(site) {
  setEditableText('contactHeading', site.contactHeading, { allowBreaks: true });
  setEditableText('contactIntro', site.contactIntro);
}

function renderOrderPage(site) {
  setEditableText('orderEyebrow', site.orderEyebrow);
  setEditableText('orderHeading', site.orderHeading, { allowBreaks: true });
  setEditableText('orderIntro', site.orderIntro);
}

function renderMarketsPage(site) {
  setEditableText('marketsEyebrow', site.marketsEyebrow);
  setEditableText('marketsHeading', site.marketsHeading, { allowBreaks: true });
  setEditableText('marketsIntro', site.marketsIntro);
}

// Instagram: an icon in the header on every page, and a button where he has
// just been read about. A whole homepage section for it was too loud for what
// is really a "by the way". Both come from site.instagramUrl, so they follow
// the dashboard and vanish together if it is ever cleared.
const INSTAGRAM_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"></rect><circle cx="12" cy="12" r="4.2"></circle><circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none"></circle></svg>`;

function instagramHandle(url) {
  return url.replace(/\/+$/, '').split('/').pop();
}

// Where he announces markets, so it belongs in the sentence that admits there
// is nothing on the calendar yet. Returns '' when no URL is set, which keeps it
// out of the string entirely rather than leaving a dangling half-sentence.
function instagramNote(site) {
  const url = (site && site.instagramUrl || '').trim();
  if (!url) return '';
  const handle = instagramHandle(url);
  return ` Hij kondigt ze het eerst aan op <a href="${escapeHTML(url)}" target="_blank" rel="noopener">${escapeHTML(handle ? '@' + handle : 'Instagram')}</a>.`;
}

function renderInstagramButton(site) {
  const el = document.getElementById('instagramButton');
  if (!el) return;
  const url = (site.instagramUrl || '').trim();
  if (!url) { el.remove(); return; }
  const handle = instagramHandle(url);
  el.innerHTML = `
    <a class="btn outline reveal" href="${escapeHTML(url)}" target="_blank" rel="noopener" style="margin-top:1rem;">
      ${INSTAGRAM_SVG} Volg ${escapeHTML(handle ? '@' + handle : 'op Instagram')}
    </a>`;
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

// The address itself is more use than the words "Website van de markt": it
// tells her which market before she clicks, and people recognise a domain.
// Long ones would push the card's layout around, so those fall back -- first
// to the domain alone, then to the generic label.
const LINK_LABEL_MAX = 34;

function linkLabel(url) {
  const tidy = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
  if (tidy.length <= LINK_LABEL_MAX) return tidy;
  const host = tidy.split('/')[0];
  return host.length <= LINK_LABEL_MAX ? host : 'Website van de markt';
}

// Where the market is: the town and the street on one block rather than two
// lines separated by the description. The address is worth printing rather
// than hiding behind a link -- someone standing in the street wants to read
// it -- but a pasted Maps URL is not something to read out, so that is left
// to the button.
function whereBlock(entry) {
  const town = (entry.location || '').trim();
  const raw = (entry.address || '').trim();
  const street = /^https?:\/\//i.test(raw) ? '' : raw;
  if (!town && !street) return '';
  return `<p class="presence-where">
    ${town ? `<span class="pw-town">${escapeHTML(town)}</span>` : ''}
    ${street ? `<span class="pw-street">${escapeHTML(street)}</span>` : ''}
  </p>`;
}

// The card's footer. Side by side, because two stacked links in a narrow card
// read as a list of things to do rather than a pair of ways to the same place.
function marketLinks(entry) {
  const map = mapsLink(entry.address);
  const site = externalLink(entry.website);
  if (!map && !site) return '';
  return `<div class="presence-links">
    ${map ? `<a href="${escapeHTML(map)}" target="_blank" rel="noopener">Openen in Maps &#8599;</a>` : ''}
    ${site ? `<a href="${escapeHTML(site)}" target="_blank" rel="noopener">${escapeHTML(linkLabel(site))} &#8599;</a>` : ''}
  </div>`;
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
  applyHeroLogo(site);
  renderHero(site);
  renderContact(site);
  renderOrderPage(site);
  renderMarketsPage(site);
  renderInstagramButton(site);
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

window.SojozinoSite = { getSite, escapeHTML, initReveal, categoryLabel, mapsLink, externalLink, instagramNote, whereBlock, marketLinks };
