# Pin & Pedal

Production-oriented same-day mobile bicycle-repair booking and operator application for Helsinki and Espoo.

## What is real

- Google Maps location picker in the customer browser.
- Server-side Google Routes bicycle travel times, detours, route geometry, feasible slots, and prices.
- Firestore quotes, bookings, payment state, operator state, and live mechanic location.
- Private Cloud Storage photos with automatic lifecycle deletion.
- Stripe Checkout with webhook-only payment confirmation, automatic slot release after failed/expired checkout, and cancellation refunds.
- Identity Platform email/password login plus a short-lived signed, HttpOnly operator session.
- Vertex AI recommendations constrained to server-validated slots and privacy-safe marketing drafts.
- Twilio SMS, SendGrid email, and signed social-publishing adapters when their provider credentials are configured.
- OIDC-authenticated retention cleanup, Firestore TTL, structured Cloud Logging, uptime checks, and alerts.

There are no sample jobs, browser-local operational records, simulated payments, straight-line routes, or fake publish-success paths. Missing production integrations fail visibly. Customer photos are compressed in the browser to remove common metadata and are stored only in the private bucket.

## Run locally

Requires Node.js 20+ and Google Application Default Credentials for the configured project.

1. Copy `.env.example` to `.env` and fill only local/test values.
2. Run `npm ci`.
3. Run `npm test` and `npm run check`.
4. Run `npm start` and open `http://localhost:8080`.

Never commit `.env`, service-account keys, Stripe secrets, webhook secrets, Twilio tokens, or SendGrid keys. Browser Maps and Identity Platform keys are intentionally returned to the browser, but production restricts each by API and HTTP referrer.

## Production

- GCP project: `bike-app-506110`
- Cloud Run region: `europe-north1`
- Service: `helsinki-bike-rescue`
- URL: `https://helsinki-bike-rescue-972142406578.europe-north1.run.app`
- Private bucket: `bike-app-506110-pin-pedal-private`

Pushes to `main` run tests and dependency audit, build the container in GitHub Actions, push it to the scoped Artifact Registry repository, and deploy through Workload Identity Federation. GitHub has no stored GCP service-account key and no Cloud Build Editor permission.

Production readiness is exposed at `/api/readyz`. It intentionally returns 503 and names missing settings until Stripe is fully configured. Liveness is `/api/healthz`.

`ALLOWED_ORIGINS` must include every public Cloud Run or custom-domain alias that serves the browser application. Separate multiple origins with `|` so operator session creation remains CSRF-protected across aliases.

See `infrastructure/README.md` for GCP resources and provider setup.

## Privacy and operational rules

- A signed quote expires in 15 minutes and pricing is always recalculated/validated on the server.
- A transaction consumes a quote once and prevents overlapping active bookings.
- A booking is not `Booked` until a verified Stripe webhook reports payment.
- Customer access uses an unguessable per-booking token; operators use authenticated sessions.
- Customer cancellation closes 60 minutes before the appointment and refunds a captured Stripe payment automatically.
- Private data is deleted 24 hours after completion; Firestore TTL and bucket lifecycle are final safety nets.
- Marketing content is draft-first. Publishing calls a configured provider webhook and reports provider failure; it never pretends to publish.

## Required production secrets

Core GCP keys and the session-signing secret already live in Secret Manager. These provider secrets must be added before their features become ready:

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- `SENDGRID_API_KEY`, `NOTIFICATION_FROM_EMAIL`
- `SOCIAL_PUBLISH_WEBHOOK_URL`, `SOCIAL_PUBLISH_WEBHOOK_SECRET`

Use Stripe test mode for acceptance testing before providing newly rotated live credentials.
