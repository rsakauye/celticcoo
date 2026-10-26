// Advisory trust score. The result never authorizes a send.
// autoSend is always false. A site pack supplies the weights.

function clamp(score) {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function capAdd(total, delta, cap) {
  if (!delta) return { total, applied: 0 };
  if (delta > 0) {
    const applied = Math.min(delta, Math.max(0, cap));
    return { total: total + applied, applied };
  }
  const applied = Math.max(delta, cap);
  return { total: total + applied, applied };
}

function authDelta(value, weights) {
  if (value === 'pass') return weights.authPass;
  if (value === 'fail') return weights.authFail;
  if (value === 'softfail') return weights.authSoftfail;
  if (value === 'temperror' || value === 'permerror') return weights.authTemp;
  if (value === 'neutral' || value === 'unknown') return weights.authNone;
  return weights.authNone;
}

function classifierSource(classifier) {
  const source = classifier && classifier.source;
  if (source === 'ai' || source === 'rules' || source === 'ai_failed') return source;
  return 'ai_failed';
}

export function scoreTrust(signals, config) {
  const input = signals || {};
  const weights = config && config.weights;
  if (!weights || typeof config.baseline !== 'number') {
    throw Object.assign(new Error('trust config is incomplete'), { code: 'trust_config' });
  }
  const reasons = [];
  let score = config.baseline;
  const note = (code, delta) => {
    reasons.push({ code, delta: delta || 0 });
    score += delta || 0;
  };

  const channel = input.channel === 'form' ? 'form' : 'email';
  let action = 'unavailable';
  let failClosed = false;
  if (channel === 'form') note('channel_form', 0);
  else {
    const email = scoreEmail(input, config, weights, note);
    action = email.action;
    failClosed = email.failClosed;
  }

  const details = applyDetails(input, weights, note);
  applyTurnstile(input.turnstile, weights, note);
  if (failClosed) score = Math.min(score, config.failClosedScore);
  if (channel === 'email' && action === 'pause') score = Math.min(score, config.pauseCap);

  return {
    score: clamp(score),
    reasons,
    missingFields: details.missingFields,
    redFlags: details.redFlags,
    autoSend: false,
  };
}

function scoreEmail(input, config, weights, note) {
  const auth = input.auth || {};
  for (const method of ['spf', 'dkim', 'dmarc']) {
    const value = auth[method] || 'none';
    note(`${method}_${value}`, authDelta(value, weights));
  }

  const history = input.history || {};
  if (history.unavailable) {
    note('history_unavailable', 0);
  } else {
    const approved = Math.max(0, Number(history.priorApproved) || 0);
    const denied = Math.max(0, Number(history.priorDenied) || 0);
    const prior = Math.max(0, Number(history.priorEmails) || 0);
    if (approved) {
      const gained = capAdd(0, approved * weights.priorApproved, weights.priorApprovedCap);
      note('history_approved', gained.applied);
    }
    if (denied) {
      const lost = capAdd(0, denied * weights.priorDenied, weights.priorDeniedCap);
      note('history_denied', lost.applied);
    }
    if (prior > 0 && !denied) note('history_known', weights.knownSender);
    if (prior === 0 && !approved && !denied) note('history_new', 0);
  }

  const source = classifierSource(input.classifier);
  const confidence = Number(input.classifier && input.classifier.confidence);
  const category = String(input.classifier && input.classifier.category || '');
  if (source === 'ai_failed') note('classifier_ai_failed', weights.classifierAiFailed);
  else note(`classifier_${source}`, 0);
  if (source === 'ai' && confidence >= config.highConfidence && category !== 'spam') {
    note('classifier_ai_high', weights.classifierAiHigh);
  } else if (source === 'rules' && confidence >= config.clearConfidence && category !== 'spam') {
    note('classifier_rules_clear', weights.classifierRulesClear);
  }
  if (Number.isFinite(confidence) && confidence < config.lowConfidence) {
    note('classifier_low_confidence', weights.classifierLowConfidence);
  }
  if (category === 'spam') note('category_spam', weights.categorySpam);

  const lexicon = input.lexicon || {};
  const legitimate = capAdd(0, (Number(lexicon.legitimate) || 0) * weights.lexiconLegitimate, weights.lexiconLegitimateCap);
  if (legitimate.applied) note('lexicon_legitimate', legitimate.applied);
  const spamHits = capAdd(0, (Number(lexicon.spam) || 0) * weights.lexiconSpam, weights.lexiconSpamCap);
  if (spamHits.applied) note('lexicon_spam', spamHits.applied);
  const injectionHits = capAdd(0, (Number(lexicon.injection) || 0) * weights.lexiconInjection, weights.lexiconInjectionCap);
  if (injectionHits.applied) note('lexicon_injection', injectionHits.applied);

  const guard = input.guard || {};
  const action = guard.action || 'unavailable';
  if (action === 'pause') note('guard_paused', 0);
  else if (action === 'hold') note('guard_held', weights.guardHeld);
  else if (action === 'allow') note('guard_allow', 0);
  else note('guard_unavailable', 0);

  const recent = Math.max(0, Number(history.recentEmails) || 0);
  const holdAt = config.bulk && config.bulk.holdAt > 0 ? config.bulk.holdAt : 5;
  const holds = input.holds || {};
  const inSeason = Boolean(input.season && input.season.id);
  const bulk = holds.bulk == null ? recent >= holdAt : Boolean(holds.bulk);
  const seasonalHold = holds.seasonal == null ? inSeason && recent >= holdAt : Boolean(holds.seasonal);
  if (inSeason) note('seasonal_window', 0);
  if (bulk) note('bulk_hold', weights.bulkHold);
  if (seasonalHold) note('seasonal_hold', weights.seasonalHold);

  const ai = input.aiCheck || {};
  let failClosed = false;
  if (ai.status !== 'ok') {
    note('ai_check_failed', 0);
    failClosed = true;
  } else {
    if (ai.spam) note('ai_spam', weights.aiSpam);
    if (ai.phishing) note('ai_phishing', weights.aiPhishing);
    if (ai.promptInjection) note('ai_prompt_injection', weights.aiInjection);
    if (!ai.spam && !ai.phishing && !ai.promptInjection) note('ai_clear', weights.aiClean);
  }

  return { action, failClosed };
}

const FIELD_ORDER = ['date', 'time', 'venue', 'booking', 'event'];
const FLAG_KEYS = ['minor_mentioned', 'links_present', 'payment_request', 'bot_instruction_attempt'];

function listedFields(value) {
  const present = Array.isArray(value) ? value : [];
  return FIELD_ORDER.filter((field) => present.includes(field));
}

function listedFlags(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    minor_mentioned: Boolean(source.minor_mentioned),
    links_present: Boolean(source.links_present),
    payment_request: Boolean(source.payment_request),
    bot_instruction_attempt: Boolean(source.bot_instruction_attempt),
  };
}

