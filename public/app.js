const countryInput = document.querySelector('#country');
const stateInput = document.querySelector('#state');
const citySearchInput = document.querySelector('#citySearch');
const searchLocationsBtn = document.querySelector('#searchLocations');
const locationsEl = document.querySelector('#locations');
const locationSourceEl = document.querySelector('#locationSource');

const cityInput = document.querySelector('#city');
const latInput = document.querySelector('#lat');
const lonInput = document.querySelector('#lon');
const timezoneInput = document.querySelector('#timezone');
const demoInput = document.querySelector('#demo');
const connectBtn = document.querySelector('#connect');

const conditionEl = document.querySelector('#condition');
const tempEl = document.querySelector('#temp');
const detailsEl = document.querySelector('#details');
const updatedEl = document.querySelector('#updated');
const hourlyEl = document.querySelector('#hourly');
const historyEl = document.querySelector('#history');
const connectionEl = document.querySelector('#connection');
const sourceEl = document.querySelector('#source');
const warningEl = document.querySelector('#warning');

let eventSource;

function setConnectionStatus(message, isGood = false) {
  connectionEl.textContent = message;
  connectionEl.style.color = isGood ? '#4ade80' : '#fbbf24';
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime())
    ? isoString
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function render(payload) {
  const weather = payload.weather;
  if (!weather) return;

  conditionEl.textContent = `${weather.location.name}: ${weather.weatherDescription}`;
  tempEl.textContent = `${weather.temperatureC}°C`;
  detailsEl.textContent = `Humidity: ${weather.humidityPercent}% | Wind: ${weather.windKph} km/h`;
  updatedEl.textContent = `Last update: ${formatTime(weather.timestamp)}`;
  sourceEl.textContent = `Source: ${payload.source || 'unknown'}`;
  warningEl.textContent = payload.warning ? `Note: ${payload.warning}` : '';

  hourlyEl.innerHTML = '';
  weather.hourlyPreview.forEach((hour) => {
    const li = document.createElement('li');
    li.textContent = `${formatTime(hour.time)} → ${hour.temperatureC}°C`;
    hourlyEl.appendChild(li);
  });

  historyEl.innerHTML = '';
  payload.history.slice(0, 10).forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${formatTime(entry.timestamp)} | ${entry.temperatureC}°C | ${entry.weatherDescription}`;
    historyEl.appendChild(li);
  });
}

function applyLocation(location) {
  cityInput.value = location.city;
  latInput.value = location.latitude;
  lonInput.value = location.longitude;
  timezoneInput.value = location.timezone || 'auto';
}

function renderLocations(locations) {
  locationsEl.innerHTML = '';
  if (!locations.length) {
    const li = document.createElement('li');
    li.textContent = 'No locations found. Try a broader search.';
    locationsEl.appendChild(li);
    return;
  }

  locations.forEach((location) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'location-btn';
    btn.textContent = `${location.city}, ${location.state || '-'}, ${location.country}`;
    btn.addEventListener('click', () => {
      applyLocation(location);
      connect();
    });
    li.appendChild(btn);
    locationsEl.appendChild(li);
  });
}

async function searchLocations() {
  const params = new URLSearchParams({
    country: countryInput.value.trim(),
    state: stateInput.value.trim(),
    city: citySearchInput.value.trim(),
    limit: '40'
  });

  locationSourceEl.textContent = 'Source: loading...';
  try {
    const response = await fetch(`/api/v2/locations?${params.toString()}`);
    const payload = await response.json();
    renderLocations(payload.locations || []);
    locationSourceEl.textContent = `Source: ${payload.source || 'unknown'}`;
  } catch (_error) {
    locationSourceEl.textContent = 'Source: unavailable';
    renderLocations([]);
  }
}

function connect() {
  if (eventSource) eventSource.close();

  const params = new URLSearchParams({
    city: cityInput.value,
    lat: latInput.value,
    lon: lonInput.value,
    timezone: timezoneInput.value,
    demo: demoInput.checked ? '1' : '0'
  });

  eventSource = new EventSource(`/api/v2/stream?${params.toString()}`);
  setConnectionStatus('Connecting...');

  eventSource.addEventListener('open', () => setConnectionStatus('Connected (live)', true));
  eventSource.addEventListener('weather', (event) => render(JSON.parse(event.data)));
  eventSource.addEventListener('error', () => setConnectionStatus('Reconnecting after connection issue...'));
}

searchLocationsBtn.addEventListener('click', searchLocations);
connectBtn.addEventListener('click', connect);

searchLocations();
connect();
