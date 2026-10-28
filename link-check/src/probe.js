import { parseHttpUrl, isBlockedTarget, sanitizeUrl, isBotWallHost } from './urls.js';
import { needsGetFallback, shouldRetry } from './classify.js';

const REDIRECT = new Set([301, 302, 303, 307, 308]);
const MAX_HOPS = 5;

export function networkErrorCode(err) {
  const parts = [];
  const seen = new Set();
  let current = err;
  while (current && !seen.has(current) && parts.length < 8) {
    seen.add(current);
    if (current.code) parts.push(current.code);
    if (current.errno && current.errno !== current.code) parts.push(current.errno);
    if (current.name) parts.push(current.name);
    if (current.message) parts.push(current.message);
    current = current.cause;
  }
  const blob = parts.join(' ').toLowerCase();
  if (blob.includes('abort') || blob.includes('timeout') || blob.includes('timed out')) return 'timeout';
  if (blob.includes('enotfound') || blob.includes('eai_again')) return 'dns';
  if (/cert|tls|ssl|unable to verify|err_tls/.test(blob)) return 'tls';
  return 'network';
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestOnce(method, url, options) {
  try {
    const response = await fetchWithTimeout(fetchImplOf(options), url, {
      method,
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        'user-agent': options.userAgent,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    }, options.timeoutMs);
    const location = response.headers?.get?.('location') || null;
    if (response.body && typeof response.body.cancel === 'function') {
      try { await response.body.cancel(); } catch { /* the status is enough */ }
    }
    return { url, status: response.status, location, error: null };
  } catch (err) {
    return { url, status: null, location: null, error: networkErrorCode(err) };
  }
}

function fetchImplOf(options) {
  if (typeof options.fetchImpl !== 'function') throw new Error('fetchImpl is required');
  return options.fetchImpl;
}

async function follow(first, method, options) {
  const redirectCodes = [];
  let current = first;
  let hops = 0;
  const seen = new Set([first.url]);
  let activeMethod = method;
  while (current.status && REDIRECT.has(current.status)) {
    if (!current.location) {
      return { url: first.url, status: current.status, finalUrl: current.url, redirectCodes, error: 'bad-redirect' };
    }
    if (hops >= MAX_HOPS) {
      return { url: first.url, status: current.status, finalUrl: current.url, redirectCodes, error: 'too-many-redirects' };
    }
    let next;
    try {
      next = new URL(current.location, current.url).href;
    } catch {
      return { url: first.url, status: current.status, finalUrl: null, redirectCodes, error: 'bad-redirect' };
    }
    const parsed = parseHttpUrl(next);
    if (!parsed || isBlockedTarget(parsed)) {
      return { url: first.url, status: null, finalUrl: next, redirectCodes, error: 'blocked-url' };
    }
    next = sanitizeUrl(next) || next;
    if (seen.has(next)) {
      return { url: first.url, status: current.status, finalUrl: next, redirectCodes, error: 'redirect-loop' };
    }
    seen.add(next);
    redirectCodes.push(current.status);
    hops += 1;
    if (current.status === 303) activeMethod = 'GET';
    let hop = await requestOnce(activeMethod, next, options);
    if (shouldTryGet(hop, next, options) && activeMethod === 'HEAD') {
      hop = await requestOnce('GET', next, options);
      if (shouldRetry(hop)) hop = await requestOnce('GET', next, options);
      activeMethod = 'GET';
    } else if (shouldRetry(hop)) {
      hop = await requestOnce(activeMethod, next, options);
    }
    current = hop;
  }
  return {
    url: first.url,
    status: current.status,
    finalUrl: current.url,
    redirectCodes,
    error: current.error,
  };
}

// A 403 from Facebook or Instagram is the bot wall. Anywhere else, HEAD is often
// refused while GET still works, so that 403 is a reason to try GET.
function shouldTryGet(head, url, options) {
  if (needsGetFallback(head)) return true;
  if (head?.status === 403 && !isBotWallHost(url, options.unverifiableHosts)) return true;
  return false;
}

// HEAD first. GET is the fallback when HEAD has no usable answer. Retry a failed read once.
export async function probeUrl(rawUrl, options) {
  const original = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!original) {
    return { url: '', status: null, finalUrl: null, redirectCodes: [], error: 'missing-url' };
  }
  const parsed = parseHttpUrl(original);
  if (!parsed) {
    return { url: original, status: null, finalUrl: null, redirectCodes: [], error: 'bad-url' };
  }
  if (isBlockedTarget(parsed)) {
    return { url: original, status: null, finalUrl: null, redirectCodes: [], error: 'blocked-url' };
  }
  const start = sanitizeUrl(original);
  let head = await requestOnce('HEAD', start, options);
  if (shouldRetry(head) && !shouldTryGet(head, start, options)) {
    head = await requestOnce('HEAD', start, options);
  }
  if (shouldTryGet(head, start, options)) {
    let get = await requestOnce('GET', start, options);
    if (shouldRetry(get)) get = await requestOnce('GET', start, options);
    return follow(get, 'GET', options);
  }
  return follow(head, 'HEAD', options);
}
