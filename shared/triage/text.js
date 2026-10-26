// Small pure string helpers for the triage engine.
// No network, no date libraries, no site copy.

export function oneLine(value, max = 300) {
  const s = String(value ?? '').replace(/[\r\n\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max).trim() : s;
}

// Accents, apostrophes, and periods are folded so "céilidh", "ceilidh",
// and "St. Andrew's" can share one phrase entry.
export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\./g, '')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round3(value) {
  return Math.round(value * 1000) / 1000;
}
