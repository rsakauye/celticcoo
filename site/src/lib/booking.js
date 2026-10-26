// Booking-request engine. Niche words, option lists, and the destination
// address live in data/booking.json. This file validates and sends. When the
// caller passes an intake, it also stores the request in that private
// database. It does not write a submission into the site repo. Pass a config
// object in tests to prove a sister site can reuse the same logic. Without
// an intake, it only sends email.

import bookingConfig from '../../../data/booking.json' with { type: 'json' };
import { assessRisk, intakeStatus } from './intake.js';

export { bookingConfig };

export const BOOKING_TO_DEFAULT = bookingConfig.destinationEmail;
export const BOOKING_FROM = bookingConfig.fromEmail;
export const REQUESTER_TYPES = bookingConfig.requesterTypes;
export const REQUEST_TYPES = bookingConfig.requestTypes;
export const PERFORMERS = bookingConfig.performerTypes;
export const CUSTOM_EVENT_TYPES = bookingConfig.customEventTypes;
export const PROVINCE_NAMES = bookingConfig.regions;

export const BUDGETS = [
  ['under-200', 'Under $200'],
  ['200-500', '$200 to $500'],
  ['500-1000', '$500 to $1,000'],
  ['1000-2500', '$1,000 to $2,500'],
  ['over-2500', 'Over $2,500'],
  ['discuss', 'Prefer to discuss it'],
];

export const MESSAGES = {
  name: 'Enter your name.',
  email: 'Enter an email address we can write back to.',
  phone: 'Enter a phone number with at least 7 digits, or leave it blank.',
  requester_type: 'Tell us who is making the request.',
  request_type: 'Tell us what you need help with.',
  events: 'Pick at least one event on the list, or add your own.',
  events_unknown: 'One of the selected events is not on the calendar. Refresh the page and try again.',
  events_many: 'Please pick 20 events or fewer.',
  custom_type: 'Choose the kind of event, or clear the other event details.',
  custom_name: 'Name the event, or clear the other event details.',
  custom_date: 'Enter a real event date.',
  custom_city: 'Enter the city.',
  custom_province: 'Enter the province or region.',
  custom_venue: 'Please keep the venue under 200 characters.',
  performers: 'Pick at least one kind of performer.',
  performer_other: 'Tell us what the other performer is.',
  message: 'Add a few details so we know what you need.',
  message_long: 'Please keep the details under 4,000 characters.',
  budget: 'Choose a budget range from the list, or leave it blank.',
  guardian_confirm: 'Tick the box to confirm you are the parent or guardian. Requests for anyone under 18 have to come from them.',
  casl: 'Tick the box if we may email you about this request.',
  turnstile: 'Confirm you are a person, then send the request again.',
  turnstile_unavailable: 'We could not verify this request just now. Please try again in a moment, or email us.',
};

const LIMITS = {
  name: 120,
  email: 200,
  phone: 40,
  customName: 160,
  customCity: 80,
  customProvince: 60,
  customVenue: 200,
  performerOther: 160,
  message: 4000,
};

function pairs(list) {
  return Object.fromEntries(list || []);
}

function useConfig(config) {
  return config || bookingConfig;
}

export function fillTemplate(template, vars) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, key) => (vars[key] == null ? '' : String(vars[key])));
}

