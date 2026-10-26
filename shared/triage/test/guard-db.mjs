// In-memory stand-in for the intake_control queries. Not a database.

function tagOf(sql) {
  const match = String(sql || '').match(/q:([a-z0-9_]+)/);
  return match ? match[1] : '';
}

function blankControl() {
  return {
    id: 'singleton',
    manual_pause: 0,
    latch: '',
    pause_reason: '',
    paused_until: '',
    alerted_at: '',
    outbound_day: '',
    outbound_count: 0,
    limit_per_day: 0,
    limit_source: '',
    limit_season: '',
    limit_computed_at: '',
    updated_at: '',
  };
}

export function createGuardDb() {
  const state = {
    control: blankControl(),
    submissions: [],
    inbound: [],
    failures: [],
    missingIp: false,
    missingAuth: false,
  };
  function since(rows, arg) {
    return rows.filter((row) => String(row.created_at || '') >= String(arg || ''));
  }
  function count(rows) {
    return { n: rows.length };
  }
  const api = {
    state,
    prepare(sql) {
      const tag = tagOf(sql);
      return {
        bind(...args) {
          return {
            async first() {
              if (tag === 'read') return state.control ? { ...state.control } : null;
              if (tag === 'count_sub') return count(since(state.submissions, args[0]));
              if (tag === 'count_in') return count(since(state.inbound, args[0]));
              if (tag === 'count_sender_sub') {
                return count(since(state.submissions, args[0]).filter((row) => row.email === args[1]));
              }
              if (tag === 'count_sender_in') {
                return count(since(state.inbound, args[0]).filter((row) => row.envelope_from === args[1]));
              }
              if (tag === 'count_ip') {
                if (state.missingIp) throw new Error('no such column');
                return count(since(state.submissions, args[0]).filter((row) => row.client_hash === args[1]));
              }
              if (tag === 'count_turnstile') {
                return count(since(state.failures, args[0]).filter((row) => String(row.reason || '').startsWith('turnstile')));
              }
              throw new Error(`unexpected first ${tag}`);
            },
            async all() {
              if (tag === 'recent_sub') return { results: since(state.submissions, args[0]).slice(-30).reverse() };
              if (tag === 'recent_in') {
                if (state.missingAuth) throw new Error('no such column');
                return { results: since(state.inbound, args[0]).slice(-30).reverse() };
              }
              if (tag === 'recent_in_plain') return { results: since(state.inbound, args[0]).slice(-30).reverse() };
              if (tag === 'history_sub') {
                return { results: groupDays(since(state.submissions, args[0])) };
              }
              if (tag === 'history_in') return { results: groupDays(since(state.inbound, args[0])) };
              throw new Error(`unexpected all ${tag}`);
            },
            async run() {
              const before = state.control ? state.control.alerted_at : '';
              if (tag === 'save_limit' && state.control) {
                state.control.limit_per_day = args[0];
                state.control.limit_source = args[1];
                state.control.limit_season = args[2];
                state.control.limit_computed_at = args[3];
                state.control.updated_at = args[4];
                return { meta: { changes: 1 } };
              }
              if (tag === 'latch' && state.control && state.control.manual_pause === 0 && state.control.latch === '') {
                state.control.latch = 'severe';
                state.control.pause_reason = args[0];
                state.control.updated_at = args[1];
                return { meta: { changes: 1 } };
              }
              if (tag === 'latch') return { meta: { changes: 0 } };
              if (tag === 'alert' && state.control) {
                const next = args[0];
                const cutoff = args[1];
                if (state.control.alerted_at === '' || state.control.alerted_at < cutoff) {
                  state.control.alerted_at = next;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0, before } };
              }
              if (tag === 'pause_on' && state.control) {
                state.control.manual_pause = 1;
                state.control.latch = 'manual';
                state.control.pause_reason = 'manual';
                state.control.paused_until = '';
                state.control.updated_at = args[0];
                return { meta: { changes: 1 } };
              }
              if (tag === 'pause_off' && state.control) {
                state.control.manual_pause = 0;
                state.control.latch = '';
                state.control.pause_reason = '';
                state.control.paused_until = '';
                state.control.updated_at = args[0];
                return { meta: { changes: 1 } };
              }
              if (tag === 'outbound' && state.control) {
                state.control.outbound_day = args[0];
                state.control.outbound_count = args[1];
                state.control.updated_at = args[2];
                return { meta: { changes: 1 } };
              }
              throw new Error(`unexpected run ${tag}`);
            },
          };
        },
      };
    },
  };
  return api;
}

function groupDays(rows) {
  const days = new Map();
  for (const row of rows) {
    const day = String(row.created_at || '').slice(0, 10);
    days.set(day, (days.get(day) || 0) + 1);
  }
  return [...days.entries()].map(([day, n]) => ({ day, n }));
}
