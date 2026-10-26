// Deterministic scorer and extractor. Phrases come from a site pack.
// Nothing here calls a model or the network.

import { clamp, escapeRegExp, fold, oneLine, round3 } from './text.js';

const MONTH_FORMS = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sep', 'sept'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
];

const MONTH_NUMBER = Object.fromEntries(MONTH_FORMS.flatMap(([full, ...rest], index) => {
  const n = index + 1;
  return [full, ...rest].map((name) => [name, n]);
}));

const MONTH_ALT = MONTH_FORMS.flat().join('|');
const ORDINAL = '(?:st|nd|rd|th)?';

export const DATE_RE = new RegExp(
  `\\b(\\d{1,2}${ORDINAL}\\s+(?:${MONTH_ALT})\\s+\\d{4}|(?:${MONTH_ALT})\\s+\\d{1,2}${ORDINAL},?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})\\b`,
  'i',
);

const WEEKDAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
const NOT_A_CITY = new Set([...Object.keys(MONTH_NUMBER), ...WEEKDAYS, 'the', 'our', 'this', 'please', 'test']);

function phrasePattern(forms) {
  const parts = [];
  const seen = new Set();
  for (const form of forms) {
    const folded = fold(form);
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);
    parts.push(folded);
  }
  parts.sort((a, b) => b.length - a.length);
  if (!parts.length) return null;
  const body = parts.map((form) => form.split(' ').map(escapeRegExp).join('\\s+')).join('|');
  return new RegExp(`(?:^|[^a-z0-9])(?:${body})(?=$|[^a-z0-9])`, 'i');
}

function compilePhrases(phrases) {
  return (phrases || []).map((phrase) => ({
    ...phrase,
    pattern: phrasePattern(phrase.forms || []),
  })).filter((phrase) => phrase.pattern);
}

export function compileSite(site) {
  const phrases = compilePhrases(site.phrases);
  const towns = [...(site.albertaTowns || [])].sort((a, b) => b.length - a.length);
  return {
    ...site,
    compiledPhrases: phrases,
    townPattern: towns.length
      ? new RegExp(`\\b(?:${towns.map((town) => fold(town).split(' ').map(escapeRegExp).join('\\s+')).join('|')})\\b`, 'i')
      : null,
    towns,
  };
}

export function stripBoilerplate(body) {
  const lines = String(body ?? '').replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^>/.test(trimmed)) continue;
    if (/^on .{0,180} wrote:\s*$/i.test(trimmed)) break;
    if (/^-{2,}\s*original message\s*-{2,}\s*$/i.test(trimmed)) break;
    if (/^sent from my\b/i.test(trimmed)) break;
    if (/^--\s*$/.test(trimmed)) break;
    if (/^_{5,}\s*$/.test(trimmed)) break;
    kept.push(line);
  }
  const text = kept.join('\n').trim();
  const footerAt = text.search(/\n\s*(?:unsubscribe|you(?:\s|')?re receiving this|you are receiving this|view (?:this|the) email in|manage (?:your )?preferences|this (?:message|email) was sent)\b/i);
  if (footerAt > 80) {
    return { body: text.slice(0, footerAt).trim(), footer: text.slice(footerAt).trim() };
  }
  return { body: text, footer: '' };
}

function scoreText(compiled, text, scale, { spamOnly = false, collectRoles = true } = {}, scores, roles) {
  if (!text || scale === 0) return 0;
  const folded = fold(text);
  let hits = 0;
  for (const phrase of compiled) {
    if (spamOnly && phrase.category !== 'spam') continue;
    if (!phrase.pattern.test(folded)) continue;
    hits += 1;
    if (phrase.category && phrase.weight) {
      scores[phrase.category] = (scores[phrase.category] || 0) + phrase.weight * scale;
    }
    if (collectRoles && phrase.role) roles.add(phrase.role);
  }
  return hits;
}

function confidenceFor(category, best, second, hits, scoring, signals) {
  if (signals.automated) return 0.74;
  if (category === 'other') {
    if (signals.newsletter) return 0.66;
    return round3(Math.min(0.4, scoring.emptyConfidence + best * 0.04));
  }
  const margin = Math.max(0, best - second);
  const raw = 0.5
    + Math.min(best, 18) * 0.02
    + Math.min(margin, 10) * 0.025
    + Math.min(hits, 5) * 0.015;
  return round3(clamp(raw, 0.45, scoring.maxConfidence));
}

function pickCategory(scores, scoring) {
  const ranked = Object.entries(scores).filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]);
  const [bestName, bestScore] = ranked[0] || ['other', 0];
  const secondScore = ranked[1] ? ranked[1][1] : 0;
  if (bestScore < scoring.minScore) return { category: 'other', best: bestScore, second: secondScore };
  // Equal spam and a real request: spam wins so a pitch does not open an issue.
  if (scores.spam >= scoring.minScore && scores.spam >= bestScore) {
    return { category: 'spam', best: scores.spam, second: bestName === 'spam' ? secondScore : bestScore };
  }
  return { category: bestName, best: bestScore, second: secondScore };
}

