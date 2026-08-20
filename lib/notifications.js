const { config } = require('./config');

const configured = () => ({
  sms: Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.fromNumber),
  email: Boolean(config.sendgrid.apiKey && config.sendgrid.fromEmail)
});

async function sendSms(to, message) {
  if (!configured().sms || !to) return { sent: false, reason: 'not_configured' };
  const form = new URLSearchParams({ To: to, From: config.twilio.fromNumber, Body: message });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilio.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form,
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Twilio returned ${response.status}`);
  const payload = await response.json();
  return { sent: true, reference: payload.sid };
}

async function sendEmail(to, subject, text) {
  if (!configured().email || !to) return { sent: false, reason: 'not_configured' };
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.sendgrid.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: config.sendgrid.fromEmail, name: 'Pin & Pedal' },
      subject,
      content: [{ type: 'text/plain', value: text }]
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`SendGrid returned ${response.status}`);
  return { sent: true, reference: response.headers.get('x-message-id') || '' };
}

async function notifyCustomer(booking, event) {
  const messages = {
    paid: `Pin & Pedal booking ${booking.id} is confirmed for ${booking.timeSlot}.`,
    'En route': `Pin & Pedal is en route for booking ${booking.id}.`,
    'In progress': `Repair ${booking.id} is now in progress.`,
    Completed: `Repair ${booking.id} is complete. Private details will be deleted automatically.`,
    Cancelled: `Pin & Pedal booking ${booking.id} has been cancelled.`,
    refunded: `Pin & Pedal booking ${booking.id} was cancelled and its payment refund was submitted.`
  };
  const message = messages[event];
  if (!message) return [];
  const operations = [sendSms(booking.phone, message)];
  if (booking.email) operations.push(sendEmail(booking.email, `Pin & Pedal: ${event === 'paid' ? 'booking confirmed' : event}`, message));
  const results = await Promise.allSettled(operations);
  for (const result of results) {
    if (result.status === 'rejected') console.error(JSON.stringify({ severity: 'ERROR', event: 'customer_notification_failed', message: result.reason.message }));
  }
  return results;
}

module.exports = { configured, notifyCustomer, sendEmail, sendSms };
