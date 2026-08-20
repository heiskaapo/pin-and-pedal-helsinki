const crypto = require('crypto');
const { bucket } = require('./firebase');
const { config } = require('./config');

const allowedMime = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);
const requiredKinds = ['scene', 'frame', 'tire'];

function decodePhoto(photo) {
  if (!photo || !requiredKinds.includes(photo.kind) || typeof photo.data !== 'string') {
    throw Object.assign(new Error('Photo payload is invalid'), { code: 'VALIDATION' });
  }
  const match = photo.data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !allowedMime.has(match[1])) throw Object.assign(new Error('Photo type is not supported'), { code: 'VALIDATION' });
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > config.maxPhotoBytes) throw Object.assign(new Error('Each photo must be smaller than 4 MB'), { code: 'VALIDATION' });
  return { kind: photo.kind, mime: match[1], extension: allowedMime.get(match[1]), data };
}

async function uploadBookingPhotos(bookingId, photos) {
  if (!Array.isArray(photos) || photos.length !== requiredKinds.length) throw Object.assign(new Error('Exactly three identification photos are required'), { code: 'VALIDATION' });
  const decoded = photos.map(decodePhoto);
  if (new Set(decoded.map(photo => photo.kind)).size !== requiredKinds.length) throw Object.assign(new Error('Scene, frame, and tire photos are required'), { code: 'VALIDATION' });
  const result = {};
  await Promise.all(decoded.map(async photo => {
    const objectName = `private/bookings/${bookingId}/${photo.kind}-${crypto.randomUUID()}.${photo.extension}`;
    await bucket().file(objectName).save(photo.data, {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: photo.mime,
        cacheControl: 'private, no-store, max-age=0',
        metadata: { bookingId, kind: photo.kind }
      }
    });
    result[photo.kind] = objectName;
  }));
  return result;
}

async function uploadCompletionPhoto(bookingId, dataUrl) {
  const photo = decodePhoto({ kind: 'scene', data: dataUrl });
  const objectName = `private/bookings/${bookingId}/completion-${crypto.randomUUID()}.${photo.extension}`;
  await bucket().file(objectName).save(photo.data, {
    resumable: false,
    validation: 'crc32c',
    metadata: { contentType: photo.mime, cacheControl: 'private, no-store, max-age=0', metadata: { bookingId, kind: 'completion' } }
  });
  return objectName;
}

async function getPhotoStream(objectName) {
  if (!String(objectName || '').startsWith('private/bookings/')) throw Object.assign(new Error('Photo not found'), { code: 'NOT_FOUND' });
  const file = bucket().file(objectName);
  const [exists] = await file.exists();
  if (!exists) throw Object.assign(new Error('Photo not found'), { code: 'NOT_FOUND' });
  const [metadata] = await file.getMetadata();
  return { stream: file.createReadStream(), contentType: metadata.contentType || 'application/octet-stream' };
}

async function deleteBookingPhotos(bookingId) {
  await bucket().deleteFiles({ prefix: `private/bookings/${bookingId}/`, force: true });
}

module.exports = { deleteBookingPhotos, getPhotoStream, uploadBookingPhotos, uploadCompletionPhoto };
