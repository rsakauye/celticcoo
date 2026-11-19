// Server-side cards for /performers.
// The page HTML is static. functions/performers/index.js reads the listed rows
// from D1 on each (cached) request and fills the marked slots in that HTML, so
// visitors get the real list in the first response instead of a loading line.
// Everything a performer typed is escaped here. Links are http(s) only and get
// rel="nofollow ugc noopener".

import { listingConfig, COPY } from './listing.js';

const C = COPY.performersPage;

export const PERFORMER_LABELS = {
  acts: Object.fromEntries(listingConfig.performer.acts),
  sizes: Object.fromEntries(listingConfig.performer.sizes),
  travel: Object.fromEntries(listingConfig.performer.travel),
  services: Object.fromEntries(listingConfig.performer.services),
  provinces: Object.fromEntries(listingConfig.provinces),
};

// Slots in src/pages/performers/index.astro. Keep these in sync with the page.
export const SLOTS = {
  list: '<!--pf:list-->',
  count: '<!--pf:count-->',
  emptyOpen: '<div class="card" id="pf-empty">',
  statusOpen: '<p class="card" id="pf-status" role="status" hidden>',
  off: ' disabled data-pf-off',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function safeHref(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function hostOf(href) {
  try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return href; }
}

export function countText(n) {
  return `${n} ${n === 1 ? 'performer' : 'performers'}`;
}

function link(href, text) {
  return `<a href="${escapeHtml(href)}" rel="nofollow ugc noopener" target="_blank">${escapeHtml(text)}</a>`;
}

export function performerCardHtml(p, { bookPath = '/book/' } = {}) {
  const L = PERFORMER_LABELS;
  const acts = (p.acts || []).filter((id) => L.acts[id]);
  const pills = acts.map((id) => `<span class="pill green">${escapeHtml(L.acts[id])}</span>`);
  if (L.sizes[p.size]) pills.push(`<span class="pill">${escapeHtml(L.sizes[p.size])}</span>`);
  const where = [p.city, L.provinces[p.province] || p.province].filter(Boolean).join(', ');
  const facts = [
    [C.travelLabel, L.travel[p.travel] || ''],
    [C.servicesLabel, (p.services || []).map((id) => L.services[id]).filter(Boolean).join(', ')],
    [C.associationLabel, p.association || ''],
  ].filter(([, v]) => v);
  const links = (p.links || []).map(safeHref).filter(Boolean).map((href) => link(href, `${hostOf(href)} ↗`));
  const media = safeHref(p.media);
  if (media) links.push(link(media, `${C.mediaLabel} ↗`));
  const email = p.email && /^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/.test(p.email) ? p.email : '';
  const ask = `${bookPath}?act=${encodeURIComponent(p.name || '')}`;
  return [
    `<article class="card pf" data-acts="${escapeHtml(acts.join(' '))}" data-prov="${escapeHtml(p.province || '')}">`,
    `<div class="pills">${pills.join('')}</div>`,
    `<h2 class="pf-name">${escapeHtml(p.name || '')}</h2>`,
    where ? `<div class="muted">📍 ${escapeHtml(where)}</div>` : '',
    p.blurb ? `<p class="pf-blurb">${escapeHtml(p.blurb)}</p>` : '',
    facts.length ? `<dl class="pf-facts">${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` : '',
    links.length ? `<p class="pf-links">${links.join(' · ')}</p>` : '',
    `<p class="pf-actions"><a class="btn small" href="${escapeHtml(ask)}">${escapeHtml(C.askLabel)}</a>`,
    email ? ` <a class="btn ghost small" href="mailto:${escapeHtml(email)}">${escapeHtml(C.emailLabel)}</a>` : '',
    '</p></article>',
  ].join('');
}

// Fill the static page with rows. rows === null means the read failed: keep
// the list empty, hide the "be the first" card, and show the retry note.
export function renderPerformersPage(html, rows, opts = {}) {
  if (rows === null) {
    return html
      .replace(SLOTS.emptyOpen, SLOTS.emptyOpen.replace('>', ' hidden>'))
      .replace(SLOTS.statusOpen, SLOTS.statusOpen.replace(' hidden>', '>'));
  }
  if (!rows.length) return html;
  const cards = rows.map((p) => performerCardHtml(p, opts)).join('');
  return html
    .replace(SLOTS.list, cards)
    .replace(SLOTS.count, escapeHtml(countText(rows.length)))
    .replace(SLOTS.emptyOpen, SLOTS.emptyOpen.replace('>', ' hidden>'))
    .split(SLOTS.off).join('');
}
