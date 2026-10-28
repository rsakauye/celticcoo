import { isBotWallHost, urlsEquivalent, sanitizeUrl } from './urls.js';

// 405/404/400 on HEAD are often "this server ignores HEAD", so the probe tries GET.
const HEAD_FALLBACK = new Set([400, 404, 405, 501]);
// One retry, then we keep the result. 429 is included so a brief limit can clear, and a second 429 is unverifiable.
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const BROKEN_ERRORS = new Set([
  'too-many-redirects',
  'redirect-loop',
  'bad-redirect',
  'missing-url',
  'bad-url',
  'blocked-url',
  'missing-id',
]);

export function needsGetFallback(outcome) {
  if (!outcome || outcome.error) return true;
  return HEAD_FALLBACK.has(outcome.status);
}

export function shouldRetry(outcome) {
  if (!outcome) return true;
  if (outcome.error === 'dns' || outcome.error === 'blocked-url' || outcome.error === 'missing-url' || outcome.error === 'bad-url') {
    return false;
  }
  if (outcome.error) return true;
  return TRANSIENT.has(outcome.status);
}

function permanentlyMoved(outcome) {
  const permanent = (outcome.redirectCodes || []).some((code) => code === 301 || code === 308);
  if (!permanent || !outcome.finalUrl) return false;
  return !urlsEquivalent(outcome.url, outcome.finalUrl);
}

// 403 and 429 are bot walls on ordinary hosts as well as Facebook and Instagram.
// 400/401 count only for those known hosts, so a real missing page (404) still shows up.
function isUnverifiable(outcome, hosts) {
  const status = outcome.status;
  if (status == null) return false;
  if (status === 403 || status === 429) return true;
  if ((status === 400 || status === 401) && isBotWallHost(outcome.finalUrl || outcome.url, hosts)) return true;
  return false;
}

function pack(lastStatus, finalUrl, detail) {
  return {
    last_status: lastStatus,
    final_url: finalUrl || null,
    detail: detail || null,
  };
}

export function classifyOutcome(outcome, options = {}) {
  const hosts = options.unverifiableHosts;
  const finalUrl = outcome.finalUrl ? sanitizeUrl(outcome.finalUrl) || outcome.finalUrl : null;
  if (outcome.error && BROKEN_ERRORS.has(outcome.error)) {
    return pack('broken', null, outcome.error);
  }
  if (isUnverifiable(outcome, hosts)) {
    return pack('unverifiable', null, `HTTP ${outcome.status}`);
  }
  if (outcome.error || outcome.status == null) {
    return pack('unreachable', null, outcome.error || 'network');
  }
  const moved = permanentlyMoved({ ...outcome, finalUrl: outcome.finalUrl });
  if (moved && outcome.status >= 200 && outcome.status < 300) {
    return pack('redirect', finalUrl, 'permanent redirect');
  }
  if (outcome.status >= 200 && outcome.status < 300) {
    return pack('ok', null, null);
  }
  if (moved) return pack('broken', finalUrl, `HTTP ${outcome.status}`);
  return pack('broken', null, `HTTP ${outcome.status}`);
}
