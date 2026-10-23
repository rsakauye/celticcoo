// Calls the private celticcoo-mailer Worker through the Pages MAILER binding.
// A missing binding returns null so the form can fall back to a mailto link.
// A failed send throws, and the form falls back the same way.

export async function sendViaMailer(mailer, message) {
  const res = await mailer.fetch('https://celticcoo-mailer/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    let code = 'email_failed';
    try {
      const data = await res.json();
      if (data && typeof data.code === 'string' && data.code) code = data.code;
    } catch { /* the status is enough */ }
    const err = new Error('mailer send failed');
    err.code = code;
    throw err;
  }
}

export function mailerSend(env) {
  const mailer = env && env.MAILER;
  if (!mailer || typeof mailer.fetch !== 'function') return null;
  return (message) => sendViaMailer(mailer, message);
}
