import { events } from '../../lib/data.js';
import { eventSchedule, renderEventIcs } from '../../lib/calendar.js';

export function getStaticPaths() {
  return events.filter((e) => eventSchedule(e)).map((e) => ({ params: { id: e.id }, props: { e } }));
}

export function GET(context) {
  const site = new URL(import.meta.env.BASE_URL, context.site).href;
  const body = renderEventIcs(context.props.e, { site });
  if (!body) return new Response('Not found', { status: 404 });
  const filename = `${String(context.props.e.id).replace(/[^a-z0-9-]+/gi, '')}.ics`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  });
}
