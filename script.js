// Home + gallery page logic: loads categories/products-index/presence and
// renders the product grid (optionally filtered), featured picks, and the
// "next market" teaser. Runs after site-data.js has resolved data/site.json
// (listens for the 'site:loaded' event it dispatches) so header/footer are
// already in place.

async function loadJSON(path) {
  const res = await fetch(`${path}?_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

function productCardHTML(p) {
  const esc = window.SojozinoSite.escapeHTML;
  const catLabel = p.subcategoryName ? `${p.categoryName} — ${p.subcategoryName}` : (p.categoryName || '');
  // "fit" is set per photo by scripts/classify_covers.py: studio shots on a
  // white backdrop are contained (whole product visible, letterboxing
  // invisible against a white tile), busier photos fill the tile instead.
  const fit = p.fit === 'contain' ? ' fit-contain' : ' fit-cover';
  return `
    <a class="product-card reveal" href="product.html?slug=${encodeURIComponent(p.slug)}">
      <div class="thumb${fit}"><img src="${esc(p.cover?.src)}" alt="${esc(p.cover?.alt || p.name)}" loading="lazy"></div>
      <div class="info">
        <div class="cat">${esc(catLabel)}</div>
        <h3>${esc(p.name)}</h3>
      </div>
    </a>`;
}

function upcomingSorted(presence) {
  const today = new Date().toISOString().slice(0, 10);
  return [...(presence || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

async function initHome(site) {
  const [products, categories, presence] = await Promise.all([
    loadJSON('data/products-index.json'),
    loadJSON('data/categories.json'),
    loadJSON('data/presence.json'),
  ]);
  const catByslug = Object.fromEntries((categories || []).map(c => [c.slug, c]));
  const enriched = (products || []).map(p => ({ ...p, categoryName: window.SojozinoSite.categoryLabel(catByslug[p.category]) }));

  const featuredEl = document.getElementById('featuredGrid');
  if (featuredEl) {
    // Whatever Johnny has starred in the dashboard. Falls back to a spread
    // across categories (rather than the first six, which were all
    // handbags) until anything is starred.
    let featured = enriched.filter(p => p.featured);
    if (!featured.length) {
      const byCat = new Map();
      enriched.forEach(p => { if (!byCat.has(p.category)) byCat.set(p.category, p); });
      featured = [...byCat.values()];
      enriched.forEach(p => { if (featured.length < 6 && !featured.includes(p)) featured.push(p); });
    }
    featuredEl.innerHTML = featured.slice(0, 6).map(productCardHTML).join('') ||
      '<p class="empty-note">Binnenkort te zien.</p>';
  }

  const marketEl = document.getElementById('nextMarketTeaser');
  if (marketEl) {
    const today = new Date().toISOString().slice(0, 10);
    const next = upcomingSorted(presence).find(m => m.date >= today);
    if (next) {
      const esc = window.SojozinoSite.escapeHTML;
      const d = new Date(next.date + 'T00:00:00');
      const dateStr = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
      marketEl.innerHTML = `
        <div class="card presence-card reveal" style="max-width:480px;margin:0 auto;text-align:left;">
          <div class="presence-date"><span class="weekday">Volgende markt</span>${dateStr}</div>
          <h3>${esc(next.title)}</h3>
          <div class="presence-loc">${esc(next.location)}</div>
          ${next.description ? `<p>${esc(next.description)}</p>` : ''}
          <div class="presence-links">
            ${window.SojozinoSite.mapsLink(next.address) ? `<a href="${esc(window.SojozinoSite.mapsLink(next.address))}" target="_blank" rel="noopener">Bekijk op de kaart &#8599;</a>` : ''}
            ${window.SojozinoSite.externalLink(next.website) ? `<a href="${esc(window.SojozinoSite.externalLink(next.website))}" target="_blank" rel="noopener">Website van de markt &#8599;</a>` : ''}
          </div>
        </div>`;
    } else {
      // No date on the calendar yet, so point at the place he actually
      // announces them -- an empty panel is a dead end otherwise.
      marketEl.innerHTML = `<p class="empty-note">Binnenkort meer nieuws over waar je Sojozino kan vinden.${window.SojozinoSite.instagramNote(site)}</p>`;
    }
  }

  window.SojozinoSite.initReveal();
}

async function initGallery() {
  const [products, categories] = await Promise.all([
    loadJSON('data/products-index.json'),
    loadJSON('data/categories.json'),
  ]);
  const catByslug = Object.fromEntries((categories || []).map(c => [c.slug, c]));
  const enriched = (products || [])
    .map(p => {
      const cat = catByslug[p.category];
      const sub = (cat?.subcategories || []).find(s => s.slug === p.subcategory);
      const label = window.SojozinoSite.categoryLabel;
      return { ...p, categoryName: label(cat), subcategoryName: label(sub) };
    })
    .sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.order || 0) - (b.order || 0));

  const grid = document.getElementById('productGrid');
  const filterBar = document.getElementById('filterBar');
  const subFilterBar = document.getElementById('subFilterBar');
  if (!grid) return;

  // The homepage's category tiles link straight to a filtered view.
  const wanted = new URLSearchParams(window.location.search).get('cat');
  let activeCat = (wanted && catByslug[wanted]) ? wanted : 'all';
  let activeSub = 'all';

  function render() {
    if (activeCat === 'all') {
      // 47 items in one undifferentiated scroll is hard to navigate, so the
      // unfiltered view is grouped under category headings instead.
      const esc = window.SojozinoSite.escapeHTML;
      grid.innerHTML = '';
      grid.classList.add('grouped');
      const html = (categories || []).map(c => {
        const list = enriched.filter(p => p.category === c.slug);
        if (!list.length) return '';
        return `
          <section class="product-group">
            <h2 class="product-group-title reveal">${esc(c.name)} <span>${list.length}</span></h2>
            <div class="product-grid">${list.map(productCardHTML).join('')}</div>
          </section>`;
      }).join('');
      grid.innerHTML = html || '<p class="empty-note">Nog geen creaties.</p>';
    } else {
      grid.classList.remove('grouped');
      let list = enriched.filter(p => p.category === activeCat);
      if (activeSub !== 'all') list = list.filter(p => p.subcategory === activeSub);
      grid.innerHTML = list.map(productCardHTML).join('') ||
        '<p class="empty-note">Geen creaties in deze categorie.</p>';
    }
    window.SojozinoSite.initReveal();
  }

  function renderSubFilter() {
    if (!subFilterBar) return;
    const cat = catByslug[activeCat];
    const subs = cat?.subcategories || [];
    // Only show subcategories that actually have at least one product, plus "Alles".
    const usedSlugs = new Set(enriched.filter(p => p.category === activeCat).map(p => p.subcategory));
    const usable = subs.filter(s => usedSlugs.has(s.slug));
    if (!usable.length) { subFilterBar.innerHTML = ''; subFilterBar.hidden = true; return; }
    subFilterBar.hidden = false;
    const esc = window.SojozinoSite.escapeHTML;
    const pills = [{ slug: 'all', name: 'Alles' }, ...usable];
    subFilterBar.innerHTML = pills.map(s =>
      `<button class="filter-pill${s.slug === 'all' ? ' active' : ''}" data-sub="${esc(s.slug)}">${esc(s.name)}</button>`
    ).join('');
  }

  if (filterBar) {
    const esc = window.SojozinoSite.escapeHTML;
    const pills = [{ slug: 'all', name: 'Alles' }, ...(categories || [])];
    filterBar.innerHTML = pills.map(c =>
      `<button class="filter-pill${c.slug === activeCat ? ' active' : ''}" data-cat="${esc(c.slug)}">${esc(c.name)}</button>`
    ).join('');
    filterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-pill');
      if (!btn) return;
      activeCat = btn.dataset.cat;
      activeSub = 'all';
      filterBar.querySelectorAll('.filter-pill').forEach(b => b.classList.toggle('active', b === btn));
      renderSubFilter();
      render();
    });
  }

  if (subFilterBar) {
    subFilterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-pill');
      if (!btn) return;
      activeSub = btn.dataset.sub;
      subFilterBar.querySelectorAll('.filter-pill').forEach(b => b.classList.toggle('active', b === btn));
      render();
    });
  }

  renderSubFilter();
  render();
}

async function initPresence(site) {
  const presence = await loadJSON('data/presence.json');
  const upcomingEl = document.getElementById('upcomingGrid');
  const pastEl = document.getElementById('pastGrid');
  if (!upcomingEl) return;

  const esc = window.SojozinoSite.escapeHTML;
  const today = new Date().toISOString().slice(0, 10);
  const sorted = upcomingSorted(presence);
  const upcoming = sorted.filter(m => m.date >= today);
  const past = sorted.filter(m => m.date < today).reverse();

  function cardHTML(m, isPast) {
    const d = new Date(m.date + 'T00:00:00');
    const dateStr = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
    return `
      <div class="card presence-card reveal${isPast ? ' past' : ''}">
        <div class="presence-date"><span class="weekday">${isPast ? 'Was te vinden op' : ''}</span>${dateStr}</div>
        <h3>${esc(m.title)}</h3>
        <div class="presence-loc">${esc(m.location)}</div>
        ${m.description ? `<p>${esc(m.description)}</p>` : ''}
        <div class="presence-links">
          ${window.SojozinoSite.mapsLink(m.address) ? `<a href="${esc(window.SojozinoSite.mapsLink(m.address))}" target="_blank" rel="noopener">Bekijk op de kaart &#8599;</a>` : ''}
          ${window.SojozinoSite.externalLink(m.website) ? `<a href="${esc(window.SojozinoSite.externalLink(m.website))}" target="_blank" rel="noopener">Website van de markt &#8599;</a>` : ''}
        </div>
      </div>`;
  }

  upcomingEl.innerHTML = upcoming.length
    ? upcoming.map(m => cardHTML(m, false)).join('')
    : `<p class="presence-empty">Binnenkort meer nieuws over waar je Sojozino kan vinden.${window.SojozinoSite.instagramNote(site)}</p>`;

  if (pastEl) {
    pastEl.innerHTML = past.map(m => cardHTML(m, true)).join('');
    const pastSection = document.getElementById('pastSection');
    if (pastSection) pastSection.hidden = past.length === 0;
  }

  window.SojozinoSite.initReveal();
}

document.addEventListener('site:loaded', (e) => {
  const site = e.detail;
  if (document.getElementById('featuredGrid') || document.getElementById('nextMarketTeaser')) initHome(site);
  if (document.getElementById('productGrid')) initGallery();
  if (document.getElementById('upcomingGrid')) initPresence(site);
});
