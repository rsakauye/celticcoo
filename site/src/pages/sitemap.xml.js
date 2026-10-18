// Simple sitemap of the site's pages (no extra dependency).
const PAGES = ['', 'events/', 'results/', 'groups/', 'burns-night/', 'shops/', 'fundraising/', 'what-to-wear/', 'tartans/', 'roots/', 'submit/', 'about/', 'newsletter/'];
export function GET(context) {
  const site = new URL(import.meta.env.BASE_URL, context.site).href;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' });
  const urls = PAGES.map((p) => `  <url><loc>${site}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
