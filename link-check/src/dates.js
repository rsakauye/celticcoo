const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// "Oct 27, 2026". Invalid or missing dates stay blank so a caller can say the check has not run.
export function formatDisplayDate(iso) {
  const match = ISO_DATE.exec(String(iso || ''));
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${MONTHS[month - 1]} ${day}, ${match[1]}`;
}

export function isoDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  if (!year || !month || !day) throw new Error(`Could not format a date in ${timeZone}`);
  return `${year}-${month}-${day}`;
}
