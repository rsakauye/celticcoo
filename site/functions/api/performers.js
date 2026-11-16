// Public list for /performers. Listed rows only, public fields only.
// The submitter's name, email, and role never leave the database. A booking
// email is included only when the performer ticked the box to show it.

import { handlePerformersRequest } from '../../src/lib/listing.js';

export async function onRequest(context) {
  return handlePerformersRequest(context.request, context.env);
}
