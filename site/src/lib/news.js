// Build-time "latest results & news" strip: headline + link only, from the publishers' own public RSS feeds.
// Never copies article text or images. Fails quietly (the strip just shows the publishers' links).
const FEEDS = [
  { source: 'pipes|drums', home: 'https://www.pipesdrums.com/results/', url: 'https://www.pipesdrums.com/feed/' },
  { source: 'Piping Press', home: 'https://pipingpress.com/', url: 'https://pipingpress.com/feed/' },
];
// We don't show individual names of minors. Skip headlines that look like they're about junior/youth solo results.
const MINOR_HINT = /\b(junior|juvenile|youth|novice|under[- ]?\d+|u\d{2}|kids?|child|children|students?|school|beginner|chanter|grade [45]|teen)/i;
const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&apos;|&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, '').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? decode(m[1]) : ''; };

let cache;
export async function getNews(perFeed = 4) {
  if (cache) return cache;
  const out = [];
  for (const f of FEEDS) {
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 10000);
      const r = await fetch(f.url, { signal: ctl.signal, headers: { 'User-Agent': 'CelticCooBot/0.1 (+https://celticcoo.ca/about/; headline links only)' } });
      clearTimeout(timer);
      if (!r.ok) continue;
      const xml = await r.text();
      const items = (xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []).map((it) => ({
        source: f.source, title: tag(it, 'title'), link: tag(it, 'link'), date: tag(it, 'pubDate'),
      })).filter((x) => x.title && /^https:\/\//.test(x.link) && !MINOR_HINT.test(x.title));
      out.push(...items.slice(0, perFeed));
    } catch { /* offline or blocked: skip this feed */ }
  }
  out.sort((a, b) => new Date(b.date) - new Date(a.date));
  cache = { items: out, feeds: FEEDS };
  return cache;
}
