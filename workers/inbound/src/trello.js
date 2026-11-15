// Optional Trello card for an exhibitor invitation marked "interested".
// Steward owns that board. This is a hook: it does nothing unless
// EXHIBITOR_TRELLO is exactly "on" AND the three settings below exist.
//
//   TRELLO_API_KEY   Worker secret (wrangler secret put). Not in git.
//   TRELLO_TOKEN     Worker secret. Not in git.
//   TRELLO_LIST_ID   Deploy var naming Steward's list. Not in git yet.
//
// None of these are set in this repo. The card carries public event facts
// only: no organizer name, email, or phone, and no booth cost, because the
// card is outside the private intake database.

import { codeOf, oneLine } from './text.js';

const TRELLO_CARDS = 'https://api.trello.com/1/cards';

export function trelloConfig(env) {
  if (String(env && env.EXHIBITOR_TRELLO || '').trim().toLowerCase() !== 'on') return null;
  const key = String(env.TRELLO_API_KEY || '').trim();
  const token = String(env.TRELLO_TOKEN || '').trim();
  const list = String(env.TRELLO_LIST_ID || '').trim();
  if (!/^[A-Za-z0-9]{16,128}$/.test(key) || !/^[A-Za-z0-9]{16,256}$/.test(token) || !/^[a-f0-9]{24}$/i.test(list)) return null;
  return { key, token, list };
}

export function cardFor(view, inboundEmailId) {
  const f = (view && view.fields) || {};
  const name = `Vendor call: ${oneLine(f.event_name || 'event', 120)}`;
  const place = [f.city, f.province, f.country].filter(Boolean).join(', ');
  const desc = [
    f.event_dates ? `Dates: ${f.event_dates}` : '',
    place ? `Where: ${place}` : '',
    f.apply_deadline ? `Apply by: ${f.apply_deadline}` : '',
    f.apply_url ? `Application: ${f.apply_url}` : '',
    `Intake row: ${inboundEmailId}`,
    'Details and contact are in the private review queue.',
  ].filter(Boolean).join('\n');
  return { name, desc };
}

export async function createInterestedCard(env, view, inboundEmailId, deps = {}) {
  const config = trelloConfig(env);
  if (!config) return { status: 'skipped', reason: 'trello_not_configured' };
  const fetchImpl = typeof deps.fetch === 'function' ? deps.fetch : fetch;
  const card = cardFor(view, inboundEmailId);
  const url = new URL(TRELLO_CARDS);
  url.searchParams.set('idList', config.list);
  url.searchParams.set('key', config.key);
  url.searchParams.set('token', config.token);
  try {
    const res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ name: card.name, desc: card.desc, pos: 'top' }),
    });
    if (!res || !res.ok) return { status: 'failed', reason: `trello_http_${res ? res.status : 0}` };
    return { status: 'created' };
  } catch (err) {
    console.error(JSON.stringify({ message: 'trello card failed', code: codeOf(err) }));
    return { status: 'failed', reason: 'trello_failed' };
  }
}
