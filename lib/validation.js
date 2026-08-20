const { config } = require('./config');

function fail(message, code = 'VALIDATION') {
  throw Object.assign(new Error(message), { code });
}

function coordinates(value) {
  if (!Array.isArray(value) || value.length !== 2) fail('Coordinates must contain latitude and longitude');
  const lat = Number(value[0]);
  const lng = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    fail('Coordinates are invalid');
  }
  const area = config.serviceArea;
  if (lat < area.minLat || lat > area.maxLat || lng < area.minLng || lng > area.maxLng) {
    fail('The bike is outside the Helsinki and Espoo service area', 'OUTSIDE_SERVICE_AREA');
  }
  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
}

function requiredString(value, name, maxLength) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) fail(`${name} is required`);
  if (result.length > maxLength) fail(`${name} is too long`);
  return result;
}

function optionalString(value, maxLength) {
  if (value === undefined || value === null || value === '') return '';
  const result = String(value).trim();
  if (result.length > maxLength) fail('Value is too long');
  return result;
}

function phone(value) {
  const result = requiredString(value, 'Phone number', 32);
  if (!/^\+?[0-9 ()-]{7,24}$/.test(result)) fail('Phone number format is invalid');
  return result;
}

function email(value) {
  const result = optionalString(value, 254).toLowerCase();
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail('Email format is invalid');
  return result;
}

function accessType(value) {
  if (!['Meet in person', 'Lock code'].includes(value)) fail('Access type is invalid');
  return value;
}

function status(value) {
  const allowed = ['Pending payment', 'Booked', 'En route', 'In progress', 'Completed', 'Cancelled'];
  if (!allowed.includes(value)) fail('Status is invalid');
  return value;
}

module.exports = { accessType, coordinates, email, fail, optionalString, phone, requiredString, status };