function oneLine(s) {
  return String(s).replace(/[\r\n\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 2024 || y > 2040) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validEmail(s) {
  return s.length <= LIMITS.email && !/[\r\n]/.test(s) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function validPhone(s) {
  if (!s) return true;
  if (s.length > LIMITS.phone || /[\r\n]/.test(s)) return false;
  if (!/^[0-9+().\-\s]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function bookableFromData(events, tba, today) {
  const list = (events || []).map((e) => ({
    id: e.id,
    sourceId: e.id,
    name: e.name,
    when: e.when,
    city: e.city || '',
    regionLabel: e.regionLabel || '',
    country: e.country || '',
    tba: false,
    past: Boolean(today && e.end_date && e.end_date < today),
    sort: e.start_date || '',
  }));
  const ids = new Set(list.map((e) => e.id));
  for (const t of tba || []) {
    let id = t.id;
    if (ids.has(id)) id = `tba-${id}`;
    ids.add(id);
    list.push({
      id,
      sourceId: t.id,
      name: t.name,
      when: 'Date TBA',
      city: t.city || '',
      regionLabel: t.regionLabel || '',
      country: t.country || 'Canada',
      tba: true,
      past: false,
      sort: '9999-99-99',
    });
  }
  return list;
}

export function readBookingForm(formData) {
  const get = (k) => String(formData.get(k) ?? '');
  const all = (k) => formData.getAll(k).map((v) => String(v).trim()).filter(Boolean);
  const message = get('message').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return {
    name: get('name').trim(),
    email: get('email').trim(),
    phone: get('phone').trim(),
    requesterType: get('requester_type').trim(),
    requestType: get('request_type').trim(),
    eventIds: [...new Set(all('events'))],
    customType: get('custom_type').trim(),
    customName: get('custom_name').trim(),
    customDate: get('custom_date').trim(),
    customCity: get('custom_city').trim(),
    customProvince: get('custom_province').trim(),
    customVenue: get('custom_venue').trim(),
    performers: [...new Set(all('performers'))],
    performerOther: get('performer_other').trim(),
    message,
    budget: get('budget').trim(),
    under18: get('under18').trim() === 'yes',
    guardianConfirm: get('guardian_confirm').trim() === 'yes',
    casl: get('casl').trim() === 'yes',
    honeypot: get('booking_hp').trim(),
  };
}

export function validateBooking(input, catalog, config = bookingConfig) {
  const cfg = useConfig(config);
  const requesterLabel = pairs(cfg.requesterTypes);
  const requestLabel = pairs(cfg.requestTypes);
  const performerLabel = pairs(cfg.performerTypes);
  const eventTypeLabel = pairs(cfg.customEventTypes);
  const budgetLabel = pairs(BUDGETS);
  const performerOrder = (cfg.performerTypes || []).map(([id]) => id);

  if (input.honeypot) return { ok: true, spam: true };
  const errors = {};
  const byId = new Map((catalog || []).map((e) => [e.id, e]));

  if (input.name.length < 2 || input.name.length > LIMITS.name || /[\r\n]/.test(input.name)) errors.name = MESSAGES.name;
  if (!validEmail(input.email)) errors.email = MESSAGES.email;
  if (!validPhone(input.phone)) errors.phone = MESSAGES.phone;
  if (!requesterLabel[input.requesterType]) errors.requester_type = MESSAGES.requester_type;
  if (!requestLabel[input.requestType]) errors.request_type = MESSAGES.request_type;

  const knownEvents = [];
  if (input.eventIds.length > 20) errors.events = MESSAGES.events_many;
  else {
    for (const id of input.eventIds) {
      const event = byId.get(id);
      if (!event) { errors.events = MESSAGES.events_unknown; break; }
      knownEvents.push(event);
    }
  }

  const customBits = [input.customType, input.customName, input.customDate, input.customCity, input.customProvince, input.customVenue];
  const anyCustom = customBits.some(Boolean);
  let custom = null;
  if (anyCustom) {
    if (!eventTypeLabel[input.customType]) errors.custom_type = MESSAGES.custom_type;
    if (input.customName.length < 2 || input.customName.length > LIMITS.customName || /[\r\n]/.test(input.customName)) errors.custom_name = MESSAGES.custom_name;
    if (!validDate(input.customDate)) errors.custom_date = MESSAGES.custom_date;
    if (input.customCity.length < 2 || input.customCity.length > LIMITS.customCity || /[\r\n]/.test(input.customCity)) errors.custom_city = MESSAGES.custom_city;
    if (input.customProvince.length < 2 || input.customProvince.length > LIMITS.customProvince || /[\r\n]/.test(input.customProvince)) errors.custom_province = MESSAGES.custom_province;
    if (input.customVenue.length > LIMITS.customVenue || /[\r\n]/.test(input.customVenue)) errors.custom_venue = MESSAGES.custom_venue;
    if (!errors.custom_type && !errors.custom_name && !errors.custom_date && !errors.custom_city && !errors.custom_province && !errors.custom_venue) {
      custom = {
        type: input.customType,
        name: input.customName,
        date: input.customDate,
        city: input.customCity,
        province: input.customProvince,
        venue: input.customVenue,
      };
    }
  }
  if (!errors.events && knownEvents.length === 0 && !custom && !anyCustom) errors.events = MESSAGES.events;

  const performers = performerOrder.filter((id) => input.performers.includes(id));
  const unknownPerformer = input.performers.some((id) => !performerLabel[id]);
  if (unknownPerformer || performers.length === 0) errors.performers = MESSAGES.performers;
  let performerOther = '';
  if (performers.includes('other')) {
    if (input.performerOther.length < 2 || input.performerOther.length > LIMITS.performerOther || /[\r\n]/.test(input.performerOther)) errors.performer_other = MESSAGES.performer_other;
    else performerOther = input.performerOther;
  }
  if (!input.message || input.message.length < 10) errors.message = MESSAGES.message;
  else if (input.message.length > LIMITS.message) errors.message = MESSAGES.message_long;
  if (input.budget && !budgetLabel[input.budget]) errors.budget = MESSAGES.budget;
  if (input.under18 && !input.guardianConfirm) errors.guardian_confirm = MESSAGES.guardian_confirm;
  if (!input.casl) errors.casl = MESSAGES.casl;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    spam: false,
    value: {
      name: oneLine(input.name),
      email: input.email,
      phone: input.phone,
      requesterType: input.requesterType,
      requestType: input.requestType,
      events: knownEvents,
      custom,
      performers,
      performerOther,
      message: input.message,
      budget: input.budget,
      under18: input.under18,
      guardianConfirm: input.guardianConfirm,
    },
  };
}

function eventLine(e) {
  const place = [e.city, e.regionLabel].filter(Boolean).join(', ');
  return `- ${e.name} (${e.when}${place ? `, ${place}` : ''})`;
}

export function bookingSubject(value, config = bookingConfig) {
  const cfg = useConfig(config);
  const performerLabel = pairs(cfg.performerTypes);
  const kinds = value.performers.filter((id) => id !== 'other').map((id) => performerLabel[id]);
  if (value.performerOther) kinds.push(value.performerOther);
  const kindText = kinds.slice(0, 3).join(', ') || 'Performer';
  const eventName = (value.events[0] && value.events[0].name) || (value.custom && value.custom.name) || '';
  const prefix = cfg.subjectPrefix || 'Booking request';
  let subject = eventName ? `${prefix}: ${kindText} for ${eventName}` : `${prefix}: ${kindText}`;
  subject = oneLine(subject);
  if (subject.length > 140) subject = `${subject.slice(0, 137)}...`;
  return subject;
}

export function bookingText(value, opts = {}) {
  const cfg = useConfig(opts.config);
  const email = cfg.email || {};
  const requesterLabel = pairs(cfg.requesterTypes);
  const requestLabel = pairs(cfg.requestTypes);
  const performerLabel = pairs(cfg.performerTypes);
  const eventTypeLabel = pairs(cfg.customEventTypes);
  const budgetLabel = pairs(BUDGETS);
  const sentFrom = opts.sentFrom || cfg.siteUrl || '';
  const lines = [email.lead || '', ''];
  if (opts.intakeId || opts.status || Array.isArray(opts.riskFlags)) {
    if (opts.intakeId) lines.push(`Intake id: ${oneLine(opts.intakeId)}`);
    if (opts.status) lines.push(`Status: ${oneLine(opts.status)}`);
    if (Array.isArray(opts.riskFlags)) {
      const flags = opts.riskFlags.filter((flag) => /^[a-z0-9_]+$/.test(flag));
      lines.push(`Risk flags: ${flags.length ? flags.join(', ') : 'none'}`);
    }
    lines.push('');
  }
  lines.push(
    email.replyNote || '',
    email.disclosure || '',
    '',
    'Requester',
    `Name: ${value.name}`,
    `Email: ${value.email}`,
    `Phone: ${value.phone || 'not given'}`,
    `Who they are: ${requesterLabel[value.requesterType] || value.requesterType}`,
    '',
    'Request',
    `Type: ${requestLabel[value.requestType] || value.requestType}`,
    `Under 18: ${value.under18 ? 'Yes. The requester confirmed they are the parent or guardian.' : 'No'}`,
    '',
    email.eventsHeading || 'Events on the calendar',
  );
  if (value.events.length) value.events.forEach((e) => lines.push(eventLine(e)));
  else lines.push('- none selected');
  lines.push('', email.ownEventHeading || 'Their own event');
  if (value.custom) {
    lines.push(`Type: ${eventTypeLabel[value.custom.type] || value.custom.type}`);
    lines.push(`Name: ${value.custom.name}`);
    lines.push(`Date: ${value.custom.date}`);
    lines.push(`City: ${value.custom.city}`);
    lines.push(`Province: ${value.custom.province}`);
    lines.push(`Venue: ${value.custom.venue || 'not given'}`);
  } else lines.push('- none');
  lines.push('', email.performersHeading || 'Performers needed');
  value.performers.forEach((id) => {
    lines.push(id === 'other' ? `- Other: ${value.performerOther}` : `- ${performerLabel[id] || id}`);
  });
  lines.push('', `Budget: ${value.budget ? budgetLabel[value.budget] : 'not given'}`);
  lines.push('', 'Details', value.message);
  lines.push('', 'Consent', email.consent || '');
  lines.push(`Sent from: ${sentFrom}`);
  return lines.join('\n');
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function bookingHtml(value, opts) {
  return `<pre style="font:16px/1.5 Georgia,serif;white-space:pre-wrap">${escapeHtml(bookingText(value, opts))}</pre>`;
}

export function bookingMailto(value, to, opts) {
  const subject = bookingSubject(value, opts && opts.config);
  let body = bookingText(value, opts);
  const base = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=`;
  let href = base + encodeURIComponent(body);
  if (href.length > 1800) {
    body = `${body.slice(0, 700)}\n\n(Shortened to fit in an email link. Please add anything that was cut.)`;
    href = base + encodeURIComponent(body);
  }
  return href;
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function htmlResponse(status, config, { title, heading, paragraphs = [], list = [], action }) {
  const home = config.siteName || 'Home';
  const paras = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  const items = list.length ? `<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
  const cta = action ? `<p><a class="btn" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a></p>` : '';
  const html = `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body { margin:0; font:1.0625rem/1.55 system-ui,sans-serif; background:#fbf6ec; color:#2a1d14; }
  .bar { height:10px; background:#1f4d3a; }
  main { max-width:40rem; margin:0 auto; padding:1.5rem 1.1rem 3rem; }
  h1 { font-family:Georgia,serif; color:#1f4d3a; line-height:1.2; }
  a { color:#2f6b52; }
  .btn { display:inline-block; background:#a54e1e; color:#fff; padding:.6rem 1rem; border-radius:10px; text-decoration:none; font-weight:600; }
</style>
</head>
<body>
<div class="bar"></div>
<main>
<h1>${escapeHtml(heading)}</h1>
${paras}
${items}
${cta}
<p><a href="/book/">${escapeHtml((config.responses && config.responses.returnLabel) || 'Return to the form')}</a> · <a href="/">${escapeHtml(home)}</a></p>
</main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function sameOrigin(request) {
  let url;
  try { url = new URL(request.url); } catch { return false; }
  const origin = request.headers.get('origin');
  if (origin) {
    try { return new URL(origin).host === url.host; } catch { return false; }
  }
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  return true;
}

function wantsJson(request) {
  return (request.headers.get('accept') || '').includes('application/json');
}

async function noteFailure(intake, entry) {
  if (!intake || typeof intake.log !== 'function') return;
  try { await intake.log(entry); }
  catch { console.error(JSON.stringify({ message: 'intake failure log threw', reason: 'log_failed' })); }
}

function turnstileMessage(reason) {
  if (reason === 'turnstile_unavailable' || reason === 'turnstile_not_configured') return MESSAGES.turnstile_unavailable;
  return MESSAGES.turnstile;
}

export async function handleBookingRequest(request, deps = {}) {
  const config = useConfig(deps.config);
  const responses = config.responses || {};
  const to = deps.to || config.destinationEmail;
  const from = deps.from || config.fromEmail;
  const { send, catalog, intake } = deps;
  const vars = { siteName: config.siteName, email: to };
  const wants = wantsJson(request);
  if (!sameOrigin(request)) {
    await noteFailure(intake, { reason: 'origin', detail: '' });
    if (wants) return jsonResponse(403, { ok: false, code: 'origin' });
    return htmlResponse(403, config, {
      title: 'Could not send',
      heading: 'That request did not come from this site.',
      paragraphs: [fillTemplate(responses.originParagraph, vars)],
    });
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 200000) {
    await noteFailure(intake, { reason: 'too_large', detail: '' });
    if (wants) return jsonResponse(413, { ok: false, code: 'too_large' });
    return htmlResponse(413, config, { title: 'Could not send', heading: 'That note is too long.', paragraphs: ['Shorten the details and try again.'] });
  }
  let formData;
  try { formData = await request.formData(); }
  catch {
    await noteFailure(intake, { reason: 'unreadable', detail: '' });
    if (wants) return jsonResponse(400, { ok: false, errors: { message: MESSAGES.message } });
    return htmlResponse(400, config, { title: 'Could not send', heading: 'We could not read that form.', paragraphs: ['Go back to the form and try again.'] });
  }
  const input = readBookingForm(formData);
  if (input.honeypot) {
    await noteFailure(intake, { reason: 'honeypot', detail: '' });
    if (wants) return jsonResponse(200, { ok: true });
    return htmlResponse(200, config, {
      title: fillTemplate(responses.sentTitle, vars),
      heading: responses.thanksHeading,
      paragraphs: responses.thanksSpam || [],
    });
  }
  let turnstile = 'unavailable';
  if (typeof deps.verify === 'function') {
    const token = String(formData.get('cf-turnstile-response') ?? '');
    let verdict;
    try { verdict = await deps.verify(token, request); }
    catch { verdict = { ok: false, reason: 'turnstile_unavailable', detail: '' }; }
    if (!verdict || verdict.ok !== true) {
      const reason = (verdict && verdict.reason) || 'turnstile_rejected';
      await noteFailure(intake, { reason, detail: (verdict && verdict.detail) || '' });
      const message = turnstileMessage(reason);
      if (wants) return jsonResponse(403, { ok: false, code: reason, errors: { turnstile: message } });
      return htmlResponse(403, config, {
        title: responses.turnstileTitle || 'Check the form',
        heading: responses.turnstileHeading || 'We could not verify that request.',
        paragraphs: [message],
      });
    }
    turnstile = 'pass';
  }
  const result = validateBooking(input, catalog, config);
  if (!result.ok) {
    const fields = Object.keys(result.errors).sort().join(',');
    const reason = result.errors.guardian_confirm ? 'minor_no_guardian' : 'validation';
    await noteFailure(intake, { reason, detail: fields });
    if (wants) return jsonResponse(400, { ok: false, errors: result.errors });
    return htmlResponse(400, config, {
      title: 'Check the form',
      heading: 'A few things still need a look.',
      paragraphs: ['Your browser\'s back button should keep what you typed.'],
      list: Object.values(result.errors),
    });
  }
  const sentFrom = (() => { try { return new URL(request.url).origin; } catch { return config.siteUrl || ''; } })();
  const flags = intake ? assessRisk(result.value) : null;
  const status = flags ? intakeStatus(flags) : '';
  let intakeId = '';
  let stored = false;
  if (intake) {
    intakeId = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await intake.save({
        id: intakeId,
        createdAt: now,
        updatedAt: now,
        status,
        flags,
        value: result.value,
        source: 'book',
        turnstile,
      });
      stored = true;
    } catch (err) {
      const detail = err && err.code === 'not_configured' ? 'not_configured' : 'insert_failed';
      await noteFailure(intake, { reason: 'store_failed', detail });
      intakeId = '';
    }
  }
  const textOpts = { sentFrom, config };
  if (flags) {
    textOpts.riskFlags = flags;
    textOpts.status = status;
    if (stored && intakeId) textOpts.intakeId = intakeId;
  }
  const payload = {
    to,
    from: { email: from, name: config.fromName || config.siteName },
    replyTo: { email: result.value.email, name: result.value.name },
    subject: bookingSubject(result.value, config),
    text: bookingText(result.value, textOpts),
    html: bookingHtml(result.value, textOpts),
  };
  const notify = async () => {
    if (typeof send !== 'function') return 'skipped';
    try {
      await send(payload);
      return 'sent';
    } catch (err) {
      const code = err && err.code ? String(err.code).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : 'email_failed';
      console.error(JSON.stringify({ message: 'booking notice failed', code }));
      return 'failed';
    }
  };
  const sentParagraphs = (responses.thanksSent || []).map((p) => fillTemplate(p, vars));
  const storedParagraphs = (responses.thanksStored || responses.thanksSent || []).map((p) => fillTemplate(p, vars));
  const thanks = (paragraphs) => htmlResponse(200, config, {
    title: fillTemplate(responses.sentTitle, vars),
    heading: responses.thanksHeading,
    paragraphs,
  });
  const fallback = (code) => {
    const mailto = bookingMailto(result.value, to, textOpts);
    const missing = code === 'email_not_configured';
    const paragraphs = ((missing ? responses.fallbackMissing : responses.fallbackFailed) || []).map((p) => fillTemplate(p, vars));
    if (wants) return jsonResponse(503, { ok: false, code, mailto });
    return htmlResponse(503, config, {
      title: responses.fallbackTitle,
      heading: responses.fallbackHeading,
      paragraphs,
      action: { href: mailto, label: responses.openEmailLabel || 'Open the email' },
    });
  };

  if (intake) {
    const emailStatus = await notify();
    if (stored) {
      try { await intake.markEmail(intakeId, emailStatus); }
      catch { await noteFailure(intake, { reason: 'email_status_update_failed', detail: emailStatus }); }
      console.log(JSON.stringify({ message: 'intake stored', status, flags, emailStatus }));
      if (wants) return jsonResponse(200, { ok: true, stored: true, email: emailStatus });
      return thanks(emailStatus === 'sent' ? sentParagraphs : storedParagraphs);
    }
    if (emailStatus === 'sent') {
      if (wants) return jsonResponse(200, { ok: true, stored: false, email: 'sent' });
      return thanks(sentParagraphs);
    }
    return fallback(emailStatus === 'skipped' ? 'email_not_configured' : 'email_failed');
  }

  if (typeof send !== 'function') {
    console.error(JSON.stringify({ message: 'booking notice skipped', code: 'email_not_configured' }));
    return fallback('email_not_configured');
  }
  const emailStatus = await notify();
  if (emailStatus !== 'sent') return fallback('email_failed');
  if (wants) return jsonResponse(200, { ok: true });
  return thanks(sentParagraphs);
}
