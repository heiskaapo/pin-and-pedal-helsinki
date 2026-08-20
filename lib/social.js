const crypto = require('crypto');
const { config } = require('./config');

async function publishSocial({ bookingId, title, caption }) {
  if (!config.social.webhookUrl || !config.social.webhookSecret) {
    throw Object.assign(new Error('Social publishing is not configured'), { code: 'SOCIAL_NOT_CONFIGURED' });
  }
  const body = JSON.stringify({ bookingId, title, caption, requestedAt: new Date().toISOString() });
  const signature = crypto.createHmac('sha256', config.social.webhookSecret).update(body).digest('hex');
  const response = await fetch(config.social.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pin-Pedal-Signature': `sha256=${signature}` },
    body,
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw Object.assign(new Error(`Social provider returned ${response.status}`), { code: 'SOCIAL_PUBLISH_FAILED' });
  const payload = await response.json().catch(() => ({}));
  return { reference: String(payload.id || payload.reference || '') };
}

module.exports = { publishSocial };
