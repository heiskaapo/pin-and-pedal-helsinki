# Pin & Pedal — project handoff

## Project location

`C:\Users\aapoh\.codex\.chatgpt-projects\g-p-6a85780edd2481919b346dfb4f43227e\MobileBikeMVP`

## What this project is

A local MVP web app for a Helsinki/Espoo mobile bicycle puncture-repair service. Customers should be able to:

1. Say whether they have a key lock and must be present, or have a number lock and the repair can happen without them.
2. Place a precise bike-location pin on a map.
3. See a same-day price based on the repair’s additional travel time in the existing day route.
4. Provide three private bike-identification photos, access details, and a phone number.
5. Pay through Stripe Checkout when configured.

There is also an operator dashboard with seeded jobs, including four customer-present timed jobs and two flexible number-lock jobs.

## Run locally

Open PowerShell in the project folder and run:

```powershell
npm start
```

Then open `http://localhost:3000`.

## Configuration

The local token file is `.env` in the project root. It is intentionally excluded from Git.

- `MAPBOX_PUBLIC_TOKEN` — browser-safe Mapbox token beginning with `pk.`
- `STRIPE_SECRET_KEY` — server-only Stripe secret key

The local server exposes the Mapbox public token at `/api/config` and creates Stripe Checkout sessions at `/api/checkout`.

## Important current issue to fix first

The Mapbox map is currently not rendering reliably in the booking flow. The user has configured the Mapbox tokens. Please make the “Place your bike pin” step work end-to-end before making wider product changes.

Expected behavior:

- Mapbox map initializes only after booking step 2 is visible.
- User clicks/taps a Helsinki/Espoo location.
- A marker is placed and coordinates are stored in `#coords`.
- For key-lock repairs, the time selector becomes enabled only after the pin is placed.
- For number-lock repairs, no time selector is shown.
- The price changes based on the incremental route travel time for the selected time window or best flexible route gap.

Useful source files:

- `public/index.html` — booking-flow markup
- `public/app.js` — client behavior, routing quote, booking flow, Mapbox map
- `public/map.css` — Mapbox map layout
- `server.js` — local static server, `.env` loading, Mapbox public-token endpoint, Stripe Checkout endpoint

## Hosting note

A public Sites deployment was started previously, but its completion URL was not received. The local project has `.openai/hosting.json` and a hosted-build helper. Rebuild/redeploy only after the map works locally.

## Security notes

- Never put the Stripe secret key into browser JavaScript or committed files.
- A Mapbox public token is expected to be visible to the browser but should have URL restrictions.
- The user wants completed customer data deleted after work is complete; the current demo only displays that promise and does not yet implement a deletion job.
