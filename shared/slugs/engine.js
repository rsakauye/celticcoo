// Site-agnostic profile slugs and permanent short codes.
// Pass a site pack from ./sites/. This file does not name a site.

export const DEFAULT_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const DEFAULT_FILLERS = ['the', 'of', 'and', 'a', 'an'];

const PUBLISHED_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeConfig(config = {}) {
  const alphabet = String(config.alphabet || DEFAULT_ALPHABET);
  return {
    fillers: new Set((config.fillers || DEFAULT_FILLERS).map((word) => String(word).toLowerCase())),
    phrases: (config.suffixPhrases || []).map((phrase) => phrase.map((word) => String(word).toLowerCase())),
    words: new Set((config.suffixWords || []).map((word) => String(word).toLowerCase())),
    max: Number(config.maxSlugLength) > 0 ? Number(config.maxSlugLength) : 30,
    collisionField: config.collisionField || 'city',
    collisionSkip: new Set((config.collisionSkip || []).map((word) => String(word).toLowerCase())),
    extraFields: Array.isArray(config.extraCollisionFields) ? config.extraCollisionFields : [],
    length: Number(config.shortCodeLength) > 0 ? Number(config.shortCodeLength) : 4,
    alphabet,
    alphabetSet: new Set(alphabet),
    shortPrefix: config.shortPrefix || '/g/',
    profilePrefix: config.profilePrefix || '/',
    retired: new Set((config.retiredCodes || []).map((code) => String(code).toLowerCase())),
  };
}

function wordsOf(name) {
  const raw = String(name ?? '').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’ʼ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
  return raw.filter((word, i) => i === 0 || word !== raw[i - 1]);
}

function stripSuffixes(words, cfg) {
  let w = words.slice();
  for (let guard = 0; w.length > 1 && guard < 24; guard += 1) {
    let removed = false;
    for (const phrase of cfg.phrases) {
      for (let i = 0; i <= w.length - phrase.length; i += 1) {
        if (w.length === phrase.length) continue;
        if (!phrase.every((part, k) => w[i + k] === part)) continue;
        w = w.slice(0, i).concat(w.slice(i + phrase.length));
        removed = true;
        break;
      }
      if (removed) break;
    }
    if (removed) continue;
    const at = w.findIndex((word) => cfg.words.has(word));
    if (at < 0) break;
    w = w.slice(0, at).concat(w.slice(at + 1));
  }
  return w;
}

function significantWords(name, cfg) {
  const tokens = wordsOf(name).filter((word) => !cfg.fillers.has(word));
  const stripped = stripSuffixes(tokens, cfg);
  if (stripped.length) return stripped;
  if (tokens.length) return tokens;
  const raw = wordsOf(name);
  return raw.length ? raw : ['group'];
}

function capWords(words, max) {
  const out = [];
  for (const word of words) {
    const next = out.length ? `${out.join('-')}-${word}` : word;
    if (next.length > max) {
      if (out.length && next.length <= max + 2) out.push(word);
      break;
    }
    out.push(word);
  }
  if (!out.length) return [String(words[0] || 'group').slice(0, max)];
  return out;
}

function fitSuffix(words, extra, max) {
  const kept = words.slice();
  while (kept.length > 1 && `${kept.join('-')}-${extra}`.length > max) kept.pop();
  return `${kept.join('-')}-${extra}`;
}

function fieldSlug(value, cfg, { skip = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (skip && cfg.collisionSkip.has(text.toLowerCase())) return '';
  return capWords(significantWords(text, cfg), 16).join('-');
}

export function publishedSlug(value) {
  const slug = String(value ?? '').trim();
  return PUBLISHED_SLUG.test(slug) ? slug : '';
}

export function suggestSlug(name, config) {
  const cfg = normalizeConfig(config);
  return capWords(significantWords(name, cfg), cfg.max).join('-');
}

export function assignSlugs(records, config) {
  const cfg = normalizeConfig(config);
  const list = Array.isArray(records) ? records : [];
  const taken = new Set(list.map((record) => publishedSlug(record?.slug)).filter(Boolean));
  return list.map((record) => {
    const explicit = publishedSlug(record?.slug);
    if (explicit) return explicit;
    const words = significantWords(record?.name, cfg);
    let slug = capWords(words, cfg.max).join('-');
    if (taken.has(slug)) {
      const suffix = fieldSlug(record?.[cfg.collisionField], cfg, { skip: true });
      if (suffix && !slug.split('-').includes(suffix)) slug = fitSuffix(words, suffix, cfg.max);
      if (taken.has(slug)) {
        for (const word of words) {
          if (slug.split('-').includes(word)) continue;
          const next = fitSuffix(slug.split('-'), word, cfg.max + 2);
          if (!taken.has(next)) {
            slug = next;
            break;
          }
        }
      }
      for (const field of cfg.extraFields) {
        if (!taken.has(slug)) break;
        const extra = fieldSlug(record?.[field], cfg);
        if (extra && !slug.endsWith(`-${extra}`) && slug !== extra) slug = `${slug}-${extra}`;
      }
    }
    taken.add(slug);
    return slug;
  });
}

export function publishedCode(value, config) {
  const cfg = normalizeConfig(config);
  const code = String(value ?? '').trim().toLowerCase();
  if (code.length !== cfg.length) return '';
  if (![...code].every((char) => cfg.alphabetSet.has(char))) return '';
  return code;
}

export function mintShortCode(config, random = Math.random) {
  const cfg = normalizeConfig(config);
  let code = '';
  for (let i = 0; i < cfg.length; i += 1) {
    const index = Math.floor(random() * cfg.alphabet.length);
    code += cfg.alphabet[index] || cfg.alphabet[0];
  }
  return code;
}

// Existing codes stay. A missing code is minted once. Retired codes are never reused.
export function assignShortCodes(records, config, random = Math.random) {
  const cfg = normalizeConfig(config);
  const list = Array.isArray(records) ? records : [];
  const taken = new Set(cfg.retired);
  for (const record of list) {
    const existing = publishedCode(record?.code, config);
    if (existing) taken.add(existing);
  }
  return list.map((record) => {
    const existing = publishedCode(record?.code, config);
    if (existing) return existing;
    let code = '';
    for (let n = 0; n < 10000; n += 1) {
      code = mintShortCode(config, random);
      if (!taken.has(code)) break;
    }
    taken.add(code);
    return code;
  });
}

export function createRng(seed) {
  let state = Number(seed) >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function caseVariants(code) {
  const parts = [...String(code)].map((char) => {
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    return lower === upper ? [lower] : [lower, upper];
  });
  const out = [];
  const walk = (i, acc) => {
    if (i === parts.length) {
      out.push(acc);
      return;
    }
    for (const char of parts[i]) walk(i + 1, acc + char);
  };
  walk(0, '');
  return out;
}

function joinPath(prefix, rest) {
  const left = String(prefix || '/');
  const right = String(rest || '').replace(/^\/+/, '');
  const base = left.endsWith('/') ? left : `${left}/`;
  return `${base}${right}`;
}

// One 301 per case variant. Static hosts match the path as written.
export function redirectLines(records, config) {
  const cfg = normalizeConfig(config);
  const lines = [];
  for (const record of Array.isArray(records) ? records : []) {
    const code = publishedCode(record?.code, config);
    const slug = publishedSlug(record?.slug);
    if (!code || !slug) continue;
    const target = joinPath(cfg.profilePrefix, `${slug}/`);
    for (const variant of caseVariants(code)) {
      lines.push(`${joinPath(cfg.shortPrefix, variant)} ${target} 301`);
    }
  }
  return lines;
}
