// Sojozino admin dashboard. Talks straight to the GitHub Contents/Git Data
// API via admin-github.js's GitHubAPI class — every Save button below builds
// one commitBatch() call (JSON files + any new/removed images) so a single
// user action is a single atomic commit + a single GitHub Pages redeploy.
// No server, no build step: this file + admin-github.js + admin.html is the
// whole dashboard.

let api = null;
let state = {
  site: null,
  categories: [],
  productsIndex: [],
  presence: [],
};
// slug -> full product detail, fetched on demand when a product is opened.
const productCache = {};
// Files staged for the currently-open product editor: File objects not yet uploaded.
let pendingUploads = [];
// Existing images (already in the product) currently shown in the editor, in order.
let editorImages = [];
let editorCoverIndex = 0;
let editingSlug = null; // null while creating a new product

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function esc(str) { const d = document.createElement('div'); d.textContent = str == null ? '' : String(str); return d.innerHTML; }

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'item';
}

function uniqueSlug(base, excludeSlug) {
  let slug = base, n = 2;
  const taken = new Set(state.productsIndex.map(p => p.slug).filter(s => s !== excludeSlug));
  while (taken.has(slug)) { slug = `${base}-${n}`; n++; }
  return slug;
}

// ---------- Toasts ----------
function toast(message, type = 'info') {
  const container = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function setBusy(btn, busy, busyLabel = 'Bezig…') {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${esc(busyLabel)}`;
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}

// ---------- Connect flow ----------
function initConnect() {
  const saved = GitHubStore.load();
  if (saved) {
    $('#ghOwner').value = saved.owner || '';
    $('#ghRepo').value = saved.repo || '';
    $('#ghBranch').value = saved.branch || 'main';
    $('#ghToken').value = saved.token || '';
    connect(saved, { silent: true });
  }

  $('#connectBtn').addEventListener('click', () => {
    const cfg = {
      owner: $('#ghOwner').value.trim(),
      repo: $('#ghRepo').value.trim(),
      branch: $('#ghBranch').value.trim() || 'main',
      token: $('#ghToken').value.trim(),
    };
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      $('#connectError').textContent = 'Vul gebruikersnaam, repository en token in.';
      return;
    }
    connect(cfg, { silent: false });
  });

  $('#disconnectBtn').addEventListener('click', () => {
    GitHubStore.clear();
    api = null;
    $('#dashboard').classList.add('hidden');
    $('#connectPanel').classList.remove('hidden');
    setConnStatus(false);
  });
}

function setConnStatus(ok) {
  const el = $('#connStatus');
  el.textContent = ok ? 'Verbonden' : 'Niet verbonden';
  el.className = `conn-status ${ok ? 'ok' : 'off'}`;
  const live = $('#viewLiveLink');
  if (ok && api) {
    live.href = `https://${api.owner}.github.io/${api.repo}/`;
    live.classList.remove('hidden');
  } else {
    live.classList.add('hidden');
  }
}

async function connect(cfg, { silent }) {
  const btn = $('#connectBtn');
  setBusy(btn, true, 'Verbinden…');
  $('#connectError').textContent = '';
  try {
    const candidate = new GitHubAPI(cfg);
    await candidate.verify();
    api = candidate;
    GitHubStore.save(cfg);
    setConnStatus(true);
    $('#connectPanel').classList.add('hidden');
    $('#dashboard').classList.remove('hidden');
    await loadAll();
  } catch (e) {
    setConnStatus(false);
    if (!silent) $('#connectError').textContent = e.message;
    else $('#connectPanel').classList.remove('hidden');
  } finally {
    setBusy(btn, false);
  }
}

// ---------- Load ----------
async function loadAll() {
  const [site, categories, productsIndex, presence] = await Promise.all([
    api.getJSON('data/site.json'),
    api.getJSON('data/categories.json'),
    api.getJSON('data/products-index.json'),
    api.getJSON('data/presence.json'),
  ]);
  state.site = site || {};
  state.categories = categories || [];
  state.productsIndex = productsIndex || [];
  state.presence = presence || [];
  renderOverview();
  renderCategoriesTab();
  renderProductsTab();
  renderAboutTab();
  renderPresenceTab();
  renderSettingsTab();
}

// ---------- Tabs ----------
function initTabs() {
  $all('.admin-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.admin-tabs button').forEach(b => b.classList.toggle('active', b === btn));
      $all('.admin-tab').forEach(t => t.hidden = t.id !== `tab-${btn.dataset.tab}`);
    });
  });
}

