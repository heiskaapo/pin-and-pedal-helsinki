const store = require('./store');
const { deleteBookingPhotos } = require('./storage');

async function runRetention() {
  const candidates = await store.retentionCandidates(100);
  const results = [];
  for (const booking of candidates) {
    try {
      await deleteBookingPhotos(booking.id);
      await store.redactPrivateData(booking.id);
      results.push({ id: booking.id, deleted: true });
    } catch (error) {
      console.error(JSON.stringify({ severity: 'ERROR', event: 'retention_delete_failed', bookingId: booking.id, message: error.message }));
      results.push({ id: booking.id, deleted: false });
    }
  }
  return { processed: results.length, deleted: results.filter(result => result.deleted).length };
}

module.exports = { runRetention };
