// Split out of over-mij.html so the site can run under a Content-Security-Policy
// that forbids inline scripts.
document.addEventListener('site:loaded', (e) => {
  const site = e.detail;
  const esc = window.SojozinoSite.escapeHTML;
  document.getElementById('aboutHeading').textContent = site.aboutHeading || 'Over Sojozino';
  document.getElementById('aboutParagraphs').innerHTML =
    (site.aboutParagraphs || []).map(p => `<p class="reveal">${esc(p)}</p>`).join('');
  const img = document.querySelector('.about-page img');
  if (img && site.aboutPhoto?.src) { img.src = site.aboutPhoto.src; img.alt = site.aboutPhoto.alt || site.ownerName || ''; }
  window.SojozinoSite.initReveal();
});
