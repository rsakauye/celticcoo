// Free self-listing for performers and for clubs or lessons groups.
// Same protections as the booking form: same-origin check, honeypot,
// Turnstile (action "listing"), field checks, the intake kill switch, and
// daily caps. A valid listing is stored in the private INTAKE_DB (D1) with
// status pending. Nothing is published here. A person approves each one in
// the moderation queue on the inbound Worker. See docs/listings.md.
//
// No notice email is sent from here and nothing is sent to the submitter.
// The receipt waits on ACK_REPLIES in the inbound Worker, which stays off.

import { handleListingRequest, listingStoreFromEnv, LISTING_TURNSTILE_ACTION } from '../../src/lib/listing.js';
import { verifyFromEnv } from '../../src/lib/intake.js';
import bookingConfig from '../../../data/booking.json' with { type: 'json' };

export async function onRequest(context) {
  const { request, env } = context;
  return handleListingRequest(request, {
    verify: verifyFromEnv(env, LISTING_TURNSTILE_ACTION),
    store: listingStoreFromEnv(env),
    contactEmail: bookingConfig.destinationEmail,
  });
}
