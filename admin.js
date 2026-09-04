// Sojozino admin dashboard. Talks straight to the GitHub Contents/Git Data
// API via admin-github.js's GitHubAPI class — every Save button below builds
// one commitBatch() call (JSON files + any new/removed images) so a single
// user action is a single atomic commit + a single site redeploy.
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
// Product being edited: an array of variants, each { name: string|null, images: [{src,alt}] }.
// A product with no real colour/style variants still has exactly one entry
// here (name: null) -- the variant picker only shows on the public site once
// there's more than one.
let editorVariants = [];
// Staged uploads not yet sent: [{ variantIdx, file }].
let editorPendingUploads = [];
// Which image is the product's cover (shown on the overview grid).
let editorCoverKey = { variantIdx: 0, imageIdx: 0 };
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

// Whether a save is live straight away depends on DEFER_PUBLISH, and telling
// her the wrong one of those is how a dashboard stops being believed. So the
// wording is derived from the flag rather than written out twice and forgotten.
function savedToast(what) {
  toast(DEFER_PUBLISH
    ? `${what} Klik rechtsonder op "Publiceer wijzigingen" om het online te zetten.`
    : `${what} Binnen een minuut staat het op de website.`, 'ok');
}

// Same for the standing explanations in the markup, which cannot ask the flag
// themselves.
function applyPublishWording() {
  const intro = $('#connectIntro');
  if (intro) {
    intro.textContent = DEFER_PUBLISH
      ? 'Plak je toegangscode om je website te bewerken. Wat je opslaat zet je daarna zelf online met de knop "Publiceer wijzigingen".'
      : 'Plak je toegangscode om je website te bewerken. Wat je opslaat staat meestal binnen een minuut op de website.';
  }
  // The one help topic that changes with the hosting, so it is written here
  // rather than in the markup -- a printed explanation of a publish step that
  // no longer exists would be worse than no explanation at all.
  const savingTitle = $('#helpSavingTitle');
  const savingBody = $('#helpSavingBody');
  if (savingTitle && savingBody) {
    savingTitle.textContent = DEFER_PUBLISH ? 'Opslaan en publiceren' : 'Opslaan';
    savingBody.innerHTML = DEFER_PUBLISH
      ? `<p><strong>Opslaan</strong> bewaart je werk, maar zet het nog niet op de website. Rechtsonder verschijnt dan een zwart kadertje met hoeveel wijzigingen er klaarstaan.</p>
         <p>Ben je klaar? Klik daar op <strong>Publiceer wijzigingen</strong>. Alles gaat dan in één keer online, meestal binnen een minuut.</p>
         <p class="hint">Zo kan je rustig een hele avond aanpassen zonder dat bezoekers je halve werk zien.</p>`
      : `<p><strong>Opslaan</strong> zet je wijziging meteen op de website. Meestal is ze binnen een minuut te zien.</p>
         <p class="hint">Ververs de pagina op de website als je ze nog niet ziet — je browser houdt soms even de oude versie vast.</p>`;
  }

  const hint = $('#overviewPublishHint');
  if (hint) {
    hint.textContent = DEFER_PUBLISH
      ? 'Wijzigingen worden bewaard zodra je op opslaan klikt, maar gaan pas live wanneer je rechtsonder op "Publiceer wijzigingen" klikt. Zo kun je rustig meerdere dingen aanpassen en ze in één keer online zetten.'
      : 'Alles wat je opslaat gaat meteen naar de website — meestal binnen een minuut zichtbaar. Vergist? Elke wijziging kun je terugzetten met "Ongedaan maken".';
  }
}

// ---------- Toasts ----------
function toast(message, type = 'info', action) {
  const container = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { el.remove(); action.onClick(); });
    el.appendChild(btn);
  }
  container.appendChild(el);
  // An offer to undo is no use if it disappears before it has been read.
  setTimeout(() => el.remove(), action ? 12000 : 4200);
}

