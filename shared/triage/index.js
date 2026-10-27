// Site-agnostic triage: phrase scoring, place and date extraction,
// and the hold/pause decision used when traffic spikes.
// Pass a site pack from ./sites/. Do not import a site from here.

export { fold, oneLine } from './text.js';
export {
  DATE_RE,
  analyzeMessage,
  compileSite,
  extractFacts,
  matchProvince,
  stripBoilerplate,
} from './engine.js';
export { adaptiveLimit, assessBurst, decideGuard, decidePerformerVolume, looksGibberish, seasonFor } from './breaker.js';

// analyzeMessage is the entry the classifiers call.
// decideGuard is the entry the cutoff calls.
