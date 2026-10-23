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
// Visitors always see destinationEmail from data/booking.json. That public
// routing address is the mailto fallback. The Worker does not send to it.
// The verified destination inbox is the Worker's BOOKING_TO variable, injected
// at deploy from the GitHub secret BOOKING_TO. Do not put that inbox in
// this repo, and do not turn on paid Email Sending for this form.
//
// If the binding is missing or a send fails, the form gives the visitor a
// mailto link to the public routing address so the request can still be
// sent by hand.

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
  const to = BOOKING_TO_DEFAULT;
  return handleBookingRequest(request, { catalog, send: mailerSend(env), to, from: BOOKING_FROM });
}