// ---------- Overview ----------
function renderOverview() {
  $('#statProducts').textContent = state.productsIndex.length;
  $('#statCategories').textContent = state.categories.length;
  const today = new Date().toISOString().slice(0, 10);
  const next = [...state.presence].filter(p => p.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  $('#statNextMarket').textContent = next ? new Date(next.date + 'T00:00:00').toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) : '—';
}

// ---------- Categories ----------
function renderCategoriesTab() {
  const list = $('#categoriesList');
  if (!state.categories.length) {
    list.innerHTML = '<div class="empty-state">Nog geen categorieën.</div>';
  } else {
    list.innerHTML = state.categories.map(c => {
      const count = state.productsIndex.filter(p => p.category === c.slug).length;
      return `
      <div class="row-card" data-slug="${esc(c.slug)}">
        <div class="rc-info"><strong>${esc(c.name)}</strong><span>${count} product${count === 1 ? '' : 'en'} — ${esc(c.slug)}</span></div>
        <div class="rc-actions">
          <button class="btn-admin secondary small" data-action="rename-cat">Naam wijzigen</button>
          <button class="btn-admin danger small" data-action="delete-cat">Verwijderen</button>
        </div>
      </div>`;
    }).join('');
  }

  list.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const row = btn.closest('.row-card');
    const slug = row.dataset.slug;
    const cat = state.categories.find(c => c.slug === slug);
    if (btn.dataset.action === 'rename-cat') {
      const name = prompt('Nieuwe naam voor deze categorie:', cat.name);
      if (!name || !name.trim()) return;
      cat.name = name.trim();
      await saveCategories(`Categorie hernoemd: ${cat.name}`);
    } else if (btn.dataset.action === 'delete-cat') {
      const count = state.productsIndex.filter(p => p.category === slug).length;
      if (count > 0) { toast(`Kan niet verwijderen: ${count} product(en) zitten nog in "${cat.name}".`, 'err'); return; }
      if (!confirm(`Categorie "${cat.name}" verwijderen?`)) return;
      state.categories = state.categories.filter(c => c.slug !== slug);
      await saveCategories(`Categorie verwijderd: ${cat.name}`);
    }
  };

  $('#addCategoryBtn').onclick = async () => {
    const name = prompt('Naam van de nieuwe categorie:');
    if (!name || !name.trim()) return;
    const slug = uniqueCategorySlug(slugify(name));
    state.categories.push({ slug, name: name.trim(), order: state.categories.length + 1 });
    await saveCategories(`Categorie toegevoegd: ${name.trim()}`);
  };
}

function uniqueCategorySlug(base) {
  let slug = base, n = 2;
  const taken = new Set(state.categories.map(c => c.slug));
  while (taken.has(slug)) { slug = `${base}-${n}`; n++; }
  return slug;
}

