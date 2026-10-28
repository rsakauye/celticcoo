// Tags same-origin links on /links/. Mailto and other schemes stay as written.
// ?src=fb|facebook -> facebook. ?src=ig|instagram, or anything else, -> instagram.

export function utmSource(src) {
  const value = String(src ?? '').trim().toLowerCase();
  if (value === 'fb' || value === 'facebook') return 'facebook';
  return 'instagram';
}

export function tagHref(href, pageUrl, source) {
  let url;
  try {
    url = new URL(href, pageUrl);
  } catch {
    return href;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return href;
  let page;
  try {
    page = new URL(pageUrl);
  } catch {
    return href;
  }
  if (url.origin !== page.origin) return href;
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', 'social');
  url.searchParams.set('utm_campaign', 'links');
  return url.toString();
}

export function tagOnSiteLinks(doc, pageUrl) {
  const here = pageUrl || doc.baseURI;
  if (!here) return;
  const source = utmSource(new URL(here).searchParams.get('src'));
  for (const a of doc.querySelectorAll('a[data-utm]')) {
    const raw = a.getAttribute('href');
    if (!raw) continue;
    const next = tagHref(raw, here, source);
    if (next !== raw) a.setAttribute('href', next);
  }
}
