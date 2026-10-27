// Site-wide settings. Everything optional is read from build-time env (repo variables in GitHub Actions).
export const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
export const u = (p = '') => BASE + String(p).replace(/^\//, '');

export const SITE_NAME = 'The Celtic Coo';
export const DOMAIN = 'CelticCoo.ca';

// Kit (ConvertKit) newsletter form "Coo's Letter signup" (uid 1f0438000b). Default 10068901;
// override with repo variable KIT_FORM_ID (PUBLIC_KIT_FORM_ID), or set it to "off" to hide sign-up.
const kitId = (import.meta.env.PUBLIC_KIT_FORM_ID || '').trim() || '10068901';
export const KIT_FORM_ID = /^\d+$/.test(kitId) ? kitId : '';
export const kitAction = KIT_FORM_ID ? `https://app.kit.com/forms/${KIT_FORM_ID}/subscriptions` : '';

// Custom field keys for the event-reminder opt-in. Kit derives each key from the field label
// ("Event reminders" → event_reminders). The public form can send fields[key] with no API key.
// Values are stored only after those fields exist on the Kit account. See the form component.
export const KIT_REMINDER_FIELDS = {
  interest: 'event_reminders',
  event: 'reminder_event',
  region: 'reminder_region',
};

// Contact inbox (forwards via Cloudflare Email Routing).
// Override with repo variable CONTACT_EMAIL (PUBLIC_CONTACT_EMAIL).
export const CONTACT_EMAIL = (import.meta.env.PUBLIC_CONTACT_EMAIL || '').trim() || 'hello@celticcoo.ca';
// Business mailing address (CASL sender identification; also shown on privacy, terms and about).
// The string lives in shared/casl/notice.js so outbound mail uses the same post-office box.
export { MAILING_ADDRESS } from '../../../shared/casl/notice.js';
// TODO: optional hosted form (Google Form, Tally, etc.). When set, the Submit page links to it instead of email.
export const SUBMIT_FORM_URL = (import.meta.env.PUBLIC_SUBMIT_FORM_URL || '').trim();
