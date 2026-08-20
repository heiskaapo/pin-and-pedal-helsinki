const fs = require('fs');
const path = require('path');

function loadLocalEnv() {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') return;
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadLocalEnv();

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const csvFromEnv = name => (process.env[name] || '')
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);

const stringFromEnv = (name, fallback = '') => (process.env[name] ?? fallback).trim();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: numberFromEnv('PORT', 8080),
  projectId: stringFromEnv('GCP_PROJECT_ID', process.env.GOOGLE_CLOUD_PROJECT || ''),
  region: stringFromEnv('GCP_LOCATION', 'europe-north1'),
  vertexLocation: stringFromEnv('VERTEX_LOCATION', 'global'),
  geminiModel: stringFromEnv('GEMINI_MODEL', 'gemini-3.7-flash'),
  publicBaseUrl: stringFromEnv('PUBLIC_BASE_URL', 'http://localhost:8080').replace(/\/$/, ''),
  storageBucket: stringFromEnv('STORAGE_BUCKET'),
  mapsBrowserApiKey: stringFromEnv('MAPS_BROWSER_API_KEY'),
  identityPlatformApiKey: stringFromEnv('IDENTITY_PLATFORM_API_KEY'),
  routesApiKey: stringFromEnv('ROUTES_API_KEY'),
  sessionCookieSecret: stringFromEnv('SESSION_COOKIE_SECRET'),
  stripeSecretKey: stringFromEnv('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: stringFromEnv('STRIPE_WEBHOOK_SECRET'),
  operatorAllowedEmails: csvFromEnv('OPERATOR_ALLOWED_EMAILS'),
  internalServiceAccountEmail: stringFromEnv('INTERNAL_SERVICE_ACCOUNT_EMAIL').toLowerCase(),
  retentionHoursAfterCompletion: numberFromEnv('RETENTION_HOURS_AFTER_COMPLETION', 24),
  bookingTtlDays: numberFromEnv('BOOKING_TTL_DAYS', 90),
  quoteTtlMinutes: numberFromEnv('QUOTE_TTL_MINUTES', 15),
  maxJsonBytes: numberFromEnv('MAX_JSON_BYTES', 18 * 1024 * 1024),
  maxPhotoBytes: numberFromEnv('MAX_PHOTO_BYTES', 4 * 1024 * 1024),
  depot: {
    address: 'Jämeräntaival 1C, Espoo',
    coords: [60.1873, 24.8344]
  },
  serviceArea: {
    minLat: 60.10,
    maxLat: 60.35,
    minLng: 24.50,
    maxLng: 25.30
  },
  workday: {
    startMinute: 8 * 60,
    endMinute: 16 * 60,
    repairMinutes: 45,
    transitBufferMinutes: 5,
    minimumLeadMinutes: 30
  },
  pricing: {
    baseEur: 29,
    detourMinuteEur: 0.75
  },
  twilio: {
    accountSid: stringFromEnv('TWILIO_ACCOUNT_SID'),
    authToken: stringFromEnv('TWILIO_AUTH_TOKEN'),
    fromNumber: stringFromEnv('TWILIO_FROM_NUMBER')
  },
  sendgrid: {
    apiKey: stringFromEnv('SENDGRID_API_KEY'),
    fromEmail: stringFromEnv('NOTIFICATION_FROM_EMAIL')
  },
  social: {
    webhookUrl: stringFromEnv('SOCIAL_PUBLISH_WEBHOOK_URL'),
    webhookSecret: stringFromEnv('SOCIAL_PUBLISH_WEBHOOK_SECRET')
  }
};

config.isProduction = config.nodeEnv === 'production';
config.secureCookies = config.publicBaseUrl.startsWith('https://');

function readiness() {
  const required = {
    GCP_PROJECT_ID: config.projectId,
    STORAGE_BUCKET: config.storageBucket,
    MAPS_BROWSER_API_KEY: config.mapsBrowserApiKey,
    IDENTITY_PLATFORM_API_KEY: config.identityPlatformApiKey,
    ROUTES_API_KEY: config.routesApiKey,
    SESSION_COOKIE_SECRET: config.sessionCookieSecret,
    STRIPE_SECRET_KEY: config.stripeSecretKey,
    STRIPE_WEBHOOK_SECRET: config.stripeWebhookSecret
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  return {
    ready: missing.length === 0,
    missing,
    notifications: {
      sms: Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.fromNumber),
      email: Boolean(config.sendgrid.apiKey && config.sendgrid.fromEmail)
    },
    socialPublishing: Boolean(config.social.webhookUrl && config.social.webhookSecret)
  };
}

module.exports = { config, readiness };
