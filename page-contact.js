// Split out of contact.html so the site can run under a Content-Security-Policy
// that forbids inline scripts.
document.addEventListener('site:loaded', (e) => {
  const site = e.detail;
  const esc = window.SojozinoSite.escapeHTML;
  const links = [];
  if (site.email) links.push(`<a class="contact-link reveal" href="mailto:${esc(site.email)}">&#9993; ${esc(site.email)}</a>`);
  if (site.instagramUrl) links.push(`<a class="contact-link reveal" href="${esc(site.instagramUrl)}" target="_blank" rel="noopener">&#64; Instagram</a>`);
  if (site.location) links.push(`<span class="contact-link reveal">&#128205; ${esc(site.location)}</span>`);
  document.getElementById('contactLinks').innerHTML = links.join('');
  window.SojozinoSite.initReveal();
});
