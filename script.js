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
  return `
    <a class="product-card reveal" href="product.html?slug=${encodeURIComponent(p.slug)}">
      <div class="thumb"><img src="${esc(p.cover?.src)}" alt="${esc(p.cover?.alt || p.name)}" loading="lazy"></div>
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

async function initHome() {
  const [products, categories, presence] = await Promise.all([
    loadJSON('data/products-index.json'),
    loadJSON('data/categories.json'),
    loadJSON('data/presence.json'),
  ]);
  const catByslug = Object.fromEntries((categories || []).map(c => [c.slug, c.name]));
  const enriched = (products || []).map(p => ({ ...p, categoryName: catByslug[p.category] || '' }));

  const featuredEl = document.getElementById('featuredGrid');
  if (featuredEl) {
    let featured = enriched.filter(p => p.featured);
    if (featured.length < 3) featured = enriched.slice(0, 6);
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
        </div>`;
    } else {
      marketEl.innerHTML = '<p class="empty-note">Binnenkort meer nieuws over waar je Sojozino kan vinden.</p>';
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
      return { ...p, categoryName: cat?.name || '', subcategoryName: sub?.name || '' };
    })
    .sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.order || 0) - (b.order || 0));

  const grid = document.getElementById('productGrid');
  const filterBar = document.getElementById('filterBar');
  const subFilterBar = document.getElementById('subFilterBar');
  if (!grid) return;

  let activeCat = 'all';
  let activeSub = 'all';

  function render() {
    let list = activeCat === 'all' ? enriched : enriched.filter(p => p.category === activeCat);
    if (activeCat !== 'all' && activeSub !== 'all') list = list.filter(p => p.subcategory === activeSub);
    grid.innerHTML = list.map(productCardHTML).join('') ||
      '<p class="empty-note">Geen creaties in deze categorie.</p>';
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
      `<button class="filter-pill${c.slug === 'all' ? ' active' : ''}" data-cat="${esc(c.slug)}">${esc(c.name)}</button>`
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

async function initPresence() {
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
      </div>`;
  }

  upcomingEl.innerHTML = upcoming.length
    ? upcoming.map(m => cardHTML(m, false)).join('')
    : '<p class="presence-empty">Binnenkort meer nieuws over waar je Sojozino kan vinden — hou Instagram in de gaten.</p>';

  if (pastEl) {
    pastEl.innerHTML = past.map(m => cardHTML(m, true)).join('');
    const pastSection = document.getElementById('pastSection');
    if (pastSection) pastSection.hidden = past.length === 0;
  }

  window.SojozinoSite.initReveal();
}

document.addEventListener('site:loaded', () => {
  if (document.getElementById('featuredGrid') || document.getElementById('nextMarketTeaser')) initHome();
  if (document.getElementById('productGrid')) initGallery();
  if (document.getElementById('upcomingGrid')) initPresence();
});
