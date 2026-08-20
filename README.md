# Helsinki Bike Rescue — MVP

A local, privacy-conscious demo for an on-bike puncture repair service. It simulates customer booking, payment, operator dispatch, route planning, repair photos, and marketing-post review.

## Run it

1. Install [Node.js 18+](https://nodejs.org/).
2. In this folder, run: `npm start`
3. Open `http://localhost:3000`.

No packages, accounts, APIs, or database are needed. Data is stored in the browser's local storage, so it remains after refresh on the same browser. Use **Reset demo** in the operator dashboard to restore sample jobs.

### Optional live Stripe Checkout

The demo includes a server-side Stripe Checkout Session endpoint. To use Stripe test mode, set `STRIPE_SECRET_KEY` to a Stripe **test secret key** before running `npm start`. Without it, checkout remains a clearly labelled simulated payment. Do not put a Stripe secret key in browser code or commit it to this project. This MVP stores the booking locally before redirecting; production use needs a database plus a Stripe webhook to confirm payment before dispatch.

## MVP assumptions

- The map is a Helsinki service-area picker, not a geocoding service. Customers book solely by placing a service pin; there is no address entry.
- Payment is simulated; no money is collected.
- The route is a straight-line nearest-neighbour sequence from Kamppi. It is intended for dispatch testing, not real cycling navigation.
- Customers submit three private identification photos: the bike surroundings, the complete bike frame, and tire markings. Photo uploads remain in the local browser only. Demo jobs use placeholder illustrations.
- The MVP currently offers one same-day tier (€39). Customers choose either an in-person handover at the pin or securely provide a lock code in the private access field.
- The booking flow asks only for a phone number. It states that customer data and private repair details are destroyed after work is complete; this demo does not include an automated deletion timer.
- Marketing drafts include only public-safe fields: general Helsinki area, tire position, service tier, and the after photo. Names, phones, exact addresses, access instructions, lock codes, before photos, and any private notes are never exposed to the marketing module.
- Social publishing is intentionally a simulated approval action. The `publishPost` function is the future integration boundary for a social API.
- The scheduler seed contains four customer-present timed repairs and two flexible number-lock repairs. Quote calculations call OSRM’s public road-routing endpoint from the browser, then apply a €29 repair base plus €0.75 per estimated travel minute. The shared public endpoint is suitable for this demo only; production should use a contracted cycling-routing provider and server-side routing.

## Suggested test

Create a booking from **Book a repair**, then switch to **Operator dashboard**. Change its status, add photos, complete it, create a marketing draft, and approve it. Check **Plan route** to see active jobs ordered for the day.