function provinceForms(site) {
  const names = [];
  const short = [];
  for (const prov of site.provinces || []) {
    names.push(prov.name);
    for (const form of prov.forms || []) {
      const compact = String(form).replace(/\./g, '');
      if (compact.length <= 2) short.push(form);
      else names.push(form);
    }
  }
  const uniq = (list) => [...new Set(list.map((item) => String(item)))];
  const byLength = (list) => uniq(list).sort((a, b) => b.length - a.length);
  return {
    names: byLength(names),
    short: byLength(short),
  };
}

export function matchProvince(token, site) {
  const raw = String(token ?? '').trim().replace(/[.,]+$/g, '');
  if (!raw) return '';
  const folded = fold(raw).replace(/\./g, '');
  const letters = raw.replace(/[^A-Za-z]/g, '');
  for (const prov of site.provinces || []) {
    if (fold(prov.name).replace(/\./g, '') === folded) return prov.name;
    for (const form of prov.forms || []) {
      const compact = fold(form).replace(/\./g, '');
      if (compact !== folded) continue;
      // "on" is the Ontario abbreviation and an ordinary word (" , on Saturday").
      if (compact === 'on' && letters !== 'ON') continue;
      return prov.name;
    }
  }
  return '';
}

function cityOk(name) {
  const text = fold(name);
  if (!text || text.length < 2 || NOT_A_CITY.has(text)) return false;
  if (WEEKDAYS.has(text) || MONTH_NUMBER[text]) return false;
  return true;
}

function titleCasePlace(value) {
  return oneLine(value, 80);
}

export function extractFacts(subject, body, site) {
  const text = `${subject || ''}\n${body || ''}`;
  const { names, short } = provinceForms(site);
  const nameAlt = names.map(escapeRegExp).join('|');
  const shortAlt = short.map((form) => escapeRegExp(form).replace(/\\\./g, '\\.?')).join('|');
  const provAlt = [nameAlt, shortAlt].filter(Boolean).join('|');
  const cityAlt = "([A-Z][A-Za-z'’\\-]*(?:\\s+[A-Z][A-Za-z'’\\-]*){0,3})";
  let city = '';
  let province = '';
  let venue = '';

  const atComma = text.match(new RegExp(`\\bat the ([A-Z][^\\n,.]{2,80}?),\\s*${cityAlt}\\s*,\\s*(${provAlt})\\b`, 'i'));
  if (atComma && matchProvince(atComma[3], site)) {
    venue = oneLine(atComma[1], 160);
    if (cityOk(atComma[2])) city = titleCasePlace(atComma[2]);
    province = matchProvince(atComma[3], site);
  }

  if (!venue) {
    const atThe = text.match(/\bat the ([A-Z][^,\n.]{2,80}?)(?=,|\s+in\s|\s+on\s|\.|$)/);
    if (atThe) venue = oneLine(atThe[1], 160);
  }

  if (!city || !province) {
    const inCity = text.match(new RegExp(`\\bin ${cityAlt}\\s*,\\s*(${provAlt})\\b`, 'i'));
    if (inCity && cityOk(inCity[1]) && matchProvince(inCity[2], site)) {
      city = city || titleCasePlace(inCity[1]);
      province = province || matchProvince(inCity[2], site);
    }
  }

  if (!city || !province) {
    const comma = text.match(new RegExp(`(?:^|[^A-Za-z])${cityAlt}\\s*,\\s*(${provAlt})\\b`, 'i'));
    if (comma && cityOk(comma[1]) && matchProvince(comma[2], site)) {
      city = city || titleCasePlace(comma[1]);
      province = province || matchProvince(comma[2], site);
    }
  }

  if (!city && site.townPattern) {
    const foldedBody = fold(text);
    const townHit = foldedBody.match(site.townPattern);
    const provinceAllows = !province || province === 'Alberta';
    if (townHit && provinceAllows) {
      const found = (site.towns || []).find((town) => fold(town) === townHit[0]);
      if (found) {
        city = found;
        province = province || 'Alberta';
      }
    }
  }

  if (!venue) {
    const venueAlt = (site.venueWords || []).map((word) => escapeRegExp(word)).join('|');
    if (venueAlt) {
      const named = text.match(new RegExp(`\\b([A-Z][A-Za-z'’\\-]*(?:\\s+[A-Z][A-Za-z'’\\-]*){0,4}\\s+(?:${venueAlt}))\\b`, 'i'));
      if (named) venue = oneLine(named[1], 160);
    }
  }

  const hosting = String(body || '').match(/\bhosting (?:an? |our )?(.{3,80}?) on\b/i);
  const named = String(body || '').match(/\b(?:add|list|include) (?:the |our )?([A-Z][^.\n]{3,80}?)(?:\s+on\b|\s+to\b)/);
  const cleanedSubject = cleanSubject(subject);
  const title = oneLine((hosting && hosting[1]) || (named && named[1]) || cleanedSubject, 160);
  const date = text.match(DATE_RE);
  const host = String(body || '').match(/([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,6})\s+is hosting\b/);
  const url = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return {
    title,
    host: host ? host[1].replace(/^The\s+/i, '') : '',
    date: date ? date[1] : '',
    city,
    province,
    venue,
    url: url ? url[0].replace(/[.,);]+$/, '') : '',
  };
}

