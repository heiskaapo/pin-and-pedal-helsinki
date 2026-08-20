# Pin & Pedal GCP resources

Production uses one deployment target: Cloud Run in `bike-app-506110`, region `europe-north1`. Cloud Scheduler is in `europe-west1` because Scheduler is not offered in `europe-north1`.

Required resources:

- Firestore Native database for quotes, bookings, payment state, and live mechanic state.
- Private uniform-access Cloud Storage bucket for customer and completion photos.
- Identity Platform email/password authentication for operators.
- Google Routes API for authoritative bicycle travel time and distance.
- Vertex AI for bounded slot recommendations and privacy-safe draft copy.
- Secret Manager for API keys, token signing, Stripe, and optional providers.
- Cloud Scheduler for retention cleanup.
- Dedicated runtime, scheduler, and GitHub deployment service accounts.
- Workload Identity Federation for keyless GitHub Actions deployment.

The browser Maps and Identity Platform keys are public-by-design but restricted by API and HTTP referrer. Server credentials never enter browser responses.

`storage-lifecycle.json` is a final safety net. The authenticated retention endpoint deletes private data sooner after a repair is completed.

`monitoring-error-policy.json` and `monitoring-uptime-policy.json` are the deployed alert-policy definitions. Add and verify an email, SMS, Slack, or PagerDuty notification channel in Cloud Monitoring, then attach it to both policies.

The GitHub deployer can push only to the named Artifact Registry repository, deploy Cloud Run, attach only the runtime identity, view core secret metadata, and consume enabled APIs. It cannot read secret values and was deliberately not granted Cloud Build Editor.
