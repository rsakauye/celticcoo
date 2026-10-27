// Performer booking requests.
// Turnstile is checked first, then the fields. A valid request is stored in
// the private INTAKE_DB (D1) database. A notice is then sent through the
// MAILER service binding to the private celticcoo-mailer Worker, which holds
// the send_email binding. Pages itself cannot. If that notice fails, the
// stored row stays.
//
// Visitors always see destinationEmail from data/booking.json. That public
// routing address is the mailto fallback. The Worker does not send to it.
// The verified destination inbox is the Worker's BOOKING_TO secret, uploaded
// at deploy from the GitHub secret BOOKING_TO. Do not put that inbox in
// this repo. The notice is sent from bookings@celticcoo.ca.
//
// TURNSTILE_SECRET is a Pages secret. It is never read from the repo.
// Rejected attempts are logged as a reason code only. The message body of a
// rejected or spam attempt is not stored.

import { events, tba, TODAY } from '../../src/lib/data.js';
import { bookableFromData, handleBookingRequest, BOOKING_FROM, BOOKING_TO_DEFAULT } from '../../src/lib/booking.js';
import { intakeFromEnv, verifyFromEnv } from '../../src/lib/intake.js';
import { mailerSend } from '../../src/lib/mailer.js';
import celticcoo from '../../../shared/triage/sites/celticcoo.js';

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
  return handleBookingRequest(request, {
    catalog,
    send: mailerSend(env),
    to,
    from: BOOKING_FROM,
    verify: verifyFromEnv(env),
    intake: intakeFromEnv(env),
    countHold: celticcoo.guard.minBurst,
  });
}
