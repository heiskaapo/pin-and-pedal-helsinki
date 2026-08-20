const https = require('https');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ demo: true });
  }

  let data = req.body;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch {}
  }
  data = data || {};

  const amount = Math.round(Number(data.amount) * 100);
  if (!Number.isInteger(amount) || amount < 100) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const params = new URLSearchParams({
    'mode': 'payment',
    'success_url': `${proto}://${host}/?payment=success`,
    'cancel_url': `${proto}://${host}/?payment=cancel`,
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][product_data][name]': data.description || 'Pin & Pedal repair',
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][quantity]': '1'
  }).toString();

  const apiReq = https.request({
    hostname: 'api.stripe.com',
    path: '/v1/checkout/sessions',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params)
    }
  }, apiRes => {
    let body = '';
    apiRes.on('data', chunk => body += chunk);
    apiRes.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const parsed = JSON.parse(body);
        res.status(apiRes.statusCode).json({
          checkoutUrl: parsed.url,
          error: parsed.error?.message
        });
      } catch (err) {
        res.status(502).json({ error: 'Stripe response could not be read' });
      }
    });
  });

  apiReq.on('error', () => {
    res.setHeader('Content-Type', 'application/json');
    res.status(502).json({ error: 'Stripe could not be reached' });
  });

  apiReq.end(params);
};
