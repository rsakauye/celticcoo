// Site-agnostic trust score. Import a site pack from ./sites/ in the app.
// Do not import a site from this file.

export { countLexiconHits, localMonthDay, parseAuthenticationResults, seasonFor } from './signals.js';
export { scoreTrust } from './score.js';
export {
  bookingSignal,
  detectRedFlags,
  emailMissingFields,
  emptyRedFlags,
  formMissingFields,
} from './details.js';
export { TRUST_CHECK_SCHEMA, TRUST_CHECK_SYSTEM, parseTrustCheck } from './check.js';
