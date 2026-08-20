const { getApps, initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { config } = require('./config');

function app() {
  if (getApps().length) return getApps()[0];
  const options = { credential: applicationDefault() };
  if (config.projectId) options.projectId = config.projectId;
  if (config.storageBucket) options.storageBucket = config.storageBucket;
  return initializeApp(options);
}

let firestoreClient;
function db() {
  if (firestoreClient) return firestoreClient;
  firestoreClient = getFirestore(app());
  firestoreClient.settings({ ignoreUndefinedProperties: true });
  return firestoreClient;
}

const auth = () => getAuth(app());
const bucket = () => getStorage(app()).bucket(config.storageBucket);

module.exports = { auth, bucket, db, FieldValue, Timestamp };