async function saveCategories(message) {
  try {
    await api.commitBatch([{ path: 'data/categories.json', content: JSON.stringify(state.categories, null, 2) }], message);
    toast('Categorieën opgeslagen.', 'ok');
    renderCategoriesTab();
    renderProductsTab();
    renderOverview();
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ---------- Products list ----------
function renderProductsTab() {
  const catByslug = Object.fromEntries(state.categories.map(c => [c.slug, c.name]));
  const filterSel = $('#productCatFilter');
  filterSel.innerHTML = '<option value="all">Alle categorieën</option>' +
    state.categories.map(c => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('');

  function render() {
    const q = $('#productSearch').value.trim().toLowerCase();
    const cat = filterSel.value;
    const list = state.productsIndex
      .filter(p => (cat === 'all' || p.category === cat) && (!q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
    const listEl = $('#productsList');
    listEl.innerHTML = list.length ? list.map(p => `
      <div class="row-card" data-slug="${esc(p.slug)}">
        <img src="${esc(p.cover?.src || '')}" alt="">
        <div class="rc-info"><strong>${esc(p.name)}</strong><span>${esc(catByslug[p.category] || '—')}</span></div>
        <div class="rc-actions">
          <button class="btn-admin secondary small" data-action="edit">Bewerken</button>
          <button class="btn-admin danger small" data-action="delete">Verwijderen</button>
        </div>
      </div>`).join('') : '<div class="empty-state">Geen producten gevonden.</div>';
  }
  render();
  $('#productSearch').oninput = render;
  filterSel.onchange = render;

  $('#productsList').onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const slug = btn.closest('.row-card').dataset.slug;
    if (btn.dataset.action === 'edit') openProductEditor(slug);
    else if (btn.dataset.action === 'delete') deleteProduct(slug);
  };

  $('#newProductBtn').onclick = () => openProductEditor(null);
}

async function deleteProduct(slug) {
  const p = state.productsIndex.find(x => x.slug === slug);
  if (!p) return;
  if (!confirm(`"${p.name}" en al zijn foto's definitief verwijderen?`)) return;
  try {
    const detail = productCache[slug] || await api.getJSON(`data/products/${slug}.json`);
    const files = [
      { path: `data/products/${slug}.json`, delete: true },
      ...((detail?.images || []).map(img => ({ path: img.src, delete: true }))),
    ];
    state.productsIndex = state.productsIndex.filter(x => x.slug !== slug);
    files.push({ path: 'data/products-index.json', content: JSON.stringify(state.productsIndex, null, 2) });
    await api.commitBatch(files, `Product verwijderd: ${p.name}`);
    toast('Product verwijderd.', 'ok');
    renderProductsTab();
    renderOverview();
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ---------- Product editor ----------
async function openProductEditor(slug) {
  editingSlug = slug;
  pendingUploads = [];
  const panel = $('#productEditor');
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const catOptions = state.categories.map(c => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('');
  $('#pe-category').innerHTML = catOptions || '<option value="">Voeg eerst een categorie toe</option>';

  if (slug) {
    $('#pe-title').textContent = 'Product bewerken';
    let detail = productCache[slug];
    if (!detail) { detail = await api.getJSON(`data/products/${slug}.json`); productCache[slug] = detail; }
    $('#pe-name').value = detail.name || '';
    $('#pe-category').value = detail.category || '';
    $('#pe-description').value = detail.description || '';
    editorImages = (detail.images || []).map(img => ({ ...img }));
    const idx = state.productsIndex.find(p => p.slug === slug);
    editorCoverIndex = Math.max(0, editorImages.findIndex(img => img.src === idx?.cover?.src));
    if (editorCoverIndex < 0) editorCoverIndex = 0;
  } else {
    $('#pe-title').textContent = 'Nieuw product';
    $('#pe-name').value = '';
    $('#pe-category').value = state.categories[0]?.slug || '';
    $('#pe-description').value = '';
    editorImages = [];
    editorCoverIndex = 0;
  }
  renderImageManager();
}

function closeProductEditor() {
  $('#productEditor').classList.add('hidden');
  editingSlug = null;
  pendingUploads = [];
  editorImages = [];
}

function renderImageManager() {
  const wrap = $('#imageManager');
  const existingTiles = editorImages.map((img, i) => `
    <div class="image-tile${i === editorCoverIndex ? ' is-cover' : ''}" data-idx="${i}" data-kind="existing">
      ${i === editorCoverIndex ? '<span class="cover-badge">Cover</span>' : ''}
      <img src="${esc(img.src)}" alt="">
      <div class="tile-actions">
        <button data-action="cover" title="Als cover instellen">★</button>
        <button data-action="left" title="Naar links">←</button>
        <button data-action="right" title="Naar rechts">→</button>
        <button data-action="remove" title="Verwijderen">✕</button>
      </div>
    </div>`).join('');
  const pendingTiles = pendingUploads.map((f, i) => `
    <div class="image-tile" data-idx="${i}" data-kind="pending">
      <img src="${URL.createObjectURL(f)}" alt="">
      <div class="tile-actions"><button data-action="remove-pending">✕ nieuw</button></div>
    </div>`).join('');
  wrap.innerHTML = existingTiles + pendingTiles;

  wrap.onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const tile = btn.closest('.image-tile');
    const idx = Number(tile.dataset.idx);
    if (btn.dataset.action === 'cover') editorCoverIndex = idx;
    else if (btn.dataset.action === 'left' && idx > 0) {
      [editorImages[idx - 1], editorImages[idx]] = [editorImages[idx], editorImages[idx - 1]];
      if (editorCoverIndex === idx) editorCoverIndex--; else if (editorCoverIndex === idx - 1) editorCoverIndex++;
    } else if (btn.dataset.action === 'right' && idx < editorImages.length - 1) {
      [editorImages[idx + 1], editorImages[idx]] = [editorImages[idx], editorImages[idx + 1]];
      if (editorCoverIndex === idx) editorCoverIndex++; else if (editorCoverIndex === idx + 1) editorCoverIndex--;
    } else if (btn.dataset.action === 'remove') {
      editorImages.splice(idx, 1);
      if (editorCoverIndex >= editorImages.length) editorCoverIndex = Math.max(0, editorImages.length - 1);
    } else if (btn.dataset.action === 'remove-pending') {
      pendingUploads.splice(idx, 1);
    }
    renderImageManager();
  };
}

function initImageUpload() {
  const drop = $('#uploadDrop');
  const input = $('#uploadInput');
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = 'var(--a-rust)'; });
  drop.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.style.borderColor = '';
    addFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  function addFiles(fileList) {
    Array.from(fileList).filter(f => f.type.startsWith('image/')).forEach(f => pendingUploads.push(f));
    renderImageManager();
  }
}

async function saveProduct() {
  const name = $('#pe-name').value.trim();
  const category = $('#pe-category').value;
  const description = $('#pe-description').value.trim();
  if (!name) { toast('Geef het product een naam.', 'err'); return; }
  if (!category) { toast('Kies een categorie.', 'err'); return; }
  if (editorImages.length === 0 && pendingUploads.length === 0) { toast('Voeg minstens één foto toe.', 'err'); return; }

  const btn = $('#saveProductBtn');
  setBusy(btn, true, 'Opslaan…');
  try {
    const slug = editingSlug || uniqueSlug(slugify(name), null);
    const files = [];

    // Upload any newly-added photos.
    for (const file of pendingUploads) {
      const prepared = await api.prepareUpload(file, `assets/products/${slug}`);
      files.push({ path: prepared.path, content: prepared.content });
      editorImages.push({ src: prepared.path, alt: name });
    }
    pendingUploads = [];

    const cover = editorImages[Math.min(editorCoverIndex, editorImages.length - 1)] || editorImages[0];
    const productData = { slug, name, category, description, images: editorImages };
    files.push({ path: `data/products/${slug}.json`, content: JSON.stringify(productData, null, 2) });

    const existingIdx = state.productsIndex.findIndex(p => p.slug === slug);
    const indexEntry = {
      slug, name, category, cover: { src: cover.src, alt: cover.alt || name },
      order: existingIdx >= 0 ? state.productsIndex[existingIdx].order : state.productsIndex.length + 1,
      featured: existingIdx >= 0 ? !!state.productsIndex[existingIdx].featured : false,
    };
    if (existingIdx >= 0) state.productsIndex[existingIdx] = indexEntry;
    else state.productsIndex.push(indexEntry);
    files.push({ path: 'data/products-index.json', content: JSON.stringify(state.productsIndex, null, 2) });

    await api.commitBatch(files, `${editingSlug ? 'Product bijgewerkt' : 'Product toegevoegd'}: ${name}`);
    productCache[slug] = productData;
    toast('Product opgeslagen.', 'ok');
    closeProductEditor();
    renderProductsTab();
    renderOverview();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setBusy(btn, false);
  }
}

// ---------- About ----------
function renderAboutTab() {
  const s = state.site;
  $('#a-heading').value = s.aboutHeading || '';
  $('#a-paragraphs').value = (s.aboutParagraphs || []).join('\n\n');
  $('#a-photo-preview').src = s.aboutPhoto?.src || 'assets/logo-mark.png';
}

async function saveAbout() {
  const btn = $('#saveAboutBtn');
  setBusy(btn, true, 'Opslaan…');
  try {
    const files = [];
    state.site.aboutHeading = $('#a-heading').value.trim();
    state.site.aboutParagraphs = $('#a-paragraphs').value.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

    const photoFile = $('#a-photo-input').files[0];
    if (photoFile) {
      const prepared = await api.prepareUpload(photoFile, 'assets');
      // Keep a stable, predictable path for the about photo.
      files.push({ path: 'assets/about.jpg', content: prepared.content });
      state.site.aboutPhoto = { src: 'assets/about.jpg', alt: state.site.ownerName || 'Over Sojozino' };
    }

    files.push({ path: 'data/site.json', content: JSON.stringify(state.site, null, 2) });
    await api.commitBatch(files, 'Over-mij bijgewerkt');
    toast('Opgeslagen.', 'ok');
    renderAboutTab();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setBusy(btn, false);
  }
}

// ---------- Presence ----------
function renderPresenceTab() {
  const list = $('#presenceList');
  const sorted = [...state.presence].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  list.innerHTML = sorted.length ? sorted.map(p => `
    <div class="row-card" data-id="${esc(p.id)}">
      <div class="rc-info"><strong>${esc(p.title)}</strong><span>${esc(p.date)} — ${esc(p.location)}</span></div>
      <div class="rc-actions">
        <button class="btn-admin secondary small" data-action="edit">Bewerken</button>
        <button class="btn-admin danger small" data-action="delete">Verwijderen</button>
      </div>
    </div>`).join('') : '<div class="empty-state">Nog geen data toegevoegd.</div>';

  list.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.closest('.row-card').dataset.id;
    if (btn.dataset.action === 'edit') openPresenceForm(state.presence.find(p => p.id === id));
    else if (btn.dataset.action === 'delete') {
      if (!confirm('Deze datum verwijderen?')) return;
      state.presence = state.presence.filter(p => p.id !== id);
      await savePresence('Aanwezigheid verwijderd');
    }
  };

  $('#newPresenceBtn').onclick = () => openPresenceForm(null);
}

function openPresenceForm(entry) {
  const form = $('#presenceForm');
  form.classList.remove('hidden');
  form.dataset.editId = entry?.id || '';
  $('#pr-title').value = entry?.title || '';
  $('#pr-location').value = entry?.location || '';
  $('#pr-date').value = entry?.date || '';
  $('#pr-description').value = entry?.description || '';
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function savePresenceEntry() {
  const title = $('#pr-title').value.trim();
  const location = $('#pr-location').value.trim();
  const date = $('#pr-date').value;
  const description = $('#pr-description').value.trim();
  if (!title || !date) { toast('Vul minstens titel en datum in.', 'err'); return; }

  const editId = $('#presenceForm').dataset.editId;
  if (editId) {
    const entry = state.presence.find(p => p.id === editId);
    Object.assign(entry, { title, location, date, description });
  } else {
    state.presence.push({ id: `${date}-${slugify(title)}`, title, location, date, description });
  }
  await savePresence(`Aanwezigheid: ${title}`);
  $('#presenceForm').classList.add('hidden');
}

async function savePresence(message) {
  const btn = $('#savePresenceBtn');
  setBusy(btn, true, 'Opslaan…');
  try {
    await api.commitBatch([{ path: 'data/presence.json', content: JSON.stringify(state.presence, null, 2) }], message);
    toast('Opgeslagen.', 'ok');
    renderPresenceTab();
    renderOverview();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setBusy(btn, false);
  }
}

// ---------- Settings ----------
function renderSettingsTab() {
  const s = state.site;
  $('#s-businessName').value = s.businessName || '';
  $('#s-ownerName').value = s.ownerName || '';
  $('#s-tagline').value = s.tagline || '';
  $('#s-email').value = s.email || '';
  $('#s-instagram').value = s.instagramUrl || '';
  $('#s-location').value = s.location || '';
  $('#s-accent').value = s.accentColor || '#b5502e';
  $('#s-accentHex').value = s.accentColor || '#b5502e';
  $('#s-logo-preview').src = s.logo?.mark || 'assets/logo-mark.png';
}

async function saveSettings() {
  const btn = $('#saveSettingsBtn');
  setBusy(btn, true, 'Opslaan…');
  try {
    const files = [];
    Object.assign(state.site, {
      businessName: $('#s-businessName').value.trim(),
      ownerName: $('#s-ownerName').value.trim(),
      tagline: $('#s-tagline').value.trim(),
      email: $('#s-email').value.trim(),
      instagramUrl: $('#s-instagram').value.trim(),
      location: $('#s-location').value.trim(),
      accentColor: $('#s-accentHex').value.trim() || '#b5502e',
    });

    const logoFile = $('#s-logo-input').files[0];
    if (logoFile) {
      const prepared = await api.prepareUpload(logoFile, 'assets', { optimize: false });
      files.push({ path: 'assets/logo-mark.png', content: prepared.content });
      state.site.logo = { mark: 'assets/logo-mark.png' };
    }

    files.push({ path: 'data/site.json', content: JSON.stringify(state.site, null, 2) });
    await api.commitBatch(files, 'Instellingen bijgewerkt');
    toast('Opgeslagen.', 'ok');
    renderSettingsTab();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setBusy(btn, false);
  }
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  initConnect();
  initTabs();
  initImageUpload();

  $('#saveProductBtn').addEventListener('click', saveProduct);
  $('#cancelProductBtn').addEventListener('click', closeProductEditor);
  $('#savePresenceBtn').addEventListener('click', savePresenceEntry);
  $('#cancelPresenceBtn').addEventListener('click', () => $('#presenceForm').classList.add('hidden'));
  $('#saveAboutBtn').addEventListener('click', saveAbout);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);

  $('#s-accent').addEventListener('input', (e) => { $('#s-accentHex').value = e.target.value; });
  $('#s-accentHex').addEventListener('input', (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('#s-accent').value = e.target.value; });

  $('#a-photo-input').addEventListener('change', () => {
    const f = $('#a-photo-input').files[0];
    if (f) $('#a-photo-preview').src = URL.createObjectURL(f);
  });
  $('#s-logo-input').addEventListener('change', () => {
    const f = $('#s-logo-input').files[0];
    if (f) $('#s-logo-preview').src = URL.createObjectURL(f);
  });
});
