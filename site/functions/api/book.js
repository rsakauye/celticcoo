// Performer booking requests. Sends one email, then forgets the submission.
// Nothing is written to the repo, to KV, or to a database.
//
// Delivery goes through the MAILER service binding to the private
// celticcoo-mailer Worker, which holds the send_email binding. Pages itself
// cannot. On the Workers Free plan, Email Service delivers to a verified
// Email Routing destination from a domain that already has Email Routing
// (celticcoo.ca). That path is free: no Workers Paid plan, no API key, no
// new account, and no DNS change.
//
// The destination address defaults to destinationEmail in data/booking.json.
// If Cloudflare rejects that address because it is a routing rule rather than
// a verified destination, set BOOKING_TO in site/wrangler.jsonc to the verified
// inbox the routing address already forwards to, and redeploy. That variable
// overrides the niche file. Do not turn on paid Email Sending for this form.
//
// If the binding is missing or a send fails, the form gives the visitor a
// mailto link to the same address so the request can still be sent by hand.

import { events, tba, TODAY } from '../../src/lib/data.js';
import { bookableFromData, handleBookingRequest, BOOKING_FROM, BOOKING_TO_DEFAULT } from '../../src/lib/booking.js';
import { mailerSend } from '../../src/lib/mailer.js';

const catalog = bookableFromData(events, tba, TODAY);

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'POST', 'cache-control': 'no-store' },
    });
  }
  const to = String((env && env.BOOKING_TO) || BOOKING_TO_DEFAULT).trim() || BOOKING_TO_DEFAULT;
  return handleBookingRequest(request, { catalog, send: mailerSend(env), to, from: BOOKING_FROM });
}
