// Server-renders /performers/: takes the static page and fills the list with
// the listed rows from D1, public fields only (the same rows /api/performers
// returns). No database binding: the static empty state is served as is.
// Read failure: the "be the first" card is swapped for a short retry note.

import { listedPerformers } from '../../src/lib/listing.js';
import { renderPerformersPage } from '../../src/lib/performerCards.js';

export async function handlePerformersPage(context) {
  const res = await context.next();
  const type = res.headers.get('content-type') || '';
  if (res.status !== 200 || !type.includes('text/html')) return res;
  const db = context.env && context.env.INTAKE_DB;
  if (!db || typeof db.prepare !== 'function') return res;
  let rows;
  try {
    rows = await listedPerformers(db);
  } catch {
    console.error(JSON.stringify({ message: 'performers page read failed', code: 'read_failed' }));
    rows = null;
  }
  const html = renderPerformersPage(await res.text(), rows, { bookPath: '/book/' });
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('cache-control', rows === null ? 'no-store' : 'public, max-age=300');
  return new Response(context.request.method === 'HEAD' ? null : html, { status: 200, headers });
}

export const onRequestGet = handlePerformersPage;
export const onRequestHead = handlePerformersPage;
