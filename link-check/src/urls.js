export const DEFAULT_BOT_HOSTS = [
  'facebook.com',
  'fb.com',
  'fb.me',
  'instagram.com',
  'instagr.am',
];

export function parseHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

function ipv4Blocked(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return true;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function ipv6Blocked(host) {
  const bare = host.split('%')[0];
  if (bare === '::' || bare === '::1') return true;
  const head = bare.toLowerCase();
  if (head.startsWith('fe80:')) return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(head)) return true;
  return false;
}

// Refuse local and link-local targets before any socket is opened.
export function isBlockedTarget(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === 'metadata.google.internal' || host === 'metadata.internal') return true;
  if (host.includes(':')) return ipv6Blocked(host);
  return ipv4Blocked(host);
}

export function sanitizeUrl(value) {
  const url = parseHttpUrl(value);
  if (!url || isBlockedTarget(url)) return null;
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.href;
}

function hostKey(url) {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return url.port ? `${host}:${url.port}` : host;
}

function stripSlash(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

// http and https, and a trailing slash, are the same page. A new host or path is not.
export function urlsEquivalent(left, right) {
  const a = parseHttpUrl(left);
  const b = parseHttpUrl(right);
  if (!a || !b) return false;
  return hostKey(a) === hostKey(b) && stripSlash(a.pathname) === stripSlash(b.pathname) && a.search === b.search;
}

export function isBotWallHost(value, suffixes = DEFAULT_BOT_HOSTS) {
  const url = parseHttpUrl(value);
  if (!url) return false;
  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  return suffixes.some((suffix) => {
    const needle = String(suffix).toLowerCase().replace(/^\.+/, '').replace(/^www\./, '');
    return host === needle || host.endsWith(`.${needle}`);
  });
}
