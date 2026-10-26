// Trust pack for The Celtic Coo. The scorer reads this and does not
// hard-code the site. Copy this file for another site and replace the
// weights, seasons, and phrase groups.
//
// Season dates match the intake guard pack when that pack is in the tree.
// Keep the two lists together if you change a season.

const celticcooTrust = {
  id: 'celticcoo',
  timeZone: 'America/Edmonton',
  baseline: 50,
  failClosedScore: 20,
  pauseCap: 10,
  highConfidence: 0.75,
  clearConfidence: 0.6,
  lowConfidence: 0.4,
  bulk: { windowHours: 24, holdAt: 5 },
  weights: {
    authPass: 8,
    authFail: -18,
    authSoftfail: -12,
    authTemp: -6,
    authNone: -4,
    priorApproved: 6,
    priorApprovedCap: 18,
    priorDenied: -12,
    priorDeniedCap: -36,
    knownSender: 4,
    classifierAiHigh: 8,
    classifierRulesClear: 4,
    classifierAiFailed: -10,
    classifierLowConfidence: -8,
    categorySpam: -25,
    aiClean: 6,
    aiSpam: -20,
    aiPhishing: -30,
    aiInjection: -25,
    lexiconLegitimate: 2,
    lexiconLegitimateCap: 8,
    lexiconSpam: -8,
    lexiconSpamCap: -24,
    lexiconInjection: -10,
    lexiconInjectionCap: -20,
    guardHeld: -15,
    bulkHold: -8,
    seasonalHold: -5,
    missingField: -3,
    missingFieldCap: -12,
    redFlag: -6,
    turnstilePass: 4,
    turnstileFail: -20,
    turnstileUnavailable: -6,
  },
  seasons: [
    { id: 'hogmanay', multiplier: 3, start: [12, 27], end: [1, 4] },
    { id: 'burns', multiplier: 4, start: [1, 10], end: [1, 31] },
    { id: 'games', multiplier: 3, start: [4, 1], end: [8, 31] },
    { id: 'andrews', multiplier: 3, start: [11, 15], end: [11, 30] },
  ],
  lexicon: {
    legitimate: [
      'highland games',
      'ceilidh',
      'burns supper',
      'burns night',
      'pipe band',
      'piper',
      'booking inquiry',
      'event listing',
    ],
    spam: [
      'seo services',
      'guest post',
      'crypto airdrop',
      'wire transfer',
      'buy now',
    ],
    injection: [
      'ignore previous instructions',
      'ignore all previous',
      'disregard your instructions',
      'you are now',
      'system prompt',
    ],
  },
};

export default celticcooTrust;
