// CASL template hooks. These are placeholders, not final wording.
// Hemingway replaces them after Warden review.
// Do not put a mailing address, a person's name, or an inbox address here.

export const CASL_TODO = {
  purpose: 'TODO: CASL purpose',
  senderId: 'TODO: CASL sender identification',
  withdrawConsent: 'TODO: CASL withdraw-consent line',
  mailingAddress: 'TODO: CASL mailing address',
};

export function caslFooterText() {
  return [
    CASL_TODO.purpose,
    CASL_TODO.senderId,
    CASL_TODO.withdrawConsent,
    CASL_TODO.mailingAddress,
  ].join('\n');
}
