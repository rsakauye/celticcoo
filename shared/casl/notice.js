// CASL identification for outbound mail from The Celtic Coo.
// One copy of the sender facts, reused by the inbound Worker and the site.
// The mailing address is the business post-office box on the site footer,
// privacy page, terms, and about. It is not a home address.
// Do not put a person's name or a private inbox here.

export const SENDER_NAME = 'The Celtic Coo';

export const MAILING_ADDRESS = 'PO Box 1604, Okotoks, AB T1S 1B5, Canada';

export const HOME_URL = 'https://celticcoo.ca';

export const PRIVACY_URL = `${HOME_URL}/privacy/`;

export const CASL_NOTICE = {
  purpose: 'You wrote to The Celtic Coo. This email is a reply about that message.',
  senderId: `${SENDER_NAME} (${HOME_URL})`,
  withdrawConsent: `To stop these emails, reply to this message with only the word unsubscribe. We record that request and will not email you again. Privacy: ${PRIVACY_URL}`,
  mailingAddress: MAILING_ADDRESS,
};

function celticFooter() {
  return [
    CASL_NOTICE.purpose,
    CASL_NOTICE.senderId,
    CASL_NOTICE.withdrawConsent,
    CASL_NOTICE.mailingAddress,
  ].join('\n');
}

// No argument, or this site's own name, uses the single Celtic Coo notice.
// Another site using the booking engine passes its own name and address.
export function caslFooterText(site) {
  const name = site && String(site.name || '').trim();
  if (!name || name === SENDER_NAME) return celticFooter();
  const address = String(site.mailingAddress || '').trim();
  const privacy = String(site.privacyUrl || '').trim();
  const home = String(site.homeUrl || '').trim();
  const lines = [
    `You wrote to ${name}. This email is a reply about that message.`,
    home ? `${name} (${home})` : name,
    privacy
      ? `To stop these emails, reply to this message with only the word unsubscribe. We record that request and will not email you again. Privacy: ${privacy}`
      : 'To stop these emails, reply to this message with only the word unsubscribe. We record that request and will not email you again.',
  ];
  if (address) lines.push(address);
  return lines.join('\n');
}