// Replaces confirm(). `lines` are shown as a list under the question, so a
// destructive step has to state what it destroys. Resolves true only on the
// confirm button: Escape, the backdrop and Annuleren all mean no, and Annuleren
// takes focus so an absent-minded enter cancels rather than deletes.
function askConfirm({ title, lines = [], confirmLabel = 'Ja, doorgaan', cancelLabel = 'Annuleren', danger = false }) {
  const overlay = $('#confirmModal');
  $('#cmTitle').textContent = title;
  $('#cmCancel').textContent = cancelLabel;
  $('#cmBody').innerHTML = lines.length
    ? `<ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>`
    : '';
  const ok = $('#cmOk');
  ok.textContent = confirmLabel;
  ok.className = `btn-admin ${danger ? 'danger' : ''}`;
  overlay.hidden = false;
  $('#cmCancel').focus();

  return new Promise(resolve => {
    const done = (answer) => {
      overlay.hidden = true;
      ok.removeEventListener('click', onOk);
      $('#cmCancel').removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(answer);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (e) => { if (e.target === overlay) done(false); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    ok.addEventListener('click', onOk);
    $('#cmCancel').addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

// Puts a change back by restoring every path it touched to its previous state.
// Used both by the undo offered right after a delete and by the publish bar.
async function undoChange(sha, what) {
  try {
    await api.revertCommit(sha, `Ongedaan gemaakt: ${what}`);
    toast('Teruggezet.', 'ok');
    await loadAll();
    await refreshPublishBar();
  } catch (e) {
    toast(`Terugzetten mislukt: ${e.message}`, 'err');
  }
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

// Every write leaves an unpublished commit behind, so the publish counter has
// to refresh after each one. Wrapping the write methods once, here, beats
// remembering to call refreshPublishBar() in a dozen save handlers.
function watchWrites(gh) {
  for (const name of ['commitBatch', 'putFile', 'deleteFile']) {
    const original = gh[name].bind(gh);
    gh[name] = async (...args) => {
      const result = await original(...args);
      refreshPublishBar();
      return result;
    };
  }
  return gh;
}

// Shows the publish bar only when something is waiting to go live, and lists
// what that something is. Read from the branch history rather than from this
// browser, so it stays right even if the last edits were made on another device.
const PENDING_LIST_LIMIT = 6;

async function refreshPublishBar() {
  const bar = $('#publishBar');
  if (!api || !bar) return;
  const pending = await api.pendingChanges().catch(() => null);
  if (!pending || !pending.length) {
    bar.classList.add('hidden');
    return;
  }
  $('#publishCount').textContent = pending.length === 1
    ? '1 wijziging staat nog niet online'
    : `${pending.length} wijzigingen staan nog niet online`;

  const shown = pending.slice(0, PENDING_LIST_LIMIT);
  const rest = pending.length - shown.length;
  $('#publishList').innerHTML = shown.map(c => `
    <li>
      <span>
        <span class="pc-what">${esc(c.summary)}</span>${c.date ? `<span class="pc-when">${esc(relativeTime(c.date))}</span>` : ''}
      </span>
      <span class="pc-buttons">
        ${canGoTo(c.target) ? `<button class="pc-goto" type="button" data-target="${esc(c.target)}">Ga erheen</button>` : ''}
        <button class="pc-undo" type="button" data-sha="${esc(c.sha)}" data-what="${esc(c.summary)}">Ongedaan maken</button>
      </span>
    </li>`).join('')
    + (rest > 0 ? `<li class="pc-more">en nog ${rest} ${rest === 1 ? 'wijziging' : 'wijzigingen'}</li>` : '');

  bar.classList.remove('hidden');
}

function relativeTime(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'zonet';
  if (minutes < 60) return `${minutes} min geleden`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} uur geleden`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'dag' : 'dagen'} geleden`;
}

// A target only earns a button if it still leads somewhere: a product deleted
// after the change was made has no editor left to open.
function canGoTo(target) {
  if (!target) return false;
  const [tab, id] = target.split('/');
  if (!$(`.admin-tabs button[data-tab="${tab}"]`)) return false;
  if (tab === 'products' && id) return state.productsIndex.some(p => p.slug === id);
  return true;
}

function goToChange(target) {
  const [tab, id] = target.split('/');
  $(`.admin-tabs button[data-tab="${tab}"]`).click();
  if (tab === 'products' && id) openProductEditor(id);
  else window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function publishChanges() {
  // A queued reorder or star would otherwise land after the publish commit
  // and sit there unpublished, which is the one moment that is confusing.
  await flushProductIndex();
  const btn = $('#publishBtn');
  setBusy(btn, true, 'Publiceren…');
  try {
    await api.publish();
    toast('Je website wordt nu bijgewerkt — meestal binnen een minuut zichtbaar.', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setBusy(btn, false);
    await refreshPublishBar();
  }
}

// ---------- Connect flow ----------
// Where the site lives. Asking for these every time was three fields of
// ceremony for answers that are the same on every device and will not change
// unless the site moves -- so they are filled in, and only reachable under
// "Geavanceerd". The token is the one thing he actually has to provide.
const SITE_REPO = { owner: 'Draumbear', repo: 'sojozino-leder', branch: 'main' };

function initConnect() {
  const saved = GitHubStore.load() || {};
  $('#ghOwner').value = saved.owner || SITE_REPO.owner;
  $('#ghRepo').value = saved.repo || SITE_REPO.repo;
  $('#ghBranch').value = saved.branch || SITE_REPO.branch;
  $('#ghToken').value = saved.token || '';
  if (saved.token) connect(saved, { silent: true });

  $('#connectBtn').addEventListener('click', () => {
    const cfg = {
      owner: $('#ghOwner').value.trim() || SITE_REPO.owner,
      repo: $('#ghRepo').value.trim() || SITE_REPO.repo,
      branch: $('#ghBranch').value.trim() || SITE_REPO.branch,
      token: $('#ghToken').value.trim(),
    };
    if (!cfg.token) {
      $('#connectError').textContent = 'Plak je toegangscode hierboven om aan te melden.';
      $('#ghToken').focus();
      return;
    }
    connect(cfg, { silent: false });
  });

  // Enter in the token field is the obvious way to submit a one-field form.
  $('#ghToken').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#connectBtn').click();
  });

  // The status chip doubles as the menu that holds Ontkoppelen.
  const menu = $('#connMenu');
  const chip = $('#connStatus');
  const closeMenu = () => { menu.hidden = true; chip.setAttribute('aria-expanded', 'false'); };
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    // Nothing to offer until she is actually connected.
    if (chip.classList.contains('off')) return;
    menu.hidden = !menu.hidden;
    chip.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  $('#disconnectBtn').addEventListener('click', async () => {
    closeMenu();
    const go = await askConfirm({
      title: 'Ontkoppelen?',
      lines: [
        'Je toegangscode wordt uit deze browser gewist en je moet ze opnieuw plakken om verder te werken.',
        'De website zelf verandert hier niet door.',
      ],
      confirmLabel: 'Ja, ontkoppel',
      danger: true,
    });
    if (!go) return;
    GitHubStore.clear();
    api = null;
    $('#ghToken').value = '';
    $('#dashboard').classList.add('hidden');
    $('#connectPanel').classList.remove('hidden');
    setConnStatus(false);
  });
}

function setConnStatus(ok) {
  const el = $('#connStatus');
  el.textContent = ok ? 'Verbonden' : 'Niet verbonden';
  el.className = `conn-status ${ok ? 'ok' : 'off'}`;
  // The live URL can't be derived from the repo -- the site is hosted on
  // Netlify (or a custom domain), not GitHub Pages -- so it comes from
  // site.json's siteUrl, set on the Instellingen tab. Hidden until it's set.
  const live = $('#viewLiveLink');
  const url = ok ? (state.site?.siteUrl || '').trim() : '';
  if (url) {
    live.href = url;
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

    // The write check is advisory: it is far likelier to be right than wrong,
    // but being wrong would mean refusing a token that works, so she decides.
    if (candidate.writeCheck && !candidate.writeCheck.ok) {
      const go = await askConfirm({
        title: 'Dit token lijkt niet te mogen opslaan',
        lines: [
          'De test om iets weg te schrijven werd geweigerd, dus opslaan zou later waarschijnlijk mislukken.',
          esc(TOKEN_HELP),
          `<span class="pc-when">GitHub antwoordde ${candidate.writeCheck.status}: ${esc(candidate.writeCheck.detail)}</span>`,
        ],
        confirmLabel: 'Toch verbinden',
        cancelLabel: 'Token eerst aanpassen',
      });
      if (!go) throw new Error(`Dit token mag deze repository waarschijnlijk niet aanpassen. ${TOKEN_HELP}`);
    }

    api = watchWrites(candidate);
    GitHubStore.save(cfg);
    setConnStatus(true);
    $('#connectPanel').classList.add('hidden');
    $('#dashboard').classList.remove('hidden');
    await loadAll();
    await refreshPublishBar();
    await offerDraftRecovery();
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
  setConnStatus(true); // re-run now that site.json (and its siteUrl) is loaded
}

// ---------- Tabs ----------
// Instellingen has its own row of tabs inside the tab. Same idea as the main
// row, but scoped to one section, so it does not need the main tabs' state.
function initSettingsSubTabs() {
  const bar = $('#settingsSubTabs');
  if (!bar) return;
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-sub]');
    if (!btn) return;
    $all('#settingsSubTabs button').forEach(b => b.classList.toggle('active', b === btn));
    $all('.settings-panel').forEach(p => { p.hidden = p.dataset.sub !== btn.dataset.sub; });
  });
}

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

// The product page labels a single item with its category, so it needs the
// singular ('Handtas', not 'Handtassen'). Dutch plurals are too irregular to
// derive, so it's asked for once here; leaving it blank falls back to the
// plural name, which is right for collective names like 'Kleine lederwaren'.
function askSingular(pluralName, current) {
  const answer = prompt(
    `Enkelvoud van "${pluralName}" — zo staat het op de productpagina.
Laat leeg om "${pluralName}" te blijven gebruiken.`,
    current || ''
  );
  if (answer === null) return undefined; // cancelled: leave whatever was there
  return answer.trim() || null;
}

// ---------- Categories ----------
function renderCategoriesTab() {
  const list = $('#categoriesList');
  if (!state.categories.length) {
    list.innerHTML = '<div class="empty-state">Nog geen categorieën.</div>';
  } else {
    list.innerHTML = state.categories.map(c => {
      const count = state.productsIndex.filter(p => p.category === c.slug).length;
      const subs = c.subcategories || [];
      const subRows = subs.map(s => {
        const subCount = state.productsIndex.filter(p => p.category === c.slug && p.subcategory === s.slug).length;
        return `
        <div class="row-card sub-row-card" data-cat="${esc(c.slug)}" data-sub="${esc(s.slug)}">
          <div class="rc-info"><strong>${esc(s.name)}</strong><span>${subCount} product${subCount === 1 ? '' : 'en'} — enkelvoud: ${esc(s.singular || s.name)}</span></div>
          <div class="rc-actions">
            <button class="btn-admin secondary small" data-action="rename-sub">Naam wijzigen</button>
            <button class="btn-admin danger small" data-action="delete-sub">Verwijderen</button>
          </div>
        </div>`;
      }).join('');
      return `
      <div class="row-card" data-slug="${esc(c.slug)}">
        <div class="rc-info"><strong>${esc(c.name)}</strong><span>${count} product${count === 1 ? '' : 'en'} — enkelvoud: ${esc(c.singular || c.name)}</span></div>
        <div class="rc-actions">
          <button class="btn-admin secondary small" data-action="rename-cat">Naam wijzigen</button>
          <button class="btn-admin danger small" data-action="delete-cat">Verwijderen</button>
        </div>
      </div>
      <div class="sub-category-block" data-cat="${esc(c.slug)}">
        ${subRows}
        <button class="btn-admin secondary small" data-action="add-sub" data-cat="${esc(c.slug)}">+ Onderverdeling toevoegen</button>
      </div>`;
    }).join('');
  }

  list.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.action === 'add-sub') {
      const catSlug = btn.dataset.cat;
      const cat = state.categories.find(c => c.slug === catSlug);
      const name = prompt('Naam van de nieuwe onderverdeling:');
      if (!name || !name.trim()) return;
      cat.subcategories = cat.subcategories || [];
      const slug = uniqueSubcategorySlug(cat, slugify(name));
      const singular = askSingular(name.trim(), null);
      cat.subcategories.push({ slug, name: name.trim(), singular: singular || null });
      await saveCategories(`Onderverdeling toegevoegd: ${name.trim()}`);
      return;
    }

    const subRow = btn.closest('.sub-row-card');
    if (subRow) {
      const cat = state.categories.find(c => c.slug === subRow.dataset.cat);
      const sub = (cat.subcategories || []).find(s => s.slug === subRow.dataset.sub);
      if (btn.dataset.action === 'rename-sub') {
        const name = prompt('Nieuwe naam voor deze onderverdeling:', sub.name);
        if (!name || !name.trim()) return;
        sub.name = name.trim();
        const singular = askSingular(sub.name, sub.singular);
        if (singular !== undefined) sub.singular = singular;
        await saveCategories(`Onderverdeling hernoemd: ${sub.name}`);
      } else if (btn.dataset.action === 'delete-sub') {
        const count = state.productsIndex.filter(p => p.category === cat.slug && p.subcategory === sub.slug).length;
        if (count > 0) { toast(`Kan niet verwijderen: ${count} product(en) zitten nog in "${sub.name}".`, 'err'); return; }
        const go = await askConfirm({
          title: `Onderverdeling "${sub.name}" verwijderen?`,
          lines: [
            `Deze onderverdeling verdwijnt uit <strong>${esc(cat.name)}</strong>.`,
            'Er staan geen producten meer in, dus er gaan geen foto\u2019s verloren.'
          ],
          confirmLabel: 'Ja, verwijder deze onderverdeling',
          danger: true
        });
        if (!go) return;
        cat.subcategories = cat.subcategories.filter(s => s.slug !== sub.slug);
        await saveCategories(`Onderverdeling verwijderd: ${sub.name}`);
      }
      return;
    }

    const row = btn.closest('.row-card');
    if (!row) return;
    const slug = row.dataset.slug;
    const cat = state.categories.find(c => c.slug === slug);
    if (btn.dataset.action === 'rename-cat') {
      const name = prompt('Nieuwe naam voor deze categorie:', cat.name);
      if (!name || !name.trim()) return;
      cat.name = name.trim();
      const singular = askSingular(cat.name, cat.singular);
      if (singular !== undefined) cat.singular = singular;
      await saveCategories(`Categorie hernoemd: ${cat.name}`);
    } else if (btn.dataset.action === 'delete-cat') {
      const count = state.productsIndex.filter(p => p.category === slug).length;
      if (count > 0) { toast(`Kan niet verwijderen: ${count} product(en) zitten nog in "${cat.name}".`, 'err'); return; }
      const subCount = (cat.subcategories || []).length;
      const go = await askConfirm({
        title: `Categorie "${cat.name}" verwijderen?`,
        lines: [
          'De categorie verdwijnt uit het menu en uit de filters op de Creaties-pagina.',
          subCount ? `<span class="warn">${subCount} onderverdeling${subCount === 1 ? '' : 'en'}</span> ${subCount === 1 ? 'verdwijnt' : 'verdwijnen'} mee.` : 'Er hangen geen onderverdelingen aan.',
          'Er staan geen producten meer in, dus er gaan geen foto\u2019s verloren.'
        ],
        confirmLabel: 'Ja, verwijder deze categorie',
        danger: true
      });
      if (!go) return;
      state.categories = state.categories.filter(c => c.slug !== slug);
      await saveCategories(`Categorie verwijderd: ${cat.name}`);
    }
  };

  $('#addCategoryBtn').onclick = async () => {
    const name = prompt('Naam van de nieuwe categorie:');
    if (!name || !name.trim()) return;
    const slug = uniqueCategorySlug(slugify(name));
    const singular = askSingular(name.trim(), null);
    state.categories.push({ slug, name: name.trim(), singular: singular || null, order: state.categories.length + 1, subcategories: [] });
    await saveCategories(`Categorie toegevoegd: ${name.trim()}`);
  };
}

function uniqueCategorySlug(base) {
  let slug = base, n = 2;
  const taken = new Set(state.categories.map(c => c.slug));
  while (taken.has(slug)) { slug = `${base}-${n}`; n++; }
  return slug;
}

function uniqueSubcategorySlug(cat, base) {
  let slug = base, n = 2;
  const taken = new Set((cat.subcategories || []).map(s => s.slug));
  while (taken.has(slug)) { slug = `${base}-${n}`; n++; }
  return slug;
}

async function saveCategories(message) {
  try {
    await api.commitBatch([{ path: 'data/categories.json', content: () => JSON.stringify(state.categories, null, 2) }], message, 'categories');
    savedToast('Categorieën opgeslagen.');
    renderCategoriesTab();
    renderProductsTab();
    renderOverview();
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ---------- Products list ----------
// There is one shared editor panel, parked at the bottom of the tab in the
// markup. Opening it there means a long scroll away from the product that was
// clicked, so instead it gets moved in directly under that product's row. It
// has to be lifted back out before any list re-render, since rendering
// replaces the list's innerHTML and would otherwise destroy the panel.
function detachProductEditor() {
  $('#tab-products').appendChild($('#productEditor'));
}

function placeProductEditor() {
  const panel = $('#productEditor');
  if (panel.classList.contains('hidden')) return;
  const listEl = $('#productsList');
  if (!editingSlug) { listEl.prepend(panel); return; } // new product: top of the list
  const row = listEl.querySelector(`.row-card[data-slug="${CSS.escape(editingSlug)}"]`);
  if (row) row.after(panel);
  else detachProductEditor(); // filtered out of the current view
}

function renderProductsTab() {
  const catByslug = Object.fromEntries(state.categories.map(c => [c.slug, c.name]));
  const filterSel = $('#productCatFilter');
  filterSel.innerHTML = '<option value="all">Alle categorieën</option>' +
    state.categories.map(c => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('');

  // Alphabetical here would have been a different order from the one the site
  // shows, which makes dragging meaningless: the list has to be the thing being
  // reordered. Category first, then `order`, exactly as the gallery groups them.
  function inSiteOrder(list) {
    return [...list].sort((a, b) =>
      (catByslug[a.category] || '').localeCompare(catByslug[b.category] || '')
      || (a.order || 0) - (b.order || 0));
  }

  function render() {
    const q = $('#productSearch').value.trim().toLowerCase();
    const cat = filterSel.value;
    const filtering = !!q || cat !== 'all';
    const list = inSiteOrder(state.productsIndex
      .filter(p => (cat === 'all' || p.category === cat) && (!q || p.name.toLowerCase().includes(q))));
    const listEl = $('#productsList');
    detachProductEditor();
    const featuredCount = state.productsIndex.filter(p => p.featured).length;
    listEl.innerHTML = list.length ? list.map(p => `
      <div class="row-card" data-slug="${esc(p.slug)}" ${filtering ? '' : 'draggable="true"'}>
        ${filtering ? '' : '<span class="drag-handle" title="Sleep om de volgorde te wijzigen">⠿</span>'}
        <img src="${esc(p.cover?.src || '')}" alt="">
        <div class="rc-info"><strong>${esc(p.name)}</strong><span>${esc(catByslug[p.category] || '—')}</span></div>
        <div class="rc-actions">
          <button class="btn-feature${p.featured ? ' on' : ''}" data-action="feature"
                  aria-label="${p.featured ? 'Van de homepagina halen' : 'Op de homepagina tonen'}"
                  title="${p.featured ? 'Staat op de homepagina — klik om weg te halen' : 'Klik om dit op de homepagina te tonen'}">${p.featured ? '★' : '☆'}</button>
          <button class="btn-admin secondary small" data-action="edit">Bewerken</button>
          <button class="btn-admin danger small" data-action="delete">Verwijderen</button>
        </div>
      </div>`).join('') : '<div class="empty-state">Geen producten gevonden.</div>';
    $('#featuredHint').innerHTML = (featuredCount
      ? `Met de ster <span class="star-example">&#9733;</span> kies je wat op de homepagina komt — nu ${featuredCount} van de ${MAX_FEATURED}.`
      : `Met de ster <span class="star-example">&#9734;</span> kies je wat op de homepagina komt, maximaal ${MAX_FEATURED}. Zolang je niets kiest, toont de homepagina zelf een selectie.`)
      + (list.length
        ? (filtering
          ? ' <em>Wis het zoekvak en het categoriefilter om de volgorde te kunnen slepen.</em>'
          : ' Sleep een product om de volgorde op de website te wijzigen.')
        : '');
    placeProductEditor();
    if (!filtering) bindProductDragging(listEl, render);
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
    else if (btn.dataset.action === 'feature') toggleFeatured(slug, render);
  };

  $('#newProductBtn').onclick = () => openProductEditor(null);
}

// Dragging a product row changes the order the gallery shows it in. Only
// offered on the unfiltered list: dropping between two rows means nothing when
// the rows in between are hidden by a search.
function bindProductDragging(listEl, rerender) {
  let dragging = null;

  const clearMarkers = () => listEl.querySelectorAll('.row-card.drag-over')
    .forEach(r => r.classList.remove('drag-over'));

  listEl.querySelectorAll('.row-card[draggable="true"]').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      dragging = row.dataset.slug;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragging);
    });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); dragging = null; clearMarkers(); });
    row.addEventListener('dragover', (e) => {
      if (!dragging || row.dataset.slug === dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearMarkers();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', async (e) => {
      if (!dragging) return;
      e.preventDefault();
      const from = dragging, to = row.dataset.slug;
      dragging = null;
      clearMarkers();
      if (from === to) return;
      await moveProductBefore(from, to, rerender);
    });
  });
}

