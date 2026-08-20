const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  config: null,
  step: 1,
  accessType: 'Meet in person',
  coords: null,
  quote: null,
  selectedOption: null,
  photos: {},
  map: null,
  customerMarker: null,
  mechanicMarker: null,
  routeLines: [],
  live: null,
  operator: null,
  jobs: [],
  locationWatchId: null
};

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(node.timer);
  node.timer = setTimeout(() => node.classList.remove('show'), 3500);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json', ...(options.headers || {}) }
      : options.headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function showView(viewId) {
  $$('.view').forEach(node => node.classList.toggle('active', node.id === viewId));
  $$('.nav').forEach(node => node.classList.toggle('active', node.dataset.view === viewId));
  if (viewId === 'ops') checkOperatorSession();
  if (viewId === 'book' && state.step === 2) setTimeout(initMap, 50);
}

function showStep(step) {
  state.step = step;
  $$('.bookStep').forEach(node => node.classList.toggle('active', Number(node.dataset.step) === step));
  $$('.stepDots li').forEach((node, index) => node.classList.toggle('current', index === step - 1));
  if (step === 2) setTimeout(initMap, 50);
  if (step === 5) renderBookingSummary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateStep(step) {
  if (step === 3 && !state.selectedOption) throw new Error('Choose an available appointment.');
  if (step === 4) {
    if (!state.photos.scene || !state.photos.frame || !state.photos.tire) throw new Error('Add all three identification photos.');
    if (!$('#accessInstructions').value.trim() || !$('#phone').value.trim()) throw new Error('Access instructions and phone number are required.');
    if ($('#email').value && !$('#email').validity.valid) throw new Error('Enter a valid email address.');
  }
}

function loadGoogleMaps() {
  if (window.google?.maps) return Promise.resolve();
  if (!state.config?.mapsBrowserApiKey) return Promise.reject(new Error('Google Maps is not configured.'));
  return new Promise((resolve, reject) => {
    window.__pinPedalMapsReady = resolve;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(state.config.mapsBrowserApiKey)}&libraries=geometry&loading=async&callback=__pinPedalMapsReady`;
    script.async = true;
    script.onerror = () => reject(new Error('Google Maps could not load.'));
    document.head.appendChild(script);
  });
}

async function initMap() {
  if (state.map) {
    google.maps.event.trigger(state.map, 'resize');
    return;
  }
  try {
    await loadGoogleMaps();
    state.map = new google.maps.Map($('#map'), {
      center: { lat: 60.18, lng: 24.90 },
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });
    new google.maps.Marker({
      map: state.map,
      position: { lat: state.config.depot.coords[0], lng: state.config.depot.coords[1] },
      title: state.config.depot.address,
      label: 'D'
    });
    state.map.addListener('click', event => setPin(event.latLng.lat(), event.latLng.lng()));
    $('#pinStatus').textContent = 'Tap the map or use GPS to place the bike pin.';
    renderLiveState();
  } catch (error) {
    $('#pinStatus').textContent = error.message;
  }
}

function withinServiceArea(lat, lng) {
  const area = state.config.serviceArea;
  return lat >= area.minLat && lat <= area.maxLat && lng >= area.minLng && lng <= area.maxLng;
}

function setPin(lat, lng) {
  if (!withinServiceArea(lat, lng)) {
    toast('That pin is outside the Helsinki and Espoo service area.');
    return;
  }
  state.coords = [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
  $('#coords').value = state.coords.join(',');
  if (!state.customerMarker) state.customerMarker = new google.maps.Marker({ map: state.map, title: 'Bike location' });
  state.customerMarker.setPosition({ lat, lng });
  $('#pinStatus').textContent = `Bike pin: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  $('#findSlotsBtn').disabled = false;
  state.quote = null;
  state.selectedOption = null;
}

function clearRouteLines() {
  state.routeLines.forEach(line => line.setMap(null));
  state.routeLines = [];
}

function drawOptionRoute(option) {
  if (!state.map || !window.google?.maps?.geometry) return;
  clearRouteLines();
  for (const encoded of option.routePolylines || []) {
    const line = new google.maps.Polyline({
      map: state.map,
      path: google.maps.geometry.encoding.decodePath(encoded),
      strokeColor: '#f76545',
      strokeOpacity: 0.9,
      strokeWeight: 5
    });
    state.routeLines.push(line);
  }
}

async function findAppointments() {
  if (!state.coords) return;
  const button = $('#findSlotsBtn');
  button.disabled = true;
  button.textContent = 'Calculating real cycling routes…';
  try {
    const quote = await api('/api/quotes', {
      method: 'POST',
      body: JSON.stringify({ customerCoords: state.coords, accessType: state.accessType })
    });
    state.quote = quote;
    renderSlotOptions();
    showStep(3);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Find real appointments <span>→</span>';
  }
}

function renderSlotOptions() {
  const container = $('#slotOptions');
  container.replaceChildren();
  state.selectedOption = null;
  const recommendedId = state.quote.recommendation?.recommendedOptionId;
  if (state.quote.recommendation?.reason) {
    $('#aiRecommendation').hidden = false;
    $('#aiRecommendation').textContent = `Route assistant: ${state.quote.recommendation.reason}`;
  } else $('#aiRecommendation').hidden = true;

  state.quote.options.forEach(option => {
    const label = document.createElement('label');
    label.className = 'slotOption';
    const main = document.createElement('span');
    main.className = 'slotMain';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'slot';
    radio.value = option.id;
    const text = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = option.label + (recommendedId === option.id ? ' · Recommended' : '');
    const detail = document.createElement('small');
    detail.textContent = `+${option.detourKm} km · +${option.detourMinutes} min cycling detour`;
    text.append(strong, detail);
    main.append(radio, text);
    const price = document.createElement('strong');
    price.className = 'slotPrice';
    price.textContent = `€${option.price}`;
    label.append(main, price);
    label.addEventListener('click', () => selectOption(option, label, radio));
    container.append(label);
  });
}

function selectOption(option, label, radio) {
  state.selectedOption = option;
  $$('.slotOption').forEach(node => node.classList.remove('selected'));
  label.classList.add('selected');
  radio.checked = true;
  $('#routeImpact').hidden = false;
  $('#impactKm').textContent = `+${option.detourKm} km`;
  $('#impactMinutes').textContent = `+${option.detourMinutes} min`;
  $('#impactPrice').textContent = `€${option.price}`;
  drawOptionRoute(option);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Photo could not be read.')); };
    image.src = url;
  });
}

