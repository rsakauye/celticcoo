// offers_lessons in the directory is "y", "n", or "unknown". A boolean true is accepted
// for callers that already normalized the field. Only an explicit yes is counted.
// "unknown" is not a yes, and neither is "n", false, or a missing value.
export function offersLessons(value) {
  if (value === true) return true;
  return typeof value === 'string' && value.trim().toLowerCase() === 'y';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Display form of a completed check run. No run yet stays "not yet" so the sentence still reads.
export function formatLastChecked(iso) {
  const match = ISO_DATE.exec(String(iso || ''));
  if (!match) return 'not yet';
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return 'not yet';
  return `${MONTHS[month - 1]} ${day}, ${match[1]}`;
}

export function latestCheckedOn(status) {
  const value = status?.checked_on;
  return typeof value === 'string' && ISO_DATE.test(value) ? value : null;
}

export function clubIntroSentence({ groupCount, lessonCount, lastChecked }) {
  return `Pipe bands, Highland and Scottish country dance, clan societies, Gaelic classes, Burns clubs, heavy events, trad sessions, whisky societies and more: ${groupCount} groups across Canada, ${lessonCount} of them offering lessons. We check every website weekly (last check: ${lastChecked}). Ask the group directly about schedules and fees.`;
}

export function buildClubIntro(groups, status) {
  const list = Array.isArray(groups) ? groups : [];
  const parts = {
    groupCount: list.length,
    lessonCount: list.filter((group) => offersLessons(group?.offers_lessons)).length,
    lastChecked: formatLastChecked(latestCheckedOn(status)),
  };
  return { ...parts, text: clubIntroSentence(parts) };
}
