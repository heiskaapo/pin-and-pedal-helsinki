# Pin & Pedal production handoff

## Current state

The application is a single Cloud Run system backed by managed GCP services. The previous browser-only demo state, fake checkout, static jobs, client-side route estimation, hardcoded shared API key, Vercel endpoints, and OpenAI Sites hosting marker have been removed.

The live revision runs as `pin-pedal-runtime@bike-app-506110.iam.gserviceaccount.com`, not the default compute account. The legacy default Editor binding and unrestricted Maps key were retired after the real quote flow passed in production.

## Architecture

- `server.js`: HTTP routing, security headers, rate limits, customer/operator/internal endpoints.
- `lib/routing.js`: Google Routes and deterministic feasibility/pricing.
- `lib/store.js`: transactional Firestore persistence and privacy projections.
- `lib/payments.js`: Stripe Checkout, signed webhooks, expiry, cancellation, and refunds.
- `lib/storage.js`: validated private photo storage and deletion.
- `lib/auth.js`: Identity Platform verification, operator session, scheduler OIDC verification.
- `lib/ai.js`: constrained Vertex AI slot recommendation and marketing draft.
- `lib/notifications.js` / `lib/social.js`: explicit external-provider adapters.
- `public/`: customer booking and authenticated operator UI.

## GCP inventory

- Cloud Run service in `europe-north1`, maximum 3 instances.
- Firestore Native in `europe-north1`; TTL field `bookings.deleteAt` is active.
- Private bucket `bike-app-506110-pin-pedal-private`, uniform access and public-access prevention, 14-day lifecycle safety net.
- Secret Manager core secrets: Maps browser key, Identity Platform browser key, Routes server key, session-cookie signing secret.
- API-restricted/referrer-restricted browser keys and API-restricted server Routes key.
- Dedicated runtime, scheduler, and GitHub deployer service accounts.
- GitHub Workload Identity provider restricted to `heiskaapo/pin-and-pedal-helsinki` on `main`.
- Daily retention job at 03:00 Europe/Helsinki in Scheduler region `europe-west1`.
- Global HTTPS uptime check plus application-error and availability alert policies.

## Still requires owner-supplied provider configuration

The service fails closed for checkout until new Stripe credentials and a webhook signing secret are stored. SMS, email, real social publishing, and the first operator account similarly require owner choices/credentials. Do not reuse the legacy live Stripe secret found in the local `.env`; rotate it in Stripe first.

After adding each secret, grant only the runtime service account Secret Accessor on that secret and map it into Cloud Run and the GitHub deploy workflow. Set `OPERATOR_ALLOWED_EMAILS` to the explicit operator allowlist.

## Verification

- `npm test`
- `npm run check`
- `npm audit --omit=dev --audit-level=high`
- `GET /api/healthz` must return 200.
- `GET /api/readyz` must return 200 only when Stripe core configuration is present.
- Submit a real quote, complete a Stripe test checkout, verify webhook-created `Booked` state, operator status notifications, cancellation refund, photo retrieval permissions, and retention deletion.

The €10 GCP budget is an alert threshold, not a hard spending cap. Maximum Cloud Run instances and restricted APIs limit exposure, but billing alerts still require operator response.