async function compressPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPEG, PNG, or WebP photo.');
  const image = await loadImage(file);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/jpeg', 0.82);
  if (Math.ceil(data.length * 0.75) > 4 * 1024 * 1024) throw new Error('The compressed photo is still larger than 4 MB.');
  return data;
}

function renderBookingSummary() {
  const container = $('#bookingSummary');
  container.replaceChildren();
  const rows = [
    ['Appointment', state.selectedOption?.label || '—'],
    ['Bike access', state.accessType],
    ['Cycling detour', `+${state.selectedOption?.detourKm ?? '—'} km`],
    ['Total', `€${state.selectedOption?.price ?? '—'}`]
  ];
  rows.forEach(([name, value], index) => {
    const row = document.createElement('div');
    row.className = `summaryRow${index === rows.length - 1 ? ' total' : ''}`;
    const label = document.createElement('span');
    label.textContent = name;
    const result = document.createElement('strong');
    result.textContent = value;
    row.append(label, result);
    container.append(row);
  });
  $('#checkoutBtn').disabled = !state.config.paymentsConfigured;
}

async function submitBooking(event) {
  event.preventDefault();
  try { validateStep(4); } catch (error) { toast(error.message); return; }
  if (!state.quote || !state.selectedOption) return toast('Request a fresh appointment quote.');
  const button = $('#checkoutBtn');
  button.disabled = true;
  button.textContent = 'Creating secure checkout…';
  try {
    const result = await api('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        quoteToken: state.quote.quoteToken,
        optionId: state.selectedOption.id,
        phone: $('#phone').value.trim(),
        email: $('#email').value.trim(),
        accessType: state.accessType,
        accessInstructions: $('#accessInstructions').value.trim(),
        photos: [
          { kind: 'scene', data: state.photos.scene },
          { kind: 'frame', data: state.photos.frame },
          { kind: 'tire', data: state.photos.tire }
        ]
      })
    });
    localStorage.setItem('pp_customer_booking_token', result.customerBookingToken);
    location.assign(result.checkoutUrl);
  } catch (error) {
    toast(error.message);
    button.disabled = !state.config.paymentsConfigured;
    button.innerHTML = 'Continue to Stripe <span>→</span>';
  }
}