// Rewrites `order` across the whole index rather than nudging two numbers:
// products imported before ordering existed can share a value, and renumbering
// the lot from the visible sequence is the only way to be sure the site ends up
// showing exactly what she just arranged.
async function moveProductBefore(fromSlug, toSlug, rerender) {
  const rows = [...$('#productsList').querySelectorAll('.row-card')].map(r => r.dataset.slug);
  const from = rows.indexOf(fromSlug), to = rows.indexOf(toSlug);
  if (from < 0 || to < 0) return;
  rows.splice(to, 0, rows.splice(from, 1)[0]);

  const before = state.productsIndex.map(p => `${p.slug}:${p.order}`).join();
  rows.forEach((slug, i) => {
    const p = state.productsIndex.find(x => x.slug === slug);
    if (p) p.order = i + 1;
  });
  if (state.productsIndex.map(p => `${p.slug}:${p.order}`).join() === before) return;

  rerender();
  const moved = state.productsIndex.find(p => p.slug === fromSlug);
  saveProductIndexSoon(`Volgorde gewijzigd: ${moved ? moved.name : fromSlug}`, REORDER_SAVE_DELAY);
}

// Starring and reordering are one click each and come in bursts -- five drags
// is five commits, five Pages builds, and five chances to race. They all write
// the same one file, so they wait a moment for her to finish and then go as a
// single commit. Deliberate saves are untouched: pressing Opslaan means now,
// and it carries photos that should not sit in a browser waiting for a timer.
// Two speeds, because the two actions are paced differently. A star is one
// click and she is usually done; rearranging a category means dragging, looking
// at the result, and dragging again, with real thinking time in between.
const STAR_SAVE_DELAY = 1800;
const REORDER_SAVE_DELAY = 6000;
let indexSaveTimer = null;
let indexSaveLabels = [];
let indexSaveDelay = STAR_SAVE_DELAY;

