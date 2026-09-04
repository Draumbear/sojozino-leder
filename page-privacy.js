// Split out of privacy.html so the site can run under a Content-Security-Policy
// that forbids inline scripts.
// Name, place and mail address come from the dashboard rather than being typed
// in here, so this page cannot quietly drift out of date with the rest of the site.
document.addEventListener('site:loaded', (e) => {
  const site = e.detail;
  const esc = window.SojozinoSite.escapeHTML;
  const who = [site.businessName, site.ownerName].filter(Boolean).map(esc).join(' — ');
  // The address, where he has filled one in, is the more precise answer to
  // "who is responsible for my data" than the town on its own.
  const where = site.address || site.location;
  document.getElementById('privacyController').innerHTML =
    `${who || 'Sojozino'}${where ? ', ' + esc(where) : ''}.` +
    (site.vatNumber ? ` BTW ${esc(site.vatNumber)}.` : '');
  document.getElementById('privacyContact').innerHTML = site.email
    ? `Vragen over je gegevens? Mail naar <a href="mailto:${esc(site.email)}">${esc(site.email)}</a>.`
    : 'Vragen over je gegevens? Neem contact op via de contactpagina.';
  window.SojozinoSite.initReveal();
});
