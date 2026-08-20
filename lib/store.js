const crypto = require('crypto');
const { config } = require('./config');
const { db, FieldValue, Timestamp } = require('./firebase');
const { currentMinute, dayKey } = require('./time');
const { hashToken } = require('./tokens');

const activeStatuses = new Set(['Pending payment', 'Booked', 'En route', 'In progress']);
const asIso = value => value?.toDate ? value.toDate().toISOString() : value || null;

function publicJob(id, data) {
  return {
    id,
    dayKey: data.dayKey,
    timeSlot: data.timeSlot,
    startMinute: data.startMinute,
    endMinute: data.endMinute,
    price: data.price,
    status: data.status,
    area: data.area || 'Helsinki/Espoo',
    createdAt: asIso(data.createdAt),
    paidAt: asIso(data.paidAt),
    completedAt: asIso(data.completedAt),
    paymentStatus: data.paymentStatus || 'unpaid',
    publicNote: data.publicNote || '',
    privateDataDeleted: Boolean(data.privateDataDeleted)
  };
}

function operatorJob(id, data) {
  return {
    ...publicJob(id, data),
    coords: data.coords,
    phone: data.phone || '',
    email: data.email || '',
    accessType: data.accessType,
    accessInstructions: data.accessInstructions || '',
    photoKinds: Object.keys(data.photos || {}),
    completionPhotoAvailable: Boolean(data.completionPhoto),
    marketing: data.marketing || null,
    paymentStatus: data.paymentStatus || 'unpaid'
  };
}

async function getJobsForDay(requestedDay = dayKey()) {
  const snapshot = await db().collection('bookings').where('dayKey', '==', requestedDay).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(job => activeStatuses.has(job.status) || job.status === 'Completed');
}

async function saveQuote(quote) {
  const id = crypto.randomUUID();
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + config.quoteTtlMinutes * 60 * 1000));
  await db().collection('quotes').doc(id).set({ ...quote, expiresAt, createdAt: FieldValue.serverTimestamp(), consumedAt: null });
  return { id, expiresAt: expiresAt.toDate().toISOString() };
}

