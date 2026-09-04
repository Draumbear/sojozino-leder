// Order/inquiry form, submitted as a real Netlify Form (see the comment in
// bestellen.html) via fetch() so the page doesn't reload. The dropdowns are
// populated from the same data files the rest of the site reads, so a new
// product added through the dashboard shows up here automatically.
//
// The piece dropdown carries every product from the start, grouped by
// category, because a visitor arrives wanting a wallet, not a taxonomy. The
// category dropdown only narrows that list. The visible dropdowns carry the
// internal slug (needed for filtering); three hidden inputs mirror the
// readable text into the fields that actually get submitted, so Johnny's
// inbox shows names, not slugs -- and the category is taken from the chosen
// piece, so it arrives filled in even when nobody touched the filter.

async function loadJSON(path) {
  const res = await fetch(`${path}?_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

function esc(str) { return window.SojozinoSite.escapeHTML(str); }

function encodeFormData(data) {
  return Object.keys(data).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(data[k])).join('&');
}

async function initOrderForm() {
  const [categories, products] = await Promise.all([
    loadJSON('data/categories.json'),
    loadJSON('data/products-index.json'),
  ]);

  const catSel = document.getElementById('of-category');
  const subSel = document.getElementById('of-subcategory');
  const subWrap = document.getElementById('of-subcategory-wrap');
  const prodSel = document.getElementById('of-product');
  const catHidden = document.getElementById('of-category-hidden');
  const subHidden = document.getElementById('of-subcategory-hidden');
  const prodHidden = document.getElementById('of-product-hidden');

  const hintEl = document.getElementById('of-product-hint');
  const catBySlug = new Map((categories || []).map(c => [c.slug, c]));
  const all = (products || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  (categories || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.slug; opt.textContent = c.name;
    catSel.appendChild(opt);
  });

  function productsFor(catSlug, subSlug) {
    return all.filter(p => (!catSlug || p.category === catSlug) && (!subSlug || p.subcategory === subSlug));
  }

  // The category on the piece itself wins: the filter may well be untouched.
  function categoryNameFor(product) {
    if (product) return catBySlug.get(product.category)?.name || '';
    return catSel.value ? catSel.selectedOptions[0].textContent : '';
  }

  function subcategoryNameFor(product) {
    if (product) {
      const subs = catBySlug.get(product.category)?.subcategories || [];
      return subs.find(s => s.slug === product.subcategory)?.name || '';
    }
    return !subWrap.hidden && subSel.value ? subSel.selectedOptions[0].textContent : '';
  }

  function syncHidden() {
    const chosen = all.find(p => p.slug === prodSel.value);
    catHidden.value = categoryNameFor(chosen);
    subHidden.value = subcategoryNameFor(chosen);
    prodHidden.value = chosen ? chosen.name : 'iets op maat / nog niet gekozen';
  }

  // Ungrouped once a category is picked -- the group headers would then all
  // say the same thing.
  function renderProductOptions() {
    const keep = prodSel.value;
    const list = productsFor(catSel.value, subSel.value);
    prodSel.innerHTML = '<option value="">Iets op maat / nog niet gekozen</option>';

    const add = (parent, p) => {
      const opt = document.createElement('option');
      opt.value = p.slug; opt.textContent = p.name;
      parent.appendChild(opt);
    };

    if (catSel.value) {
      list.forEach(p => add(prodSel, p));
    } else {
      (categories || []).forEach(c => {
        const mine = list.filter(p => p.category === c.slug);
        if (!mine.length) return;
        const group = document.createElement('optgroup');
        group.label = c.name;
        mine.forEach(p => add(group, p));
        prodSel.appendChild(group);
      });
      // Anything whose category was removed since it was saved.
      const orphans = list.filter(p => !catBySlug.has(p.category));
      if (orphans.length) {
        const group = document.createElement('optgroup');
        group.label = 'Overige';
        orphans.forEach(p => add(group, p));
        prodSel.appendChild(group);
      }
    }

    // A filter that hides what you already chose would silently change your
    // answer, so keep the choice whenever it survives the filter.
    if (keep && list.some(p => p.slug === keep)) prodSel.value = keep;
    updateHint(list.length);
    syncHidden();
  }

  function updateHint(count) {
    if (!hintEl) return;
    if (!all.length) {
      hintEl.textContent = 'Beschrijf hieronder wat je zoekt \u2014 Johnny denkt met je mee.';
    } else if (catSel.value && count) {
      const label = subSel.value ? subSel.selectedOptions[0].textContent : catSel.selectedOptions[0].textContent;
      hintEl.innerHTML = `${count} ${count === 1 ? 'stuk' : 'stukken'} in <strong>${esc(label)}</strong>. Staat je stuk er niet bij? Laat het op <em>iets op maat</em> staan.`;
    } else if (catSel.value) {
      hintEl.textContent = 'Hier staat nog niets bij. Beschrijf hieronder gerust wat je zoekt.';
    } else {
      hintEl.innerHTML = `Alle ${all.length} stukken staan in de lijst, gegroepeerd per categorie. Staat je stuk er niet bij? Laat het op <em>iets op maat</em> staan en beschrijf het hieronder.`;
    }
  }

  function renderSubcategoryOptions() {
    const cat = catBySlug.get(catSel.value);
    const subs = cat?.subcategories || [];
    const used = new Set(productsFor(cat?.slug, null).map(p => p.subcategory));
    const usable = subs.filter(s => used.has(s.slug));
    if (!cat || !usable.length) { subWrap.hidden = true; subSel.value = ''; return; }
    subWrap.hidden = false;
    subSel.innerHTML = '<option value="">Alle onderverdelingen</option>' +
      usable.map(s => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join('');
  }

  catSel.addEventListener('change', () => { renderSubcategoryOptions(); renderProductOptions(); });
  subSel.addEventListener('change', renderProductOptions);
  prodSel.addEventListener('change', syncHidden);
  renderProductOptions();

  // Closing the panel also clears the filter: a narrowed list with the reason
  // folded away is the same trap as the old category-first form. Whatever
  // piece was already chosen survives, because widening the list can only add
  // options.
  const filterPanel = document.getElementById('of-filter');
  const filterToggle = document.getElementById('of-filter-toggle');
  filterToggle.addEventListener('click', () => {
    const open = filterPanel.hidden;
    filterPanel.hidden = !open;
    filterToggle.setAttribute('aria-expanded', String(open));
    filterToggle.textContent = open ? 'Filter sluiten' : 'Lijst filteren op categorie';
    if (!open && catSel.value) {
      catSel.value = '';
      renderSubcategoryOptions();
      renderProductOptions();
    }
    if (open) catSel.focus();
  });

  // Browsers word their own validation bubbles, and on a Dutch page an English
  // "Please fill out this field" is one more thing to decode. Cleared on input
  // so a corrected field stops complaining.
  const messages = {
    'of-message': 'Beschrijf kort je vraag of wens.',
    'of-name': 'Vul je naam in.',
    'of-email': 'Vul je e-mailadres in \u2014 anders kan Johnny je niet antwoorden.',
  };
  Object.entries(messages).forEach(([id, text]) => {
    const el = document.getElementById(id);
    const check = () => {
      el.setCustomValidity('');
      if (el.validity.valueMissing) el.setCustomValidity(text);
      else if (el.validity.typeMismatch) el.setCustomValidity('Dit lijkt geen geldig e-mailadres. Controleer het even.');
      el.closest('.order-field').classList.toggle('has-error', !el.validity.valid && el.value !== '');
    };
    el.addEventListener('input', check);
    el.addEventListener('blur', check);
    check();
  });

  const site = await loadJSON('data/site.json');
  const mail = document.getElementById('orderErrorMail');
  if (mail && site && site.email) {
    mail.href = `mailto:${site.email}`;
    mail.textContent = site.email;
  }

  const form = document.getElementById('orderForm');
  const submitBtn = document.getElementById('orderSubmitBtn');
  const errorEl = document.getElementById('orderError');
  const successEl = document.getElementById('orderSuccess');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    form.querySelectorAll('.order-field.has-error').forEach(f => f.classList.remove('has-error'));
    if (!form.reportValidity()) {
      const bad = form.querySelector(':invalid');
      if (bad && bad.closest('.order-field')) bad.closest('.order-field').classList.add('has-error');
      return;
    }
    syncHidden();

    submitBtn.disabled = true;
    submitBtn.textContent = 'Bezig met versturen…';
    errorEl.classList.add('hidden');

    const data = Object.fromEntries(new FormData(form).entries());
    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeFormData(data),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        form.classList.add('hidden');
        successEl.classList.remove('hidden');
        successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(() => {
        errorEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Vraag versturen';
      });
  });
}

document.addEventListener('site:loaded', initOrderForm);
