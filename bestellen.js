// Order/inquiry form. No backend: on submit this builds a mailto: link with
// the selection + message + contact details pre-filled and hands off to the
// visitor's own mail app — there's nowhere else for a static site with no
// server to deliver it. The category/subcategory/product dropdowns are
// populated from the same data files the rest of the site reads, so a new
// product added through the dashboard shows up here automatically.

async function loadJSON(path) {
  const res = await fetch(`${path}?_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

function esc(str) { return window.SojozinoSite.escapeHTML(str); }

async function initOrderForm(site) {
  const [categories, products] = await Promise.all([
    loadJSON('data/categories.json'),
    loadJSON('data/products-index.json'),
  ]);

  document.getElementById('of-email-target').textContent = site.email || 'sojozino@gmail.com';

  const catSel = document.getElementById('of-category');
  const subSel = document.getElementById('of-subcategory');
  const subWrap = document.getElementById('of-subcategory-wrap');
  const prodSel = document.getElementById('of-product');

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

  function renderProductOptions() {
    const cat = catSel.value;
    const sub = subSel.value;
    prodSel.innerHTML = '<option value="">Iets op maat / nog niet gekozen</option>';
    if (!cat) return;
    productsFor(cat, sub).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.slug; opt.textContent = p.name;
      prodSel.appendChild(opt);
    });
  }

  function renderSubcategoryOptions() {
    const cat = (categories || []).find(c => c.slug === catSel.value);
    const subs = cat?.subcategories || [];
    if (!subs.length) { subWrap.hidden = true; subSel.value = ''; renderProductOptions(); return; }
    // Only offer subcategories that actually have products under them.
    const used = new Set(productsFor(cat.slug, null).map(p => p.subcategory));
    const usable = subs.filter(s => used.has(s.slug));
    if (!usable.length) { subWrap.hidden = true; subSel.value = ''; renderProductOptions(); return; }
    subWrap.hidden = false;
    subSel.innerHTML = '<option value="">Alle onderverdelingen</option>' +
      usable.map(s => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join('');
  }

  catSel.addEventListener('change', () => { renderSubcategoryOptions(); renderProductOptions(); });
  subSel.addEventListener('change', renderProductOptions);

  document.getElementById('orderForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const catName = catSel.selectedOptions[0]?.textContent || '';
    const subName = !subWrap.hidden ? (subSel.selectedOptions[0]?.textContent || '') : '';
    const prodName = prodSel.selectedOptions[0]?.textContent || '';
    const message = document.getElementById('of-message').value.trim();
    const name = document.getElementById('of-name').value.trim();
    const email = document.getElementById('of-email').value.trim();
    const phone = document.getElementById('of-phone').value.trim();

    if (!catSel.value || !message || !name || !email) {
      alert('Vul zeker een categorie, je vraag, naam en e-mailadres in.');
      return;
    }

    const lines = [
      `Categorie: ${catName}`,
      subName ? `Onderverdeling: ${subName}` : null,
      `Stuk: ${prodSel.value ? prodName : 'iets op maat / nog niet gekozen'}`,
      '',
      message,
      '',
      `Naam: ${name}`,
      `E-mail: ${email}`,
      phone ? `Telefoon: ${phone}` : null,
    ].filter(Boolean);

    const subject = `Bestelling via website: ${prodSel.value ? prodName : catName}`;
    const to = (site.email || 'sojozino@gmail.com');
    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
    window.location.href = mailto;
  });
}

document.addEventListener('site:loaded', (e) => initOrderForm(e.detail));
