import { events } from '../lib/data.js';
import { renderFeed } from '../lib/calendar.js';

// iCalendar feed of confirmed events. All-day and timed rows share site/src/lib/calendar.js
// with the per-event .ics files, Google Calendar links, and Outlook links.
export function GET(context) {
  const site = new URL(import.meta.env.BASE_URL, context.site).href;
  return new Response(renderFeed(events, { site }), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
}