// The longest wait asked for wins until the batch goes: a quick star in the
// middle of rearranging should not cut the dragging window short.
function saveProductIndexSoon(label, delay = STAR_SAVE_DELAY) {
  indexSaveLabels.push(label);
  indexSaveDelay = Math.max(indexSaveDelay, delay);
  clearTimeout(indexSaveTimer);
  indexSaveTimer = setTimeout(flushProductIndex, indexSaveDelay);
}

async function flushProductIndex() {
  clearTimeout(indexSaveTimer);
  indexSaveTimer = null;
  if (!indexSaveLabels.length) return;
  // One label reads better than a list; several mean she has been rearranging.
  const message = indexSaveLabels.length === 1
    ? indexSaveLabels[0]
    : `Producten bijgewerkt (${indexSaveLabels.length} wijzigingen)`;
  indexSaveLabels = [];
  indexSaveDelay = STAR_SAVE_DELAY;
  try {
    const sha = await api.commitBatch(
      [{ path: 'data/products-index.json', content: () => JSON.stringify(state.productsIndex, null, 2) }],
      message, 'products');
    toast('Opgeslagen.', 'ok', { label: 'Ongedaan maken', onClick: () => undoChange(sha, message) });
  } catch (e) {
    toast(e.message, 'err');
    await loadAll();
  }
}

// Starring is a one-field change to the index, so it commits on its own
// rather than going through the full product editor.
// The homepage has room for eight. Refusing the ninth here, with the reason,
// beats silently dropping it at render time -- he would star something, see no
// change on the site, and have nothing to go on.
const MAX_FEATURED = 8;

function toggleFeatured(slug, rerender) {
  const p = state.productsIndex.find(x => x.slug === slug);
  if (!p) return;
  if (!p.featured && state.productsIndex.filter(x => x.featured).length >= MAX_FEATURED) {
    toast(`Er passen er ${MAX_FEATURED} op de homepagina. Haal er eerst één weg met de ster.`, 'err');
    return;
  }
  p.featured = !p.featured;
  rerender();
  toast(p.featured ? `"${p.name}" staat nu op de homepage.` : `"${p.name}" is van de homepage gehaald.`, 'ok');
  saveProductIndexSoon(`${p.featured ? 'Uitgelicht' : 'Niet meer uitgelicht'}: ${p.name}`);
}