async function refreshBookingResult() {
  const params = new URLSearchParams(location.search);
  const payment = params.get('payment');
  if (!payment) return;
  const banner = $('#paymentResult');
  banner.hidden = false;
  const token = localStorage.getItem('pp_customer_booking_token');
  if (payment === 'cancel') {
    try {
      if (token) await api('/api/bookings/cancel', { method: 'POST', body: JSON.stringify({ token }) });
      banner.className = 'resultBanner error';
      banner.textContent = 'Payment was cancelled. The unconfirmed appointment has been released.';
    } catch (error) {
      banner.className = 'resultBanner error';
      banner.textContent = `Payment was cancelled, but the appointment could not be released automatically: ${error.message}`;
    }
  } else if (token) {
    try {
      const booking = await api(`/api/bookings/status?token=${encodeURIComponent(token)}`);
      banner.className = booking.paymentStatus === 'paid' ? 'resultBanner success' : 'resultBanner';
      banner.textContent = booking.paymentStatus === 'paid'
        ? `Booking ${booking.id} is confirmed for ${booking.timeSlot}.`
        : 'Stripe returned successfully. Payment confirmation is still being verified by the webhook.';
      if (booking.paymentStatus === 'paid' && booking.status !== 'Cancelled') {
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'quiet compact';
        cancelButton.textContent = 'Cancel and refund';
        cancelButton.addEventListener('click', async () => {
          cancelButton.disabled = true;
          try {
            const result = await api('/api/bookings/cancel', { method: 'POST', body: JSON.stringify({ token }) });
            banner.className = 'resultBanner success';
            banner.textContent = result.booking.paymentStatus === 'refunded'
              ? 'The booking was cancelled and the refund was submitted to Stripe.'
              : 'The booking was cancelled.';
          } catch (error) {
            toast(error.message);
            cancelButton.disabled = false;
          }
        });
        banner.append(document.createElement('br'), cancelButton);
      }
    } catch (error) {
      banner.className = 'resultBanner error';
      banner.textContent = error.message;
    }
  }
  history.replaceState({}, '', location.pathname);
}

async function pollLive() {
  try {
    state.live = await api('/api/public/live');
    renderLiveState();
  } catch {}
}

function renderLiveState() {
  const mechanic = state.live?.mechanic;
  const statusNode = $('#liveStatus');
  const dot = $('.liveDot');
  if (!mechanic) {
    statusNode.textContent = 'No recent mechanic GPS update is available.';
    dot.classList.remove('fresh');
    return;
  }
  const ageMinutes = Math.round((Date.now() - new Date(mechanic.updatedAt).getTime()) / 60000);
  const fresh = ageMinutes <= 5;
  dot.classList.toggle('fresh', fresh);
  statusNode.textContent = fresh ? `Live GPS updated ${Math.max(0, ageMinutes)} minute(s) ago.` : `Last verified GPS update was ${ageMinutes} minutes ago.`;
  if (state.map) {
    const position = { lat: mechanic.coords[0], lng: mechanic.coords[1] };
    if (!state.mechanicMarker) state.mechanicMarker = new google.maps.Marker({ map: state.map, title: 'Mechanic live GPS', label: 'M' });
    state.mechanicMarker.setPosition(position);
  }
}

async function checkOperatorSession() {
  try {
    state.operator = await api('/api/operator/me');
    $('#operatorLogin').hidden = true;
    $('#operatorConsole').hidden = false;
    $('#operatorIdentity').textContent = state.operator.email;
    await loadOperatorJobs();
  } catch {
    state.operator = null;
    $('#operatorLogin').hidden = false;
    $('#operatorConsole').hidden = true;
  }
}

async function operatorLogin(event) {
  event.preventDefault();
  const errorNode = $('#loginError');
  errorNode.textContent = '';
  try {
    if (!state.config.identityPlatformApiKey) throw new Error('Operator authentication is not configured.');
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(state.config.identityPlatformApiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#operatorEmail').value.trim(), password: $('#operatorPassword').value, returnSecureToken: true })
    });
    const identity = await response.json();
    if (!response.ok) throw new Error('Email or password was not accepted.');
    await api('/api/operator/session', { method: 'POST', body: JSON.stringify({ idToken: identity.idToken }) });
    $('#operatorPassword').value = '';
    await checkOperatorSession();
  } catch (error) {
    errorNode.textContent = error.message;
  }
}

async function operatorLogout() {
  await api('/api/operator/session', { method: 'DELETE' });
  if (state.locationWatchId !== null) navigator.geolocation.clearWatch(state.locationWatchId);
  state.locationWatchId = null;
  await checkOperatorSession();
}

