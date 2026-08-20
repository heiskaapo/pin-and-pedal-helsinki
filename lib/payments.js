const Stripe = require('stripe');
const { config } = require('./config');
const store = require('./store');
const { notifyCustomer } = require('./notifications');

let stripeClient;
function stripe() {
  if (!config.stripeSecretKey) throw Object.assign(new Error('Payments are not configured'), { code: 'PAYMENTS_NOT_CONFIGURED' });
  if (!stripeClient) stripeClient = new Stripe(config.stripeSecretKey, { maxNetworkRetries: 2, timeout: 10000 });
  return stripeClient;
}

async function createCheckout(booking, customerToken) {
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    client_reference_id: booking.id,
    customer_email: booking.email || undefined,
    success_url: `${config.publicBaseUrl}/?payment=success`,
    cancel_url: `${config.publicBaseUrl}/?payment=cancel`,
    line_items: [{
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(booking.price * 100),
        product_data: { name: `Pin & Pedal repair · ${booking.timeSlot}` }
      },
      quantity: 1
    }],
    metadata: { bookingId: booking.id },
    payment_intent_data: { metadata: { bookingId: booking.id } },
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60
  }, { idempotencyKey: `pin-pedal-checkout-${booking.id}` });
  await store.markPayment(booking.id, 'checkout_created', { checkoutSessionId: session.id });
  return { checkoutUrl: session.url, customerBookingToken: `${booking.id}.${customerToken}` };
}

async function handleWebhook(rawBody, signature) {
  if (!config.stripeWebhookSecret) throw Object.assign(new Error('Stripe webhook verification is not configured'), { code: 'CONFIG' });
  let event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
  } catch {
    throw Object.assign(new Error('Stripe webhook signature is invalid'), { code: 'INVALID_WEBHOOK' });
  }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const bookingId = session.metadata?.bookingId || session.client_reference_id;
    if (bookingId) {
      const expected = await store.getBooking(bookingId);
      const expectedAmount = expected ? Math.round(expected.price * 100) : null;
      if (!expected || session.currency !== 'eur' || Number(session.amount_total) !== expectedAmount || session.payment_status !== 'paid') {
        console.error(JSON.stringify({ severity: 'ERROR', event: 'stripe_checkout_validation_failed', bookingId, currency: session.currency, amountTotal: session.amount_total, paymentStatus: session.payment_status }));
        return { received: true };
      }
      await store.markPayment(bookingId, 'paid', { checkoutSessionId: session.id, paymentIntentId: String(session.payment_intent || '') });
      const booking = await store.getBooking(bookingId);
      if (booking) await notifyCustomer(booking, 'paid');
    }
  }
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    const bookingId = session.metadata?.bookingId || session.client_reference_id;
    if (bookingId) await store.markPayment(bookingId, 'expired', { checkoutSessionId: session.id });
  }
  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    if (intent.metadata?.bookingId) await store.markPayment(intent.metadata.bookingId, 'failed', { paymentIntentId: intent.id });
  }
  return { received: true };
}

async function cancelBooking(booking) {
  if (booking.paymentStatus === 'refunded' || booking.status === 'Cancelled') return store.getBooking(booking.id);
  if (booking.paymentStatus === 'paid') {
    if (!booking.stripePaymentIntentId) throw Object.assign(new Error('The payment reference is not available for an automatic refund'), { code: 'PAYMENT_REFERENCE_MISSING' });
    await stripe().refunds.create({ payment_intent: booking.stripePaymentIntentId }, { idempotencyKey: `pin-pedal-refund-${booking.id}` });
    await store.markPayment(booking.id, 'refunded', { paymentIntentId: booking.stripePaymentIntentId });
  } else if (booking.stripeCheckoutSessionId && booking.paymentStatus === 'checkout_created') {
    await stripe().checkout.sessions.expire(booking.stripeCheckoutSessionId, { idempotencyKey: `pin-pedal-expire-${booking.id}` }).catch(error => {
      if (error?.code !== 'resource_missing') throw error;
    });
    await store.markPayment(booking.id, 'expired', { checkoutSessionId: booking.stripeCheckoutSessionId });
  } else {
    await store.updateBookingStatus(booking.id, 'Cancelled', 'Cancelled before payment.');
  }
  return store.getBooking(booking.id);
}

module.exports = { cancelBooking, createCheckout, handleWebhook };
