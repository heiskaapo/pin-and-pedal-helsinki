const HELSINKI_TZ = 'Europe/Helsinki';

function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HELSINKI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function minuteLabel(minute) {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function slotLabel(startMinute, endMinute) {
  return `${minuteLabel(startMinute)}–${minuteLabel(endMinute)}`;
}

function currentMinute(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HELSINKI_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

module.exports = { HELSINKI_TZ, currentMinute, dayKey, minuteLabel, slotLabel };
