const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const APP_VERSION = '2.1.0';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPDATE_INTERVAL_MS = Number.parseInt(process.env.UPDATE_INTERVAL_MS || '30000', 10);
const HEARTBEAT_INTERVAL_MS = 15_000;
const FETCH_TIMEOUT_MS = Number.parseInt(process.env.FETCH_TIMEOUT_MS || '8000', 10);
const MAX_HISTORY_ITEMS = 20;
const MAX_LOCATION_STATE = 300;

const DEFAULT_LOCATION = {
  name: 'New York',
  latitude: 40.7128,
  longitude: -74.006,
  timezone: 'America/New_York'
};

const LOCATION_CATALOG = [
  { country: 'United States', state: 'New York', city: 'New York', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' },
  { country: 'United States', state: 'California', city: 'Los Angeles', latitude: 34.0522, longitude: -118.2437, timezone: 'America/Los_Angeles' },
  { country: 'United States', state: 'Illinois', city: 'Chicago', latitude: 41.8781, longitude: -87.6298, timezone: 'America/Chicago' },
  { country: 'United States', state: 'Texas', city: 'Dallas', latitude: 32.7767, longitude: -96.797, timezone: 'America/Chicago' },
  { country: 'Canada', state: 'Ontario', city: 'Toronto', latitude: 43.6532, longitude: -79.3832, timezone: 'America/Toronto' },
  { country: 'Canada', state: 'British Columbia', city: 'Vancouver', latitude: 49.2827, longitude: -123.1207, timezone: 'America/Vancouver' },
  { country: 'United Kingdom', state: 'England', city: 'London', latitude: 51.5072, longitude: -0.1276, timezone: 'Europe/London' },
  { country: 'Germany', state: 'Berlin', city: 'Berlin', latitude: 52.52, longitude: 13.405, timezone: 'Europe/Berlin' },
  { country: 'France', state: 'Île-de-France', city: 'Paris', latitude: 48.8566, longitude: 2.3522, timezone: 'Europe/Paris' },
  { country: 'Spain', state: 'Community of Madrid', city: 'Madrid', latitude: 40.4168, longitude: -3.7038, timezone: 'Europe/Madrid' },
  { country: 'Italy', state: 'Lazio', city: 'Rome', latitude: 41.9028, longitude: 12.4964, timezone: 'Europe/Rome' },
  { country: 'India', state: 'Maharashtra', city: 'Mumbai', latitude: 19.076, longitude: 72.8777, timezone: 'Asia/Kolkata' },
  { country: 'India', state: 'Delhi', city: 'New Delhi', latitude: 28.6139, longitude: 77.209, timezone: 'Asia/Kolkata' },
  { country: 'Japan', state: 'Tokyo', city: 'Tokyo', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' },
  { country: 'Australia', state: 'New South Wales', city: 'Sydney', latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney' },
  { country: 'Brazil', state: 'São Paulo', city: 'São Paulo', latitude: -23.5558, longitude: -46.6396, timezone: 'America/Sao_Paulo' },
  { country: 'Mexico', state: 'Ciudad de México', city: 'Mexico City', latitude: 19.4326, longitude: -99.1332, timezone: 'America/Mexico_City' },
  { country: 'South Africa', state: 'Gauteng', city: 'Johannesburg', latitude: -26.2041, longitude: 28.0473, timezone: 'Africa/Johannesburg' }
];

const stateByLocation = new Map();
const startedAt = Date.now();

function log(level, message, meta = {}) {
  const payload = { ts: new Date().toISOString(), level, message, ...meta };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

function applyCommonHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function sendJson(res, statusCode, data) {
  applyCommonHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function methodNotAllowed(res, allowed) {
  sendJson(res, 405, { error: 'Method not allowed', allowed });
}

function parseCoordinate(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= -90 && parsed <= 90 ? parsed : fallback;
}

function parseLongitude(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= -180 && parsed <= 180 ? parsed : fallback;
}

function sanitizeText(value, fallback, max = 80) {
  return (value || fallback).toString().replace(/[\n\r\t]/g, ' ').trim().slice(0, max) || fallback;
}

function resolveLocation(urlObj) {
  const q = urlObj.searchParams;
  return {
    name: sanitizeText(q.get('city') || q.get('name'), DEFAULT_LOCATION.name, 80),
    latitude: parseCoordinate(q.get('lat'), DEFAULT_LOCATION.latitude),
    longitude: parseLongitude(q.get('lon'), DEFAULT_LOCATION.longitude),
    timezone: sanitizeText(q.get('timezone'), DEFAULT_LOCATION.timezone, 60),
    demoMode: q.get('demo') === '1'
  };
}

function locationKey(location) {
  return `${location.latitude.toFixed(4)}|${location.longitude.toFixed(4)}|${location.timezone}`;
}

function pruneLocationStateIfNeeded() {
  if (stateByLocation.size < MAX_LOCATION_STATE) return;
  const firstKey = stateByLocation.keys().next().value;
  if (firstKey) {
    stateByLocation.delete(firstKey);
  }
}

function getBucket(location) {
  const key = locationKey(location);
  if (!stateByLocation.has(key)) {
    pruneLocationStateIfNeeded();
    stateByLocation.set(key, { weather: null, history: [], lastError: null, source: null, simulatedTick: 0, updatedAt: Date.now() });
  }
  const bucket = stateByLocation.get(key);
  bucket.updatedAt = Date.now();
  return bucket;
}

function weatherCodeToDescription(code) {
  const map = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle', 61: 'Slight rain', 63: 'Moderate rain',
    65: 'Heavy rain', 71: 'Slight snow fall', 73: 'Moderate snow fall', 75: 'Heavy snow fall',
    80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers', 95: 'Thunderstorm'
  };
  return map[code] || 'Unknown conditions';
}

function containsCaseInsensitive(value, query) {
  if (!query) return true;
  return (value || '').toLowerCase().includes(query.toLowerCase());
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeGeoResult(item) {
  return {
    city: item.name || '',
    state: item.admin1 || item.admin2 || '',
    country: item.country || '',
    latitude: item.latitude,
    longitude: item.longitude,
    timezone: item.timezone || 'auto'
  };
}

function filterCatalog(country, state, city) {
  return LOCATION_CATALOG
    .filter((entry) => containsCaseInsensitive(entry.country, country))
    .filter((entry) => containsCaseInsensitive(entry.state, state))
    .filter((entry) => containsCaseInsensitive(entry.city, city));
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': `WeatherApp-LiveDashboard/${APP_VERSION}` }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLocations(country, state, city, limit) {
  const combinedQuery = [city, state, country].filter(Boolean).join(', ').trim();
  const fallback = filterCatalog(country, state, city).slice(0, limit);
  if (!combinedQuery) return { locations: fallback, source: 'catalog' };

  const endpoint = new URL('https://geocoding-api.open-meteo.com/v1/search');
  endpoint.searchParams.set('name', combinedQuery);
  endpoint.searchParams.set('count', String(Math.max(limit * 3, 10)));
  endpoint.searchParams.set('language', 'en');
  endpoint.searchParams.set('format', 'json');

  try {
    const response = await fetchWithTimeout(endpoint.toString());
    if (!response.ok) throw new Error(`Geocoding failed: ${response.status}`);

    const payload = await response.json();
    const mapped = (payload.results || [])
      .map(normalizeGeoResult)
      .filter((entry) => containsCaseInsensitive(entry.country, country))
      .filter((entry) => containsCaseInsensitive(entry.state, state))
      .filter((entry) => containsCaseInsensitive(entry.city, city));

    return {
      locations: uniqueBy([...mapped, ...fallback], (entry) => `${entry.city}|${entry.state}|${entry.country}|${entry.latitude}|${entry.longitude}`).slice(0, limit),
      source: 'open-meteo-geocoding'
    };
  } catch (_error) {
    return { locations: fallback, source: 'catalog-fallback' };
  }
}

async function fetchFromOpenMeteo(location) {
  const endpoint = new URL('https://api.open-meteo.com/v1/forecast');
  endpoint.searchParams.set('latitude', location.latitude);
  endpoint.searchParams.set('longitude', location.longitude);
  endpoint.searchParams.set('current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code');
  endpoint.searchParams.set('hourly', 'temperature_2m');
  endpoint.searchParams.set('forecast_days', '1');
  endpoint.searchParams.set('timezone', location.timezone);

  const response = await fetchWithTimeout(endpoint.toString());
  if (!response.ok) throw new Error(`Open-Meteo failed: ${response.status}`);

  const payload = await response.json();
  const current = payload.current || {};
  const hourly = payload.hourly || {};

  return {
    source: 'open-meteo',
    weather: {
      location,
      timestamp: new Date().toISOString(),
      temperatureC: current.temperature_2m,
      humidityPercent: current.relative_humidity_2m,
      windKph: current.wind_speed_10m,
      weatherCode: current.weather_code,
      weatherDescription: weatherCodeToDescription(current.weather_code),
      hourlyPreview: Array.isArray(hourly.time) && Array.isArray(hourly.temperature_2m)
        ? hourly.time.slice(0, 6).map((time, i) => ({ time, temperatureC: hourly.temperature_2m[i] }))
        : []
    }
  };
}

function buildSimulatedWeather(location, bucket) {
  bucket.simulatedTick += 1;
  const now = new Date();
  const angle = bucket.simulatedTick / 3;
  const baseTemp = 18 + Math.sin(angle) * 5;
  const humidity = Math.round(55 + Math.cos(angle) * 15);
  const wind = Math.round(8 + Math.abs(Math.sin(angle * 0.8)) * 18);

  return {
    source: 'simulated',
    weather: {
      location,
      timestamp: now.toISOString(),
      temperatureC: Number(baseTemp.toFixed(1)),
      humidityPercent: humidity,
      windKph: wind,
      weatherCode: 2,
      weatherDescription: 'Simulated (offline fallback)',
      hourlyPreview: Array.from({ length: 6 }, (_, idx) => ({
        time: new Date(now.getTime() + idx * 60 * 60 * 1000).toISOString(),
        temperatureC: Number((baseTemp + Math.sin((angle + idx) / 2) * 2).toFixed(1))
      }))
    }
  };
}

async function fetchWeather(location, bucket) {
  if (location.demoMode) return buildSimulatedWeather(location, bucket);

  try {
    return await fetchFromOpenMeteo(location);
  } catch (error) {
    if (bucket.weather) {
      return {
        source: 'cached',
        weather: {
          ...bucket.weather,
          timestamp: new Date().toISOString(),
          weatherDescription: `${bucket.weather.weatherDescription} (cached due to upstream issue)`
        },
        warning: error.message
      };
    }
    return { ...buildSimulatedWeather(location, bucket), warning: error.message };
  }
}

function pushHistory(bucket, weather) {
  bucket.history.unshift({
    timestamp: weather.timestamp,
    temperatureC: weather.temperatureC,
    weatherDescription: weather.weatherDescription
  });
  bucket.history = bucket.history.slice(0, MAX_HISTORY_ITEMS);
}

async function refreshWeather(location) {
  const bucket = getBucket(location);
  const result = await fetchWeather(location, bucket);

  bucket.weather = result.weather;
  bucket.source = result.source;
  bucket.lastError = result.warning || null;
  pushHistory(bucket, result.weather);

  return {
    weather: result.weather,
    history: bucket.history,
    source: result.source,
    warning: result.warning || null
  };
}

function writeSSE(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function serveStatic(reqPath, res) {
  const safePath = reqPath === '/' ? '/index.html' : reqPath;
  const normalized = path.normalize(safePath).replace(/^\.+[\\/]/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const ext = path.extname(filePath);
    const contentType = {
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.html': 'text/html',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';

    applyCommonHeaders(res);
    res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  const urlObj = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (urlObj.pathname === '/api/v2/locations') {
      if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

      const q = urlObj.searchParams;
      const country = sanitizeText(q.get('country'), '', 60);
      const state = sanitizeText(q.get('state'), '', 60);
      const city = sanitizeText(q.get('city'), '', 60);
      const limit = Math.min(Math.max(Number.parseInt(q.get('limit') || '30', 10), 1), 100);

      const result = await fetchLocations(country, state, city, limit);
      sendJson(res, 200, result);
      return;
    }

    if (urlObj.pathname === '/api/v2/weather' || urlObj.pathname === '/api/weather') {
      if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
      const data = await refreshWeather(resolveLocation(urlObj));
      sendJson(res, 200, data);
      return;
    }

    if (urlObj.pathname === '/api/v2/health' || urlObj.pathname === '/api/health') {
      if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
      sendJson(res, 200, {
        status: 'ok',
        version: APP_VERSION,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        activeLocations: stateByLocation.size,
        updateIntervalMs: UPDATE_INTERVAL_MS,
        environment: NODE_ENV
      });
      return;
    }

    if (urlObj.pathname === '/api/v2/stream' || urlObj.pathname === '/api/stream') {
      if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

      const location = resolveLocation(urlObj);
      applyCommonHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      });

      const sendLatest = async () => {
        try {
          const data = await refreshWeather(location);
          writeSSE(res, 'weather', data);
        } catch (error) {
          writeSSE(res, 'error', { message: 'Unable to refresh weather' });
          log('warn', 'stream_refresh_failed', { requestId, error: error.message });
        }
      };

      await sendLatest();
      const intervalId = setInterval(sendLatest, UPDATE_INTERVAL_MS);
      const heartbeat = setInterval(() => res.write(': keepalive\n\n'), HEARTBEAT_INTERVAL_MS);

      req.on('close', () => {
        clearInterval(intervalId);
        clearInterval(heartbeat);
        res.end();
      });
      return;
    }

    if (req.method === 'GET') {
      serveStatic(urlObj.pathname, res);
      return;
    }

    methodNotAllowed(res, ['GET']);
  } catch (error) {
    sendJson(res, 500, { error: 'Internal server error', requestId });
    log('error', 'request_failed', { requestId, path: urlObj.pathname, error: error.message });
  } finally {
    log('info', 'request_completed', {
      requestId,
      method: req.method,
      path: urlObj.pathname,
      durationMs: Date.now() - start
    });
  }
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

const shutdownSignals = ['SIGINT', 'SIGTERM'];
shutdownSignals.forEach((signal) => {
  process.on(signal, () => {
    log('info', 'shutdown_signal_received', { signal });
    server.close(() => {
      log('info', 'server_closed');
      process.exit(0);
    });

    setTimeout(() => {
      log('error', 'forced_shutdown_timeout');
      process.exit(1);
    }, 10_000).unref();
  });
});

server.listen(PORT, HOST, () => {
  log('info', 'server_started', { version: APP_VERSION, host: HOST, port: PORT, env: NODE_ENV });
});
