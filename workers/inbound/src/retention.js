// Daily retention check for the private intake database.
// Dry-run unless RETENTION_PURGE is exactly "on". A dry run only logs counts.
// It does not print row contents. Do not point a manual run at production.

export function monthsAgo(now, months) {
  const date = new Date(now.getTime());
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString();
}

export function daysAgo(now, days) {
  const date = new Date(now.getTime());
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

export function purgeEnabled(env) {
  return String(env && env.RETENTION_PURGE || '').trim() === 'on';
}

async function countOf(db, sql, cutoff) {
  const row = await db.prepare(sql).bind(cutoff).first();
  const value = row && (row.n ?? row['COUNT(*)']);
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

export async function runRetention(db, env, now = new Date(), log = console.log) {
  if (!db || typeof db.prepare !== 'function') {
    log(JSON.stringify({ message: 'retention', mode: 'skipped', code: 'no_database' }));
    return { mode: 'skipped', counts: {} };
  }
  const mode = purgeEnabled(env) ? 'delete' : 'dry_run';
  const bookingCutoff = monthsAgo(now, 12);
  const emailCutoff = monthsAgo(now, 12);
  const failureCutoff = daysAgo(now, 90);
  let counts;
  try {
    counts = {
      submissions: await countOf(db, 'SELECT COUNT(*) AS n FROM submissions WHERE updated_at < ?', bookingCutoff),
      inbound_emails: await countOf(db, 'SELECT COUNT(*) AS n FROM inbound_emails WHERE created_at < ?', emailCutoff),
      submission_failures: await countOf(db, 'SELECT COUNT(*) AS n FROM submission_failures WHERE created_at < ?', failureCutoff),
    };
  } catch {
    log(JSON.stringify({ message: 'retention failed', code: 'retention_failed', mode }));
    return { mode, error: 'retention_failed', counts: {} };
  }
  if (mode === 'delete') {
    try {
      await db.prepare('DELETE FROM submissions WHERE updated_at < ?').bind(bookingCutoff).run();
      await db.prepare('DELETE FROM inbound_emails WHERE created_at < ?').bind(emailCutoff).run();
      await db.prepare('DELETE FROM submission_failures WHERE created_at < ?').bind(failureCutoff).run();
    } catch {
      log(JSON.stringify({ message: 'retention failed', code: 'retention_failed', mode }));
      return { mode, error: 'retention_failed', counts };
    }
  }
  log(JSON.stringify({
    message: 'retention',
    mode,
    submissions: counts.submissions,
    inbound_emails: counts.inbound_emails,
    submission_failures: counts.submission_failures,
  }));
  return { mode, counts };
}