async function getQuote(id) {
  const snapshot = await db().collection('quotes').doc(id).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function createPendingBooking({ quoteId, optionId, phone, email, accessType, accessInstructions, customerToken }) {
  const firestore = db();
  const quoteRef = firestore.collection('quotes').doc(quoteId);
  const bookingRef = firestore.collection('bookings').doc();
  await firestore.runTransaction(async transaction => {
    const quoteSnapshot = await transaction.get(quoteRef);
    if (!quoteSnapshot.exists) throw Object.assign(new Error('Quote not found'), { code: 'QUOTE_NOT_FOUND' });
    const quote = quoteSnapshot.data();
    if (quote.consumedAt || quote.expiresAt.toMillis() <= Date.now()) throw Object.assign(new Error('Quote expired'), { code: 'QUOTE_EXPIRED' });
    const option = quote.options.find(item => item.id === optionId);
    if (!option) throw Object.assign(new Error('Selected time is invalid'), { code: 'VALIDATION' });
    if (quote.dayKey === dayKey() && option.startMinute < currentMinute() + config.workday.minimumLeadMinutes) {
      throw Object.assign(new Error('That appointment is too soon or has already passed. Please request a new quote.'), { code: 'SLOT_UNAVAILABLE' });
    }
    const jobsQuery = firestore.collection('bookings').where('dayKey', '==', quote.dayKey);
    const jobsSnapshot = await transaction.get(jobsQuery);
    const conflict = jobsSnapshot.docs.some(doc => {
      const job = doc.data();
      return activeStatuses.has(job.status) && option.startMinute < job.endMinute && option.endMinute > job.startMinute;
    });
    if (conflict) throw Object.assign(new Error('That appointment was just taken. Please request a new quote.'), { code: 'SLOT_UNAVAILABLE' });

    const deleteAt = Timestamp.fromDate(new Date(Date.now() + config.bookingTtlDays * 86400000));
    transaction.set(bookingRef, {
      dayKey: quote.dayKey,
      coords: quote.customerCoords,
      area: quote.area || 'Helsinki/Espoo',
      timeSlot: option.label,
      startMinute: option.startMinute,
      endMinute: option.endMinute,
      price: option.price,
      detourMinutes: option.detourMinutes,
      detourKm: option.detourKm,
      phone,
      email,
      accessType,
      accessInstructions,
      customerTokenHash: hashToken(customerToken),
      status: 'Pending payment',
      paymentStatus: 'unpaid',
      photos: {},
      privateDataDeleted: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleteAt
    });
    transaction.update(quoteRef, { consumedAt: FieldValue.serverTimestamp(), bookingId: bookingRef.id });
  });
  return bookingRef.id;
}

async function setBookingPhotos(bookingId, photos) {
  await db().collection('bookings').doc(bookingId).update({ photos, updatedAt: FieldValue.serverTimestamp() });
}

async function setCompletionPhoto(bookingId, objectName) {
  await db().collection('bookings').doc(bookingId).update({ completionPhoto: objectName, updatedAt: FieldValue.serverTimestamp() });
}

async function deleteFailedBooking(bookingId) {
  await db().collection('bookings').doc(bookingId).delete();
}

async function getBooking(bookingId) {
  const snapshot = await db().collection('bookings').doc(bookingId).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function getCustomerBooking(bookingToken) {
  const booking = await getCustomerBookingRecord(bookingToken);
  return booking ? publicJob(booking.id, booking) : null;
}

async function getCustomerBookingRecord(bookingToken) {
  const [bookingId, secret] = String(bookingToken || '').split('.');
  if (!bookingId || !secret) return null;
  const booking = await getBooking(bookingId);
  if (!booking) return null;
  const actual = Buffer.from(hashToken(secret));
  const expected = Buffer.from(booking.customerTokenHash || '');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  return booking;
}

async function listOperatorJobs(requestedDay = dayKey()) {
  const snapshot = await db().collection('bookings').where('dayKey', '==', requestedDay).get();
  return snapshot.docs.map(doc => operatorJob(doc.id, doc.data())).sort((a, b) => a.startMinute - b.startMinute);
}

async function updateBookingStatus(bookingId, status, publicNote = '') {
  const ref = db().collection('bookings').doc(bookingId);
  const updates = { status, publicNote: publicNote.slice(0, 300), updatedAt: FieldValue.serverTimestamp() };
  if (status === 'Completed') {
    updates.completedAt = FieldValue.serverTimestamp();
    updates.privateDeleteAt = Timestamp.fromDate(new Date(Date.now() + config.retentionHoursAfterCompletion * 3600000));
  }
  await ref.update(updates);
  return getBooking(bookingId);
}

async function markPayment(bookingId, paymentStatus, stripeData = {}) {
  const updates = { paymentStatus, updatedAt: FieldValue.serverTimestamp() };
  if (paymentStatus === 'paid') {
    updates.status = 'Booked';
    updates.paidAt = FieldValue.serverTimestamp();
  }
  if (['expired', 'failed', 'refunded'].includes(paymentStatus)) updates.status = 'Cancelled';
  if (paymentStatus === 'refunded') updates.refundedAt = FieldValue.serverTimestamp();
  if (stripeData.checkoutSessionId) updates.stripeCheckoutSessionId = stripeData.checkoutSessionId;
  if (stripeData.paymentIntentId) updates.stripePaymentIntentId = stripeData.paymentIntentId;
  await db().collection('bookings').doc(bookingId).update(updates);
}

async function saveMechanicLocation({ lat, lng, accuracy, operatorEmail }) {
  await db().collection('operations').doc('live').set({
    coords: [lat, lng], accuracy, operatorEmail, updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

async function getPublicLive() {
  const [liveSnapshot, jobs] = await Promise.all([db().collection('operations').doc('live').get(), getJobsForDay()]);
  const live = liveSnapshot.exists ? liveSnapshot.data() : {};
  return {
    mechanic: live.coords ? { coords: live.coords, accuracy: live.accuracy || null, updatedAt: asIso(live.updatedAt) } : null,
    schedule: jobs.map(job => ({ id: job.id, timeSlot: job.timeSlot, status: job.status, area: job.area || 'Helsinki/Espoo' }))
  };
}

async function saveMarketingDraft(bookingId, draft) {
  await db().collection('bookings').doc(bookingId).update({
    marketing: { ...draft, status: 'draft', createdAt: new Date().toISOString() },
    updatedAt: FieldValue.serverTimestamp()
  });
}

async function markMarketingPublished(bookingId, providerResult) {
  await db().collection('bookings').doc(bookingId).update({
    'marketing.status': 'published',
    'marketing.publishedAt': new Date().toISOString(),
    'marketing.providerReference': providerResult.reference || '',
    updatedAt: FieldValue.serverTimestamp()
  });
}

async function retentionCandidates(limit = 100) {
  const snapshot = await db().collection('bookings')
    .where('privateDeleteAt', '<=', Timestamp.now())
    .limit(limit)
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(booking => !booking.privateDataDeleted);
}

async function redactPrivateData(bookingId) {
  await db().collection('bookings').doc(bookingId).update({
    phone: FieldValue.delete(),
    email: FieldValue.delete(),
    accessInstructions: FieldValue.delete(),
    coords: FieldValue.delete(),
    customerTokenHash: FieldValue.delete(),
    photos: FieldValue.delete(),
    privateDataDeleted: true,
    privateDataDeletedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
}

module.exports = {
  createPendingBooking,
  deleteFailedBooking,
  getBooking,
  getCustomerBooking,
  getCustomerBookingRecord,
  getJobsForDay,
  getPublicLive,
  getQuote,
  listOperatorJobs,
  markMarketingPublished,
  markPayment,
  redactPrivateData,
  retentionCandidates,
  saveMarketingDraft,
  saveMechanicLocation,
  saveQuote,
  setBookingPhotos,
  setCompletionPhoto,
  updateBookingStatus
};