function cleanSubject(subject) {
  return oneLine(subject, 180)
    .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '')
    .replace(/^(?:test\s*[-:]\s*)+/i, '')
    .replace(/^(?:booking inquiry|booking enquiry|performance inquiry|inquiry)\s*:\s*/i, '')
    .replace(/^(?:please\s+)?(?:list|add|include|submit|remove)\s+(?:our\s+|this\s+|an?\s+|the\s+)?/i, '')
    .replace(/^correction\s*:\s*/i, '')
    .replace(/^(?:pipe bands?|pipers?|bagpipers?|drummers?|highland dancers?|irish dancers?|fiddlers?|ceilidh bands?|celtic bands?)\s+for\s+/i, '');
}

function hasListingAsk(text) {
  return /\b(please (?:list|add|include)|(?:add|list|include) (?:our|the|this)|groups? page|directory)\b/i.test(text);
}

export function analyzeMessage(input, site) {
  const compiled = site.compiledPhrases ? site : compileSite(site);
  const subject = oneLine(input && input.subject, 300);
  const originalBody = String((input && (input.text ?? input.body)) ?? '');
  const stripped = stripBoilerplate(originalBody);
  const scoring = compiled.scoring || { minScore: 3.5, subjectWeight: 2, maxConfidence: 0.93, emptyConfidence: 0.26 };
  const scores = {};
  for (const category of compiled.categories || []) {
    if (category && category !== 'other') scores[category] = 0;
  }
  const roles = new Set();
  const subjectHits = scoreText(compiled.compiledPhrases, subject, scoring.subjectWeight || 2, {}, scores, roles);
  const bodyHits = scoreText(compiled.compiledPhrases, stripped.body, 1, {}, scores, roles);
  scoreText(compiled.compiledPhrases, stripped.footer, 1, { spamOnly: true, collectRoles: false }, scores, roles);
  const head = `${subject}\n${stripped.body.slice(0, 280)}`;
  const automated = phrasePattern(compiled.automatedForms || [])?.test(fold(head)) || false;
  const newsletter = roles.has('newsletter');
  const dated = DATE_RE.test(`${subject}\n${stripped.body}`);
  const directory = !dated
    && hasListingAsk(`${subject}\n${stripped.body}`)
    && phrasePattern(compiled.directoryForms || [])?.test(fold(`${subject}\n${stripped.body}`));
  const signals = {
    automated,
    newsletter: newsletter && (scores.spam || 0) < (scoring.minScore || 3.5),
    directory: Boolean(directory),
    performer: roles.has('performer'),
    eventType: roles.has('event'),
    listing: roles.has('listing'),
    booking: roles.has('booking'),
  };
  let chosen = automated
    ? { category: 'other', best: 0, second: 0 }
    : pickCategory(scores, scoring);
  if (!automated && chosen.category === 'other' && signals.newsletter) {
    chosen = { category: 'other', best: chosen.best, second: chosen.second };
  }
  const hits = subjectHits + bodyHits;
  return {
    category: chosen.category,
    confidence: confidenceFor(chosen.category, chosen.best, chosen.second, hits, scoring, signals),
    event: extractFacts(subject, stripped.body, compiled),
    signals,
    scores,
  };
}