async function deleteProduct(slug) {
  const p = state.productsIndex.find(x => x.slug === slug);
  if (!p) return;
  try {
    // Read the product before asking, not after: the question should say how
    // many photos go with it, and "en al zijn foto's" doesn't tell her that.
    const detail = productCache[slug] || await api.getJSON(`data/products/${slug}.json`);
    const allImages = (detail?.variants || []).flatMap(v => v.images || []).length
      ? (detail.variants || []).flatMap(v => v.images || [])
      : (detail?.images || []); // backward-compat for pre-variant product files

    const lines = [`Het product <strong>${esc(p.name)}</strong> wordt van de website gehaald.`];
    if (allImages.length) {
      lines.push(`<span class="warn">${allImages.length} foto${allImages.length === 1 ? '' : "'s"}</span> ${allImages.length === 1 ? 'wordt' : 'worden'} mee verwijderd.`);
    }
    if (p.featured) lines.push('Het staat nu uitgelicht op de homepagina.');
    lines.push('Je kunt dit meteen daarna ongedaan maken.');

    const go = await askConfirm({
      title: `"${p.name}" verwijderen?`,
      lines,
      confirmLabel: 'Ja, verwijder dit product',
      danger: true
    });
    if (!go) return;

    const files = [
      { path: `data/products/${slug}.json`, delete: true },
      ...allImages.map(img => ({ path: img.src, delete: true })),
    ];
    state.productsIndex = state.productsIndex.filter(x => x.slug !== slug);
    files.push({ path: 'data/products-index.json', content: () => JSON.stringify(state.productsIndex, null, 2) });
    const sha = await api.commitBatch(files, `Product verwijderd: ${p.name}`, 'products');
    renderProductsTab();
    renderOverview();
    toast('Product verwijderd.', 'ok', { label: 'Ongedaan maken', onClick: () => undoChange(sha, `Product verwijderd: ${p.name}`) });
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ---------- Product editor ----------
async function openProductEditor(slug) {
  editingSlug = slug;
  editorPendingUploads = [];
  const panel = $('#productEditor');
  panel.classList.remove('hidden');
  placeProductEditor();
  // 'nearest' rather than 'start': the panel now sits right under the product
  // that was clicked, and scrolling it to the top would push that row off screen.
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const catOptions = state.categories.map(c => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('');
  $('#pe-category').innerHTML = catOptions || '<option value="">Voeg eerst een categorie toe</option>';

  if (slug) {
    $('#pe-title').textContent = 'Product bewerken';
    let detail = productCache[slug];
    if (!detail) { detail = await api.getJSON(`data/products/${slug}.json`); productCache[slug] = detail; }
    $('#pe-name').value = detail.name || '';
    $('#pe-category').value = detail.category || '';
    $('#pe-description').value = detail.description || '';
    renderSubcategorySelect(detail.subcategory || '');
    // Backward-compatible: a product saved before variants existed only has
    // a flat `images` array -- treat it as one unnamed variant.
    const source = (detail.variants && detail.variants.length)
      ? detail.variants
      : [{ name: null, images: detail.images || [] }];
    editorVariants = source.map(v => ({ name: v.name || null, images: (v.images || []).map(img => ({ ...img })) }));

    const idxEntry = state.productsIndex.find(p => p.slug === slug);
    editorCoverKey = findImageRef(idxEntry?.cover?.src) || { variantIdx: 0, imageIdx: 0 };
  } else {
    $('#pe-title').textContent = 'Nieuw product';
    $('#pe-name').value = '';
    $('#pe-category').value = state.categories[0]?.slug || '';
    $('#pe-description').value = '';
    renderSubcategorySelect('');
    editorVariants = [{ name: null, images: [] }];
    editorCoverKey = { variantIdx: 0, imageIdx: 0 };
  }
  renderVariantsManager();
  // Taken last, once every field is filled in, so it reflects what she sees.
  editorSnapshot = slug ? snapshotProductEditor() : null;
}

function findImageRef(src) {
  if (!src) return null;
  for (let vi = 0; vi < editorVariants.length; vi++) {
    const ii = editorVariants[vi].images.findIndex(img => img.src === src);
    if (ii >= 0) return { variantIdx: vi, imageIdx: ii };
  }
  return null;
}

function renderSubcategorySelect(selected) {
  const wrap = $('#pe-subcategory-wrap');
  const sel = $('#pe-subcategory');
  const cat = state.categories.find(c => c.slug === $('#pe-category').value);
  const subs = cat?.subcategories || [];
  if (!subs.length) { wrap.hidden = true; sel.innerHTML = ''; return; }
  wrap.hidden = false;
  sel.innerHTML = '<option value="">Geen onderverdeling</option>' +
    subs.map(s => `<option value="${esc(s.slug)}"${s.slug === selected ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
}

function closeProductEditor() {
  $('#productEditor').classList.add('hidden');
  clearDraft();
  detachProductEditor();
  editingSlug = null;
  editorPendingUploads = [];
  editorVariants = [];
}

function adjustCoverOnSwap(vi, from, to) {
  if (editorCoverKey.variantIdx !== vi) return;
  if (editorCoverKey.imageIdx === from) editorCoverKey.imageIdx = to;
  else if (editorCoverKey.imageIdx === to) editorCoverKey.imageIdx = from;
}

function firstAvailableCover() {
  for (let vi = 0; vi < editorVariants.length; vi++) {
    if (editorVariants[vi].images.length) return { variantIdx: vi, imageIdx: 0 };
  }
  return { variantIdx: 0, imageIdx: 0 };
}

function renderVariantsManager() {
  const wrap = $('#variantsManager');
  const multi = editorVariants.length > 1;

  wrap.innerHTML = editorVariants.map((v, vi) => {
    const existingTiles = v.images.map((img, ii) => {
      const isCover = editorCoverKey.variantIdx === vi && editorCoverKey.imageIdx === ii;
      return `
      <div class="image-tile${isCover ? ' is-cover' : ''}" data-vidx="${vi}" data-idx="${ii}" data-kind="existing" draggable="true" title="Klik om te vergroten — sleep om te herschikken">
        ${isCover ? '<span class="cover-badge">Cover</span>' : ''}
        <img src="${esc(img.src)}" alt="" draggable="false">
        <div class="tile-actions">
          <button data-action="cover" title="Als cover instellen">★</button>
          <button data-action="left" title="Naar links">←</button>
          <button data-action="right" title="Naar rechts">→</button>
          <button data-action="remove" title="Verwijderen">✕</button>
        </div>
      </div>`;
    }).join('');
    const pendingTiles = editorPendingUploads
      .map((p, gi) => ({ p, gi }))
      .filter(({ p }) => p.variantIdx === vi)
      .map(({ p, gi }) => `
      <div class="image-tile" data-vidx="${vi}" data-kind="pending" title="Klik om te vergroten">
        <img src="${URL.createObjectURL(p.file)}" alt="">
        <div class="tile-actions"><button data-action="remove-pending" data-pending-idx="${gi}">✕ nieuw</button></div>
      </div>`).join('');

    return `
    <div class="variant-editor">
      ${multi ? `
      <div class="variant-editor-head">
        <input type="text" class="variant-name-input" data-vidx="${vi}" placeholder="Naam (bv. Blauw)" value="${esc(v.name || '')}">
        <button class="btn-admin danger small" type="button" data-action="remove-variant" data-vidx="${vi}">Variant verwijderen</button>
      </div>` : ''}
      <div class="image-manager">${existingTiles}${pendingTiles}</div>
      <div class="upload-drop" data-vidx="${vi}">
        Klik of sleep foto's hierheen${multi ? ` om toe te voegen aan ${esc(v.name || `variant ${vi + 1}`)}` : ' om toe te voegen'}
        <input type="file" class="upload-input" data-vidx="${vi}" accept="image/*" multiple hidden>
      </div>
    </div>`;
  }).join('');

  bindVariantsManagerEvents(wrap);
  bindImageDragging(wrap);
}

// Moving a photo has to carry the cover marker with it: the cover is stored as
// an index into the variant, so any reshuffle changes what that index points at.
function moveImage(vi, from, to) {
  const images = editorVariants[vi].images;
  const [moved] = images.splice(from, 1);
  images.splice(to, 0, moved);
  if (editorCoverKey.variantIdx !== vi) return;
  const cover = editorCoverKey.imageIdx;
  if (cover === from) editorCoverKey.imageIdx = to;
  else if (from < cover && cover <= to) editorCoverKey.imageIdx = cover - 1;
  else if (to <= cover && cover < from) editorCoverKey.imageIdx = cover + 1;
}

// Drag-and-drop reordering within one variant. The arrow buttons stay: this
// covers neither touch nor keyboard, and dragging is easy to mis-aim.
function bindImageDragging(wrap) {
  let dragging = null;

  const clearMarkers = () => wrap.querySelectorAll('.image-tile.drag-over')
    .forEach(t => t.classList.remove('drag-over'));

  wrap.querySelectorAll('.image-tile[data-kind="existing"]').forEach(tile => {
    tile.addEventListener('dragstart', (e) => {
      dragging = { vi: Number(tile.dataset.vidx), ii: Number(tile.dataset.idx) };
      tile.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox won't start a drag unless the transfer carries something.
      e.dataTransfer.setData('text/plain', String(dragging.ii));
    });

    tile.addEventListener('dragend', () => {
      tile.classList.remove('dragging');
      dragging = null;
      clearMarkers();
    });

    tile.addEventListener('dragover', (e) => {
      // Photos belong to a specific variant, so a drag never crosses into another.
      if (!dragging || Number(tile.dataset.vidx) !== dragging.vi) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (Number(tile.dataset.idx) === dragging.ii) return;
      clearMarkers();
      tile.classList.add('drag-over');
    });

    tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));

    tile.addEventListener('drop', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const vi = Number(tile.dataset.vidx);
      const to = Number(tile.dataset.idx);
      const from = dragging.ii;
      dragging = null;
      if (vi !== Number(tile.dataset.vidx) || to === from) { clearMarkers(); return; }
      moveImage(vi, from, to);
      renderVariantsManager();
    });
  });
}

// ---------- Photo viewer ----------
// The tiles in the product editor are 110px, which is enough to tell photos
// apart but not to judge one. Clicking opens it full size, with the rest of
// that variant's photos reachable from there. Sources are read off the DOM
// rather than from editorVariants so that photos still queued for upload --
// which only exist as object URLs -- are included on equal footing.
let lightboxPhotos = [];
let lightboxIndex = 0;

function openPhotoLightbox(img) {
  const manager = img.closest('.image-manager');
  const images = [...manager.querySelectorAll('.image-tile img')];
  lightboxPhotos = images.map(el => el.src);
  showPhoto(images.indexOf(img));
  $('#adminLightbox').hidden = false;
}

function showPhoto(index) {
  if (!lightboxPhotos.length) return;
  // Wraps around, so holding one arrow key never dead-ends.
  lightboxIndex = (index + lightboxPhotos.length) % lightboxPhotos.length;
  $('#alImg').src = lightboxPhotos[lightboxIndex];
  $('#alCounter').textContent = `${lightboxIndex + 1} / ${lightboxPhotos.length}`;
  const single = lightboxPhotos.length < 2;
  $('#alPrev').hidden = single;
  $('#alNext').hidden = single;
  $('#alCounter').hidden = single;
}

function closePhotoLightbox() {
  $('#adminLightbox').hidden = true;
  $('#alImg').src = '';
  lightboxPhotos = [];
}

function initPhotoLightbox() {
  const box = $('#adminLightbox');
  // Clicking the backdrop closes; clicking the photo or a control does not.
  box.addEventListener('click', (e) => { if (e.target === box) closePhotoLightbox(); });
  $('#alClose').addEventListener('click', closePhotoLightbox);
  $('#alPrev').addEventListener('click', () => showPhoto(lightboxIndex - 1));
  $('#alNext').addEventListener('click', () => showPhoto(lightboxIndex + 1));
  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') closePhotoLightbox();
    else if (e.key === 'ArrowLeft') showPhoto(lightboxIndex - 1);
    else if (e.key === 'ArrowRight') showPhoto(lightboxIndex + 1);
  });
}

function bindVariantsManagerEvents(wrap) {
  // async because deleting a variant asks for confirmation first.
  wrap.onclick = async (e) => {
    const photo = e.target.closest('.image-tile img');
    if (photo) { openPhotoLightbox(photo); return; }

    const removeVariantBtn = e.target.closest('[data-action="remove-variant"]');
    if (removeVariantBtn) {
      const vi = Number(removeVariantBtn.dataset.vidx);
      if (editorVariants.length <= 1) return;
      const variant = editorVariants[vi];
      const photoCount = (variant.images || []).length;
      const go = await askConfirm({
        title: `Variant "${variant.name || `variant ${vi + 1}`}" verwijderen?`,
        lines: [
          photoCount
            ? `<span class="warn">${photoCount} foto${photoCount === 1 ? '' : "'s"}</span> in deze variant ${photoCount === 1 ? 'verdwijnt' : 'verdwijnen'} uit het product.`
            : 'Deze variant heeft nog geen foto\u2019s.',
          'Dit gebeurt pas echt wanneer je het product opslaat.'
        ],
        confirmLabel: 'Ja, verwijder deze variant',
        danger: true
      });
      if (!go) return;
      editorVariants.splice(vi, 1);
      editorPendingUploads = editorPendingUploads
        .filter(p => p.variantIdx !== vi)
        .map(p => ({ ...p, variantIdx: p.variantIdx > vi ? p.variantIdx - 1 : p.variantIdx }));
      if (editorCoverKey.variantIdx === vi) editorCoverKey = firstAvailableCover();
      else if (editorCoverKey.variantIdx > vi) editorCoverKey.variantIdx--;
      renderVariantsManager();
      return;
    }

    const pendingRemoveBtn = e.target.closest('[data-action="remove-pending"]');
    if (pendingRemoveBtn) {
      editorPendingUploads.splice(Number(pendingRemoveBtn.dataset.pendingIdx), 1);
      renderVariantsManager();
      return;
    }

    const tile = e.target.closest('.image-tile[data-kind="existing"]');
    const btn = e.target.closest('button');
    if (tile && btn) {
      const vi = Number(tile.dataset.vidx), ii = Number(tile.dataset.idx);
      const images = editorVariants[vi].images;
      if (btn.dataset.action === 'cover') {
        editorCoverKey = { variantIdx: vi, imageIdx: ii };
      } else if (btn.dataset.action === 'left' && ii > 0) {
        [images[ii - 1], images[ii]] = [images[ii], images[ii - 1]];
        adjustCoverOnSwap(vi, ii, ii - 1);
      } else if (btn.dataset.action === 'right' && ii < images.length - 1) {
        [images[ii + 1], images[ii]] = [images[ii], images[ii + 1]];
        adjustCoverOnSwap(vi, ii, ii + 1);
      } else if (btn.dataset.action === 'remove') {
        images.splice(ii, 1);
        if (editorCoverKey.variantIdx === vi) {
          if (editorCoverKey.imageIdx === ii) editorCoverKey = firstAvailableCover();
          else if (editorCoverKey.imageIdx > ii) editorCoverKey.imageIdx--;
        }
      }
      renderVariantsManager();
      return;
    }

    const drop = e.target.closest('.upload-drop');
    if (drop && !e.target.closest('input')) {
      wrap.querySelector(`.upload-input[data-vidx="${drop.dataset.vidx}"]`).click();
    }
  };

  wrap.oninput = (e) => {
    const nameInput = e.target.closest('.variant-name-input');
    if (nameInput) editorVariants[Number(nameInput.dataset.vidx)].name = nameInput.value.trim() || null;
  };

  wrap.onchange = (e) => {
    const input = e.target.closest('.upload-input');
    if (!input) return;
    const vi = Number(input.dataset.vidx);
    Array.from(input.files).filter(f => f.type.startsWith('image/')).forEach(f => editorPendingUploads.push({ variantIdx: vi, file: f }));
    input.value = '';
    renderVariantsManager();
  };

  wrap.querySelectorAll('.upload-drop').forEach(drop => {
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = 'var(--a-rust)'; });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.style.borderColor = '';
      const vi = Number(drop.dataset.vidx);
      Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')).forEach(f => editorPendingUploads.push({ variantIdx: vi, file: f }));
      renderVariantsManager();
    });
  });
}

// ---------- Unsaved work ----------
// The product editor is where half an hour can disappear to one closed tab, so
// what is typed there is mirrored into localStorage as it is typed. Queued
// photos cannot come along: they are File handles from a picker the browser
// will not hand back on the next page load. So the draft says so plainly rather
// than restoring a product that quietly lost its pictures.
const DRAFT_KEY = 'sojozino-admin-draft';

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || null; }
  catch { return null; }
}

function writeDraft() {
  // Nothing open, or nothing typed yet: no draft worth keeping.
  if ($('#productEditor').classList.contains('hidden')) return;
  const current = snapshotProductEditor();
  if (!current.name && !current.description) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      slug: editingSlug,
      savedAt: Date.now(),
      queuedPhotos: editorPendingUploads.length,
      form: current,
    }));
  } catch { /* private mode, or full: losing the draft is not worth an error */ }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

// True while the open editor differs from what was loaded -- the test the
// beforeunload guard and the draft prompt both hang off.
function editorHasUnsavedWork() {
  if ($('#productEditor').classList.contains('hidden')) return false;
  return describeProductChanges().length > 0;
}

// Offered on load when a draft outlived its session. Restoring only refills the
// text: the photos have to be picked again, which the prompt says up front so
// she is not hunting for them afterwards.
async function offerDraftRecovery() {
  const draft = readDraft();
  if (!draft) return;

  const product = draft.slug ? state.productsIndex.find(p => p.slug === draft.slug) : null;
  if (draft.slug && !product) { clearDraft(); return; } // deleted since

  const what = draft.slug ? `"${product.name}"` : `een nieuw product ("${draft.form.name || 'zonder naam'}")`;
  const lines = [
    `Je was ${esc(what)} aan het bewerken (${esc(relativeTime(draft.savedAt))}), maar hebt het niet opgeslagen.`,
  ];
  if (draft.queuedPhotos) {
    lines.push(`<span class="warn">De ${draft.queuedPhotos} foto's die klaarstonden zijn niet bewaard</span> — die moet je opnieuw kiezen.`);
  }
  lines.push('Kies "Weggooien" om deze tekst definitief te wissen en met een schone lei te beginnen.');

  const restore = await askConfirm({
    title: 'Niet-opgeslagen wijzigingen gevonden',
    lines,
    confirmLabel: 'Verder werken',
    cancelLabel: 'Weggooien',
  });

  if (restore) {
    // The editor lives inside the Producten tab, so restoring while Overzicht
    // is showing would refill a form she cannot see. Switch there first, then
    // openProductEditor puts the panel beside the product and scrolls to it.
    $('.admin-tabs button[data-tab="products"]').click();
    await openProductEditor(draft.slug);
    $('#pe-name').value = draft.form.name || '';
    if (draft.form.category) $('#pe-category').value = draft.form.category;
    renderSubcategorySelect(draft.form.subcategory || '');
    $('#pe-description').value = draft.form.description || '';
    $('#productEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('#pe-name').focus();
    toast('Je tekst is teruggezet. Voeg de foto\u2019s opnieuw toe als je die had klaarstaan.', 'ok');
    return;
  }

  // Discarding is itself destructive, so it gets its own confirmation.
  const sure = await askConfirm({
    title: 'Deze niet-opgeslagen wijzigingen weggooien?',
    lines: ['De tekst die je had ingevuld is daarna definitief weg.', 'Wat al op de website staat verandert hier niet door.'],
    confirmLabel: 'Ja, gooi weg',
    danger: true,
  });
  if (sure) { clearDraft(); toast('Weggegooid.', 'info'); }
}

// ---------- Review before saving ----------
// Saving commits straight to the live site, so the last step is a plain-language
// list of what is about to change. Built by comparing against a snapshot taken
// when the form was opened, rather than tracking edits as they happen -- fewer
// places to forget to record something.
let editorSnapshot = null;
let settingsSnapshot = null;

function snapshotProductEditor() {
  return {
    name: $('#pe-name').value.trim(),
    category: $('#pe-category').value,
    subcategory: $('#pe-subcategory-wrap').hidden ? null : ($('#pe-subcategory').value || null),
    description: $('#pe-description').value.trim(),
    variants: editorVariants.map(v => ({ name: v.name, images: v.images.map(i => i.src) })),
    coverSrc: (editorVariants[editorCoverKey.variantIdx]?.images[editorCoverKey.imageIdx] || {}).src || null,
  };
}

function categoryNameFor(slug) {
  const c = state.categories.find(x => x.slug === slug);
  return c ? c.name : slug || '—';
}

function changedField(label, before, after) {
  if ((before || '') === (after || '')) return null;
  if (!before) return `${label}: <strong>${esc(after)}</strong> toegevoegd`;
  if (!after) return `${label}: <strong>${esc(before)}</strong> gewist`;
  return `${label}: ${esc(before)} &rarr; <strong>${esc(after)}</strong>`;
}

// Returns the list of human-readable changes; empty means nothing to save.
function describeProductChanges() {
  const before = editorSnapshot;
  const after = snapshotProductEditor();
  const lines = [];
  if (!before) {
    // New product: there is no "before", so describe what is being created.
    const photos = editorPendingUploads.length;
    lines.push(`Nieuw product <strong>${esc(after.name)}</strong> in ${esc(categoryNameFor(after.category))}`);
    if (photos) lines.push(`${photos} foto${photos === 1 ? '' : "'s"} worden geüpload`);
    return lines;
  }

  const field = (label, a, b) => { const l = changedField(label, a, b); if (l) lines.push(l); };
  field('Naam', before.name, after.name);
  field('Categorie', categoryNameFor(before.category), categoryNameFor(after.category));
  field('Onderverdeling', before.subcategory, after.subcategory);
  if (before.description !== after.description) lines.push('Beschrijving aangepast');

  const srcs = (snap) => snap.variants.flatMap(v => v.images);
  const beforeSrcs = srcs(before), afterSrcs = srcs(after);
  const removed = beforeSrcs.filter(s => !afterSrcs.includes(s)).length;
  if (removed) lines.push(`<span class="warn">${removed} foto${removed === 1 ? '' : "'s"}</span> ${removed === 1 ? 'wordt' : 'worden'} verwijderd`);
  if (editorPendingUploads.length) lines.push(`${editorPendingUploads.length} foto${editorPendingUploads.length === 1 ? '' : "'s"} ${editorPendingUploads.length === 1 ? 'wordt' : 'worden'} toegevoegd`);
  if (!removed && beforeSrcs.length === afterSrcs.length && beforeSrcs.join() !== afterSrcs.join()) {
    lines.push("Volgorde van de foto's gewijzigd");
  }

  const beforeNames = before.variants.map(v => v.name || '').join('|');
  const afterNames = after.variants.map(v => v.name || '').join('|');
  if (before.variants.length !== after.variants.length) {
    const diff = after.variants.length - before.variants.length;
    lines.push(diff > 0 ? `${diff} variant${diff === 1 ? '' : 'en'} toegevoegd` : `<span class="warn">${-diff} variant${diff === -1 ? '' : 'en'}</span> verwijderd`);
  } else if (beforeNames !== afterNames) {
    lines.push('Variantnamen aangepast');
  }

  if (before.coverSrc !== after.coverSrc) lines.push('Andere cover gekozen');
  return lines;
}

function snapshotSettings() {
  const s = state.site;
  return {
    'Bedrijfsnaam': s.businessName, 'Naam': s.ownerName,
    'Kleine regel boven de titel': s.heroEyebrow, 'Grote titel': s.heroTitle,
    'Zin onder de titel': s.heroTagline,
    'Tekst eerste knop': s.heroPrimaryLabel, 'Tekst tweede knop': s.heroSecondaryLabel,
    'Titel contactpagina': s.contactHeading, 'Zin op de contactpagina': s.contactIntro,
    'Kleine regel bestelpagina': s.orderEyebrow, 'Titel bestelpagina': s.orderHeading,
    'Uitleg bestelpagina': s.orderIntro,
    'Kleine regel marktpagina': s.marketsEyebrow, 'Titel marktpagina': s.marketsHeading,
    'Uitleg marktpagina': s.marketsIntro,
    ...Object.fromEntries(NAV_PAGES.map(([href, fallback]) =>
      [`Menu: ${fallback}`, (s.navLabels || {})[href] || ''])),
    'Tagline': s.tagline, 'E-mail': s.email, 'Instagram': s.instagramUrl,
    'Locatie': s.location, 'Website-adres': s.siteUrl, 'Accentkleur': s.accentColor,
  };
}

function describeSettingsChanges(after) {
  const before = settingsSnapshot || {};
  const lines = [];
  for (const label of Object.keys(after)) {
    const line = changedField(label, before[label], after[label]);
    if (line) lines.push(line);
  }
  if ($('#s-logo-input').files[0]) lines.push('Nieuw logo (dragon) geüpload');
  if ($('#s-logofull-input').files[0]) lines.push('Nieuw logo (volledig) geüpload');
  return lines;
}

// Shows the list and waits for a yes. Returns false when there is nothing to
// save -- pressing Opslaan with no edits should say so, not make an empty commit.
async function confirmSave(title, lines) {
  if (!lines.length) {
    toast('Er is niets gewijzigd.', 'info');
    return false;
  }
  return askConfirm({ title, lines, confirmLabel: 'Ja, opslaan' });
}

async function saveProduct() {
  const name = $('#pe-name').value.trim();
  const category = $('#pe-category').value;
  const subcategory = $('#pe-subcategory-wrap').hidden ? null : ($('#pe-subcategory').value || null);
  const description = $('#pe-description').value.trim();
  if (!name) { toast('Geef het product een naam.', 'err'); return; }
  if (!category) { toast('Kies een categorie.', 'err'); return; }
  const totalExisting = editorVariants.reduce((n, v) => n + v.images.length, 0);
  if (totalExisting === 0 && editorPendingUploads.length === 0) { toast('Voeg minstens één foto toe.', 'err'); return; }

  if (!await confirmSave(editingSlug ? 'Deze wijzigingen opslaan?' : 'Dit product toevoegen?', describeProductChanges())) return;

  const btn = $('#saveProductBtn');
  setBusy(btn, true, 'Opslaan…');
  try {
    const slug = editingSlug || uniqueSlug(slugify(name), null);
    const files = [];
    const multi = editorVariants.length > 1;

    // Unnamed variants get a fallback label once there's more than one --
    // only matters for the folder an upload lands in and the swatch label.
    if (multi) editorVariants.forEach((v, i) => { if (!v.name) v.name = `Variant ${i + 1}`; });

    // Upload any newly-added photos into their variant's own folder. Each one
    // is decoded, resized and re-encoded to WebP before it goes anywhere, so a
    // dozen photos is easily half a minute -- long enough that a motionless
    // spinner reads as a hung page and invites a second click or a closed tab.
    const totalUploads = editorPendingUploads.length;
    for (const [i, pending] of editorPendingUploads.entries()) {
      setBusy(btn, true, `Foto ${i + 1} van ${totalUploads}…`);
      const v = editorVariants[pending.variantIdx];
      const folder = multi ? `assets/products/${slug}/${slugify(v.name)}` : `assets/products/${slug}`;
      const prepared = await api.prepareUpload(pending.file, folder);
      files.push({ path: prepared.path, content: prepared.content });
      v.images.push({ src: prepared.path, alt: multi ? `${name} — ${v.name}` : name });
    }
    editorPendingUploads = [];
    if (totalUploads) setBusy(btn, true, 'Opslaan…');

    const coverVariant = editorVariants[editorCoverKey.variantIdx] || editorVariants[0];
    const coverImage = coverVariant.images[editorCoverKey.imageIdx]
      || coverVariant.images[0]
      || editorVariants.flatMap(v => v.images)[0];

    // Drop any variant that ended up with no photos (e.g. its only image got removed).
    const cleanedVariants = editorVariants.filter(v => v.images.length > 0);

    const productData = { slug, name, category, subcategory, description, variants: cleanedVariants };
    files.push({ path: `data/products/${slug}.json`, content: JSON.stringify(productData, null, 2) });

    const existingIdx = state.productsIndex.findIndex(p => p.slug === slug);
    const indexEntry = {
      slug, name, category, subcategory, cover: { src: coverImage.src, alt: coverImage.alt || name },
      order: existingIdx >= 0 ? state.productsIndex[existingIdx].order : state.productsIndex.length + 1,
      featured: existingIdx >= 0 ? !!state.productsIndex[existingIdx].featured : false,
    };
    if (existingIdx >= 0) state.productsIndex[existingIdx] = indexEntry;
    else state.productsIndex.push(indexEntry);
    files.push({ path: 'data/products-index.json', content: () => JSON.stringify(state.productsIndex, null, 2) });

    await api.commitBatch(files, `${editingSlug ? 'Product bijgewerkt' : 'Product toegevoegd'}: ${name}`, `products/${slug}`);
    productCache[slug] = productData;
    clearDraft();
    savedToast('Product opgeslagen.');
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
  const lines = [];
  const headingLine = changedField('Titel', state.site.aboutHeading, $('#a-heading').value.trim());
  if (headingLine) lines.push(headingLine);
  const paragraphs = $('#a-paragraphs').value.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.join('|') !== (state.site.aboutParagraphs || []).join('|')) {
    const was = (state.site.aboutParagraphs || []).length;
    lines.push(`Tekst aangepast (${was} &rarr; ${paragraphs.length} alinea's)`);
  }
  if ($('#a-photo-input').files[0]) lines.push('Nieuwe foto geüpload');
  if (!await confirmSave('Deze wijzigingen opslaan?', lines)) return;

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
    await api.commitBatch(files, 'Over-mij bijgewerkt', 'about');
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
      const entry = state.presence.find(p => p.id === id);
      const when = entry ? new Date(entry.date + 'T00:00:00').toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' }) : 'deze datum';
      const go = await askConfirm({
        title: 'Deze datum verwijderen?',
        lines: [`<strong>${esc(entry?.title || entry?.location || 'Markt')}</strong> op ${esc(when)} verdwijnt van "Waar vind je mij".`],
        confirmLabel: 'Ja, verwijder deze datum',
        danger: true
      });
      if (!go) return;
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
  $('#pr-address').value = entry?.address || '';
  $('#pr-website').value = entry?.website || '';
  $('#pr-date').value = entry?.date || '';
  $('#pr-description').value = entry?.description || '';
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function savePresenceEntry() {
  const title = $('#pr-title').value.trim();
  const location = $('#pr-location').value.trim();
  const address = $('#pr-address').value.trim();
  const website = $('#pr-website').value.trim();
  const date = $('#pr-date').value;
  const description = $('#pr-description').value.trim();
  if (!title || !date) { toast('Vul minstens titel en datum in.', 'err'); return; }

  const editId = $('#presenceForm').dataset.editId;
  if (editId) {
    const entry = state.presence.find(p => p.id === editId);
    Object.assign(entry, { title, location, address, website, date, description });
  } else {
    state.presence.push({ id: `${date}-${slugify(title)}`, title, location, address, website, date, description });
  }
  await savePresence(`Aanwezigheid: ${title}`);
  $('#presenceForm').classList.add('hidden');
}

async function savePresence(message) {
  const btn = $('#savePresenceBtn');
  setBusy(btn, true, 'Opslaan…');
  try {
    await api.commitBatch([{ path: 'data/presence.json', content: () => JSON.stringify(state.presence, null, 2) }], message, 'presence');
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
// The menu names, keyed by the page they belong to. Kept as one object in
// site.json rather than six loose fields, so adding a page later means adding
// a row here and nothing else.
const NAV_PAGES = [
  ['index.html', 'Home'],
  ['over-mij.html', 'Over mij'],
  ['creaties.html', 'Creaties'],
  ['bestellen.html', 'Bestellen'],
  ['waar-vind-je-mij.html', 'Waar vind je mij'],
  ['contact.html', 'Contact'],
];

function navFieldId(href) {
  return `#s-nav-${href.replace(/\.html$/, '')}`;
}

function readNavLabels() {
  const labels = {};
  NAV_PAGES.forEach(([href]) => {
    const value = ($(navFieldId(href)).value || '').trim();
    // Blank means "use the default", so it is not stored at all.
    if (value) labels[href] = value;
  });
  return labels;
}

function renderSettingsTab() {
  const s = state.site;
  $('#s-businessName').value = s.businessName || '';
  $('#s-ownerName').value = s.ownerName || '';
  $('#s-heroEyebrow').value = s.heroEyebrow || '';
  $('#s-heroTitle').value = s.heroTitle || '';
  $('#s-heroTagline').value = s.heroTagline || '';
  $('#s-heroPrimaryLabel').value = s.heroPrimaryLabel || '';
  $('#s-heroSecondaryLabel').value = s.heroSecondaryLabel || '';
  $('#s-contactHeading').value = s.contactHeading || '';
  $('#s-contactIntro').value = s.contactIntro || '';
  $('#s-orderEyebrow').value = s.orderEyebrow || '';
  $('#s-orderHeading').value = s.orderHeading || '';
  $('#s-orderIntro').value = s.orderIntro || '';
  $('#s-marketsEyebrow').value = s.marketsEyebrow || '';
  $('#s-marketsHeading').value = s.marketsHeading || '';
  $('#s-marketsIntro').value = s.marketsIntro || '';
  NAV_PAGES.forEach(([href]) => { $(navFieldId(href)).value = (s.navLabels || {})[href] || ''; });
  $('#s-tagline').value = s.tagline || '';
  $('#s-email').value = s.email || '';
  $('#s-instagram').value = s.instagramUrl || '';
  $('#s-location').value = s.location || '';
  $('#s-siteUrl').value = s.siteUrl || '';
  $('#s-accent').value = s.accentColor || '#c31f1f';
  $('#s-accentHex').value = s.accentColor || '#c31f1f';
  $('#s-logo-preview').src = s.logo?.mark || 'assets/logo-mark.png';
  $('#s-logofull-preview').src = s.logo?.full || 'assets/logo-full.png';
  settingsSnapshot = snapshotSettings();
}

async function saveSettings() {
  // Read the form into the same shape as the snapshot so the two compare
  // field by field, then let her see the list before any of it is committed.
  const proposed = {
    'Bedrijfsnaam': $('#s-businessName').value.trim(), 'Naam': $('#s-ownerName').value.trim(),
    'Kleine regel boven de titel': $('#s-heroEyebrow').value.trim(), 'Grote titel': $('#s-heroTitle').value.trim(),
    'Zin onder de titel': $('#s-heroTagline').value.trim(),
    'Tekst eerste knop': $('#s-heroPrimaryLabel').value.trim(), 'Tekst tweede knop': $('#s-heroSecondaryLabel').value.trim(),
    'Titel contactpagina': $('#s-contactHeading').value.trim(), 'Zin op de contactpagina': $('#s-contactIntro').value.trim(),
    'Kleine regel bestelpagina': $('#s-orderEyebrow').value.trim(), 'Titel bestelpagina': $('#s-orderHeading').value.trim(),
    'Uitleg bestelpagina': $('#s-orderIntro').value.trim(),
    'Kleine regel marktpagina': $('#s-marketsEyebrow').value.trim(), 'Titel marktpagina': $('#s-marketsHeading').value.trim(),
    'Uitleg marktpagina': $('#s-marketsIntro').value.trim(),
    ...Object.fromEntries(NAV_PAGES.map(([href, fallback]) =>
      [`Menu: ${fallback}`, ($(navFieldId(href)).value || '').trim()])),
    'Tagline': $('#s-tagline').value.trim(), 'E-mail': $('#s-email').value.trim(),
    'Instagram': $('#s-instagram').value.trim(), 'Locatie': $('#s-location').value.trim(),
    'Website-adres': $('#s-siteUrl').value.trim(), 'Accentkleur': $('#s-accentHex').value.trim() || '#c31f1f',
  };
  if (!await confirmSave('Deze instellingen opslaan?', describeSettingsChanges(proposed))) return;

  const btn = $('#saveSettingsBtn');
  setBusy(btn, true, 'Opslaan…');
  try {
    const files = [];
    Object.assign(state.site, {
      businessName: $('#s-businessName').value.trim(),
      ownerName: $('#s-ownerName').value.trim(),
      heroEyebrow: $('#s-heroEyebrow').value.trim(),
      heroTitle: $('#s-heroTitle').value.trim(),
      heroTagline: $('#s-heroTagline').value.trim(),
      heroPrimaryLabel: $('#s-heroPrimaryLabel').value.trim(),
      heroSecondaryLabel: $('#s-heroSecondaryLabel').value.trim(),
      contactHeading: $('#s-contactHeading').value.trim(),
      contactIntro: $('#s-contactIntro').value.trim(),
      orderEyebrow: $('#s-orderEyebrow').value.trim(),
      orderHeading: $('#s-orderHeading').value.trim(),
      orderIntro: $('#s-orderIntro').value.trim(),
      marketsEyebrow: $('#s-marketsEyebrow').value.trim(),
      marketsHeading: $('#s-marketsHeading').value.trim(),
      marketsIntro: $('#s-marketsIntro').value.trim(),
      tagline: $('#s-tagline').value.trim(),
      email: $('#s-email').value.trim(),
      instagramUrl: $('#s-instagram').value.trim(),
      location: $('#s-location').value.trim(),
      siteUrl: $('#s-siteUrl').value.trim(),
      accentColor: $('#s-accentHex').value.trim() || '#c31f1f',
    });

    state.site.navLabels = readNavLabels();
    state.site.logo = state.site.logo || {};
    const logoFile = $('#s-logo-input').files[0];
    if (logoFile) {
      const prepared = await api.prepareUpload(logoFile, 'assets', { optimize: false });
      files.push({ path: 'assets/logo-mark.png', content: prepared.content });
      state.site.logo.mark = 'assets/logo-mark.png';
    }
    const logoFullFile = $('#s-logofull-input').files[0];
    if (logoFullFile) {
      const prepared = await api.prepareUpload(logoFullFile, 'assets', { optimize: false });
      files.push({ path: 'assets/logo-full.png', content: prepared.content });
      state.site.logo.full = 'assets/logo-full.png';
    }

    files.push({ path: 'data/site.json', content: JSON.stringify(state.site, null, 2) });
    await api.commitBatch(files, 'Instellingen bijgewerkt', 'settings');
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
  applyPublishWording();
  initConnect();
  initTabs();
  initSettingsSubTabs();

  const printBtn = $('#printHelpBtn');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      // Print the whole thing, not just whatever happens to be open.
      $all('#tab-help details').forEach(d => { d.open = true; });
      window.print();
    });
  }
  // The draft keeps the text, but the queued photos die with the page, so
  // it is still worth asking before the page goes.
  window.addEventListener('beforeunload', (e) => {
    // Fire-and-forget: the browser will not wait, but the request usually
    // gets away, and the alternative is dropping the change entirely.
    if (indexSaveTimer) flushProductIndex();
    if (!editorHasUnsavedWork()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  initPhotoLightbox();

  $('#saveProductBtn').addEventListener('click', saveProduct);
  // Mirrors the form on every keystroke; localStorage writes are cheap and
  // a debounce here would only widen the window this exists to close.
  ['#pe-name', '#pe-category', '#pe-subcategory', '#pe-description']
    .forEach(sel => { const el = $(sel); if (el) { el.addEventListener('input', writeDraft); el.addEventListener('change', writeDraft); } });
  $('#cancelProductBtn').addEventListener('click', closeProductEditor);
  $('#pe-category').addEventListener('change', () => renderSubcategorySelect(''));
  $('#addVariantBtn').addEventListener('click', () => {
    editorVariants.push({ name: `Variant ${editorVariants.length + 1}`, images: [] });
    renderVariantsManager();
  });
  $('#savePresenceBtn').addEventListener('click', savePresenceEntry);
  $('#cancelPresenceBtn').addEventListener('click', () => $('#presenceForm').classList.add('hidden'));
  $('#saveAboutBtn').addEventListener('click', saveAbout);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#publishBtn').addEventListener('click', publishChanges);
  // The dock and the toasts both live in the bottom-right corner, and the dock
  // changes height as it is expanded, collapsed, filled or hidden. Measuring it
  // is the only way the toasts can reliably clear it; a fixed offset would be
  // wrong in three of those four states.
  const dock = $('#publishBar');
  const trackDockHeight = () => {
    const visible = !dock.classList.contains('hidden');
    const height = visible ? dock.offsetHeight + 12 : 0;
    document.documentElement.style.setProperty('--dock-height', `${height}px`);
  };
  new ResizeObserver(trackDockHeight).observe(dock);
  new MutationObserver(trackDockHeight).observe(dock, { attributes: true, attributeFilter: ['class'] });
  trackDockHeight();

  $('#publishToggle').addEventListener('click', () => {
    const dock = $('#publishBar');
    const open = dock.classList.toggle('open');
    $('#publishBody').hidden = !open;
    $('#publishToggle').setAttribute('aria-expanded', String(open));
  });
  $('#publishList').addEventListener('click', async (e) => {
    const goto = e.target.closest('.pc-goto');
    if (goto) { goToChange(goto.dataset.target); return; }

    const undo = e.target.closest('.pc-undo');
    if (!undo) return;
    // Undoing an older change also rolls back anything newer that touched the
    // same files, so say so rather than letting her find out afterwards.
    const rows = [...$('#publishList').querySelectorAll('.pc-undo')];
    const newer = rows.indexOf(undo);
    const lines = ['Alles wat deze wijziging aanpaste gaat terug naar hoe het daarvoor was.'];
    if (newer > 0) {
      lines.push(newer === 1
        ? `<span class="warn">Let op:</span> er is 1 nieuwere wijziging. Raakte die dezelfde producten of foto's aan, dan gaat die ook terug.`
        : `<span class="warn">Let op:</span> er zijn ${newer} nieuwere wijzigingen. Raakten die dezelfde producten of foto's aan, dan gaan die ook terug.`);
    }
    lines.push('Je kunt daarna gewoon opnieuw wijzigen.');
    const go = await askConfirm({
      title: `"${undo.dataset.what}" ongedaan maken?`,
      lines,
      confirmLabel: 'Ja, zet terug',
      danger: true
    });
    if (go) await undoChange(undo.dataset.sha, undo.dataset.what);
  });

  $('#s-accent').addEventListener('input', (e) => { $('#s-accentHex').value = e.target.value; });
  $('#s-accentHex').addEventListener('input', (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('#s-accent').value = e.target.value; });

  $('#a-photo-input').addEventListener('change', () => {
    const f = $('#a-photo-input').files[0];
    if (f) $('#a-photo-preview').src = URL.createObjectURL(f);
  });
  $('#s-logofull-input').addEventListener('change', () => {
    const f = $('#s-logofull-input').files[0];
    if (f) $('#s-logofull-preview').src = URL.createObjectURL(f);
  });
  $('#s-logo-input').addEventListener('change', () => {
    const f = $('#s-logo-input').files[0];
    if (f) $('#s-logo-preview').src = URL.createObjectURL(f);
  });
});
