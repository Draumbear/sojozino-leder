// Order/inquiry form, submitted as a real Netlify Form (see the comment in
// bestellen.html) via fetch() so the page doesn't reload. The
// category/subcategory/product dropdowns are populated from the same data
// files the rest of the site reads, so a new product added through the
// dashboard shows up here automatically. The visible dropdowns carry the
// internal slug (needed to filter subcategories/products); three hidden
// inputs mirror the readable text into the fields that actually get
// submitted, so Johnny's inbox shows names, not slugs.

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

  (categories || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.slug; opt.textContent = c.name;
    catSel.appendChild(opt);
  });

  function productsFor(catSlug, subSlug) {
    return (products || [])
      .filter(p => p.category === catSlug && (!subSlug || p.subcategory === subSlug))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function syncHidden() {
    catHidden.value = catSel.selectedOptions[0]?.textContent || '';
    subHidden.value = !subWrap.hidden ? (subSel.selectedOptions[0]?.textContent || '') : '';
    prodHidden.value = prodSel.value ? (prodSel.selectedOptions[0]?.textContent || '') : 'iets op maat / nog niet gekozen';
  }

  function renderProductOptions() {
    const cat = catSel.value;
    const sub = subSel.value;
    prodSel.innerHTML = '<option value="">Iets op maat / nog niet gekozen</option>';
    if (cat) {
      productsFor(cat, sub).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.slug; opt.textContent = p.name;
        prodSel.appendChild(opt);
      });
    }
    syncHidden();
  }

  function renderSubcategoryOptions() {
    const cat = (categories || []).find(c => c.slug === catSel.value);
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

  const form = document.getElementById('orderForm');
  const submitBtn = document.getElementById('orderSubmitBtn');
  const errorEl = document.getElementById('orderError');
  const successEl = document.getElementById('orderSuccess');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
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