function appendText(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

async function loadOperatorJobs() {
  const result = await api('/api/operator/jobs');
  state.jobs = result.jobs;
  renderJobs();
  renderMarketing();
}

function renderJobs() {
  const container = $('#jobList');
  container.replaceChildren();
  if (!state.jobs.length) return appendText(container, 'p', 'No bookings are scheduled today.', 'hint');
  state.jobs.forEach(job => {
    const card = document.createElement('article');
    card.className = `jobCard status-${job.status.replaceAll(' ', '-')}`;
    const top = document.createElement('div');
    top.className = 'jobTop';
    appendText(top, 'h3', `${job.timeSlot} · ${job.area}`);
    appendText(top, 'span', job.status, 'badge');
    card.append(top);
    appendText(card, 'p', `${job.id} · €${job.price} · payment: ${job.paymentStatus}`, 'jobMeta');
    const privateBox = document.createElement('div');
    privateBox.className = 'privateBox';
    appendText(privateBox, 'div', `Phone: ${job.phone || 'deleted'}`);
    appendText(privateBox, 'div', `Access: ${job.accessInstructions || 'deleted'}`);
    card.append(privateBox);
    const photos = document.createElement('div');
    photos.className = 'jobPhotos';
    (job.photoKinds || []).forEach(kind => {
      const image = document.createElement('img');
      image.src = `/api/operator/jobs/${encodeURIComponent(job.id)}/photos/${encodeURIComponent(kind)}`;
      image.alt = `${kind} identification photo`;
      photos.append(image);
    });
    if (job.completionPhotoAvailable) {
      const image = document.createElement('img');
      image.src = `/api/operator/jobs/${encodeURIComponent(job.id)}/photos/completion`;
      image.alt = 'Completion photo';
      photos.append(image);
    }
    card.append(photos);
    const controls = document.createElement('div');
    controls.className = 'jobControls';
    const select = document.createElement('select');
    ['Pending payment', 'Booked', 'En route', 'In progress', 'Completed', 'Cancelled'].forEach(status => {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      option.selected = status === job.status;
      select.append(option);
    });
    select.addEventListener('change', () => updateJobStatus(job.id, select.value));
    controls.append(select);
    const photoLabel = document.createElement('label');
    photoLabel.className = 'mini';
    photoLabel.textContent = 'Completion photo';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.hidden = true;
    input.addEventListener('change', () => uploadCompletion(job.id, input.files[0]));
    photoLabel.append(input);
    controls.append(photoLabel);
    card.append(controls);
    container.append(card);
  });
}

async function updateJobStatus(id, status) {
  try {
    await api(`/api/operator/jobs/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast(`Status updated to ${status}.`);
    await loadOperatorJobs();
  } catch (error) { toast(error.message); await loadOperatorJobs(); }
}

async function uploadCompletion(id, file) {
  if (!file) return;
  try {
    const data = await compressPhoto(file);
    await api(`/api/operator/jobs/${encodeURIComponent(id)}/completion-photo`, { method: 'POST', body: JSON.stringify({ data }) });
    toast('Completion photo stored privately.');
    await loadOperatorJobs();
  } catch (error) { toast(error.message); }
}

async function loadRoute() {
  const button = $('#routeBtn');
  button.disabled = true;
  try {
    const route = await api('/api/operator/route');
    $('#routeSummary').textContent = `${route.totalKm} km · approximately ${route.totalMinutes} cycling minutes`;
    const list = $('#routeList');
    list.replaceChildren();
    route.jobs.forEach(job => appendText(list, 'li', `${job.timeSlot} · ${job.area} · ${job.status}`));
    $('#navigationLink').href = route.navigationUrl;
    $('#navigationLink').hidden = false;
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

function renderMarketing() {
  const container = $('#marketingList');
  container.replaceChildren();
  const completed = state.jobs.filter(job => job.status === 'Completed');
  if (!completed.length) return appendText(container, 'p', 'Complete a repair before creating a marketing draft.', 'hint');
  completed.forEach(job => {
    const card = document.createElement('article');
    card.className = 'marketingCard';
    appendText(card, 'h3', job.marketing?.title || `${job.area} repair`);
    appendText(card, 'p', job.marketing?.caption || 'No draft has been created.');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini';
    if (!job.marketing) {
      button.textContent = 'Create privacy-safe draft';
      button.addEventListener('click', () => createMarketingDraft(job.id));
    } else if (job.marketing.status === 'draft') {
      button.textContent = 'Approve & publish';
      button.addEventListener('click', () => publishMarketing(job.id));
    } else {
      button.textContent = 'Published';
      button.disabled = true;
    }
    card.append(button);
    container.append(card);
  });
}

async function createMarketingDraft(id) {
  try { await api(`/api/operator/jobs/${encodeURIComponent(id)}/marketing/draft`, { method: 'POST', body: '{}' }); await loadOperatorJobs(); }
  catch (error) { toast(error.message); }
}

async function publishMarketing(id) {
  try { await api(`/api/operator/jobs/${encodeURIComponent(id)}/marketing/publish`, { method: 'POST', body: '{}' }); toast('Social provider confirmed publication.'); await loadOperatorJobs(); }
  catch (error) { toast(error.message); }
}

function toggleLiveLocation() {
  if (state.locationWatchId !== null) {
    navigator.geolocation.clearWatch(state.locationWatchId);
    state.locationWatchId = null;
    $('#trackLocationBtn').textContent = 'Start live GPS';
    return;
  }
  if (!navigator.geolocation) return toast('This device does not support GPS.');
  state.locationWatchId = navigator.geolocation.watchPosition(async position => {
    try {
      await api('/api/operator/location', {
        method: 'POST',
        body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy })
      });
      $('#trackLocationBtn').textContent = 'Stop live GPS';
    } catch (error) { toast(error.message); }
  }, () => toast('GPS permission was not granted.'), { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 });
}

async function initialize() {
  try {
    state.config = await api('/api/config');
    if (!state.config.paymentsConfigured) {
      const notice = $('#serviceNotice');
      notice.hidden = false;
      notice.textContent = 'Bookings are temporarily paused while secure payment configuration is completed. Quotes and operator tools remain available.';
    }
  } catch (error) {
    const notice = $('#serviceNotice');
    notice.hidden = false;
    notice.textContent = `Service configuration could not load: ${error.message}`;
    return;
  }

  $$('.nav').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  $('#brandBtn').addEventListener('click', () => { showView('book'); showStep(1); });
  $$('.next').forEach(button => button.addEventListener('click', () => {
    try { validateStep(state.step); showStep(Math.min(5, state.step + 1)); } catch (error) { toast(error.message); }
  }));
  $$('.back').forEach(button => button.addEventListener('click', () => showStep(Math.max(1, state.step - 1))));
  $$('#accessType .choice').forEach(button => button.addEventListener('click', () => {
    $$('#accessType .choice').forEach(node => node.classList.remove('selected'));
    button.classList.add('selected');
    state.accessType = button.dataset.value;
  }));
  $('#locateBtn').addEventListener('click', () => navigator.geolocation?.getCurrentPosition(position => {
    initMap().then(() => { state.map.panTo({ lat: position.coords.latitude, lng: position.coords.longitude }); state.map.setZoom(14); setPin(position.coords.latitude, position.coords.longitude); });
  }, () => toast('GPS permission was not granted.'), { enableHighAccuracy: true, timeout: 10000 }));
  $('#findSlotsBtn').addEventListener('click', findAppointments);
  [['scenePhoto', 'scene', 'sceneName'], ['framePhoto', 'frame', 'frameName'], ['tirePhoto', 'tire', 'tireName']].forEach(([inputId, kind, nameId]) => {
    $(`#${inputId}`).addEventListener('change', async event => {
      try { state.photos[kind] = await compressPhoto(event.target.files[0]); $(`#${nameId}`).textContent = 'Ready · compressed privately'; }
      catch (error) { state.photos[kind] = null; toast(error.message); }
    });
  });
  $('#bookingForm').addEventListener('submit', submitBooking);
  $('#operatorLoginForm').addEventListener('submit', operatorLogin);
  $('#logoutBtn').addEventListener('click', operatorLogout);
  $('#trackLocationBtn').addEventListener('click', toggleLiveLocation);
  $('#routeBtn').addEventListener('click', loadRoute);
  $$('.tab').forEach(button => button.addEventListener('click', () => {
    $$('.tab').forEach(node => node.classList.remove('active'));
    $$('.panel').forEach(node => node.classList.remove('active'));
    button.classList.add('active');
    $(`#${button.dataset.panel}`).classList.add('active');
  }));
  await refreshBookingResult();
  await pollLive();
  setInterval(pollLive, 20000);
}

initialize();