function applyDetails(input, weights, note) {
  const eachField = Number.isFinite(weights.missingField) ? weights.missingField : -3;
  const fieldCap = Number.isFinite(weights.missingFieldCap) ? Math.abs(weights.missingFieldCap) : 12;
  const missingFields = listedFields(input.missingFields);
  let used = 0;
  for (const field of missingFields) {
    const room = Math.max(0, fieldCap - used);
    const applied = eachField < 0 ? Math.max(eachField, -room) : Math.min(eachField, room);
    note(`missing_${field}`, applied);
    used += Math.abs(applied);
  }
  const eachFlag = Number.isFinite(weights.redFlag) ? weights.redFlag : -6;
  const redFlags = listedFlags(input.redFlags);
  for (const key of FLAG_KEYS) {
    if (redFlags[key]) note(`red_${key}`, eachFlag);
  }
  return { missingFields, redFlags };
}

function applyTurnstile(value, weights, note) {
  if (value === 'pass') note('turnstile_pass', Number.isFinite(weights.turnstilePass) ? weights.turnstilePass : 4);
  else if (value === 'fail') note('turnstile_fail', Number.isFinite(weights.turnstileFail) ? weights.turnstileFail : -20);
  else if (value === 'unavailable') {
    note('turnstile_unavailable', Number.isFinite(weights.turnstileUnavailable) ? weights.turnstileUnavailable : -6);
  }
}

