# WeatherApp (Live Data) v2

Production-hardened, real-time weather dashboard with location discovery.

## Features

- Live weather fetches from Open-Meteo.
- Real-time SSE updates every 30 seconds.
- Location search by **country**, **state/province**, and **city**.
- Click-to-apply location selection that reconnects the live stream.
- Resilient fallback behavior:
  - live Open-Meteo source
  - cached snapshot on transient failures
  - simulated stream fallback when upstream is unavailable
- Production hardening:
  - request timeout protection for upstream API calls
  - secure HTTP headers
  - method validation and consistent JSON error payloads
  - structured request logging with request IDs
  - graceful shutdown support for SIGINT/SIGTERM

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

## Environment variables

- `PORT` (default: `3000`)
- `HOST` (default: `0.0.0.0`)
- `NODE_ENV` (`development` or `production`)
- `UPDATE_INTERVAL_MS` (default: `30000`)
- `FETCH_TIMEOUT_MS` (default: `8000`)

## API endpoints

- `GET /api/v2/locations?country=&state=&city=&limit=`: find locations by country/state/city.
- `GET /api/v2/weather` (also `/api/weather`): one-shot weather fetch.
- `GET /api/v2/stream` (also `/api/stream`): SSE live updates.
- `GET /api/v2/health` (also `/api/health`): app health and metadata.
