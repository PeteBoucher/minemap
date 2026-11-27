# Setting up the $5 unlock

Minemap has no accounts. A Stripe Payment Link takes the payment. Two small Vercel functions check the payment with Stripe and return a signed licence. The app stores the licence and checks it offline with a public key.

```text
Unlock button ──▶ Stripe Payment Link ──▶ back to /?session_id=cs_…
                                                │
app ── GET /api/unlock?session_id ──▶ api/unlock.ts ── asks Stripe "paid?" ──▶ signs licence
app ◀────────────── { license } ─────────────┘
```

Restoring on a new device works the same way: `POST /api/restore { email }` looks up a paid session for that email and signs a new licence.

- **Endpoints:** `api/unlock.ts` and `api/restore.ts`, on Vercel's Edge runtime.
- **Logic:** in `server/`, and tested without Stripe (`npm test`).

## Current setup

Minemap went live on 18 November 2026.

| | Sandbox ("Minemap sandbox") | Live |
| --- | --- | --- |
| Payment Link | `https://buy.stripe.com/test_fZu9AM2aqfeA1Ro3ac4c800` | `https://buy.stripe.com/6oU8wHfDLeme2DJ96Z4sE00` |
| Link id | `plink_1Ucox323L6ObqQbB4esNXqTJ` | `plink_1Ud5lZ0anzcSxhsvGbi7pWqi` |
| Product | Minemap unlock, `txcd_10103001`, $5 tax-inclusive | same, created by hand |
| Used by | Vercel *Preview*, `.env.local`, the e2e test | Vercel *Production* |

Audit events carry `deploy_env` (`production` or `preview`), so sandbox runs on Previews never mix with real sales.

- **Domain:** `minemap.me` is the main address. `www.minemap.me` redirects to it with a 301 that keeps `?session_id=`.
- **Audit trail:** the PostHog project "Default project" (EU, id `139417`).

## Accounts you need

- **Stripe, with Managed Payments.** Test mode works straight away. Before taking real payments, Stripe asks for identity and bank details to activate the account.
  - **Managed Payments makes Stripe the merchant of record.** Stripe is then liable for VAT and sales tax worldwide and handles fraud, disputes and buyer support, for an extra 3.5% per sale. On a $5 sale that's roughly $0.50–0.65 in total fees, more for international cards.
  - **Without it**, you would have to charge and file EU VAT yourself (One-Stop Shop registration), so keep it on.
  - Buyers' card statements show `LINK.COM* <your statement descriptor>`, and their receipts say "Sold through Link".
- **Vercel Pro** (currently $20/month). The free Hobby plan doesn't allow commercial use.
- **PostHog** (optional), for the audit trail.

## One-time setup

1. **Licence keys.** Run `npx tsx scripts/gen-license-keys.ts` once.
   - It prints `VITE_LICENSE_PUBLIC_JWK` (public, built into the app) and `LICENSE_PRIVATE_JWK` (secret). They are a pair: never generate one on its own, or every licence will fail to verify.
   - Save both lines in `.env.local` as printed, since Vercel won't show a sensitive value again. When pasting into Vercel, leave out the surrounding single quotes. Vercel would keep them, and the key would no longer read as JSON.
2. **Vercel.** Import the GitHub repo as a new project. Vercel detects Vite, so the defaults are right: build command `npm run build`, output directory `dist`. The `api/` folder becomes the endpoints automatically.
3. **Domain: `minemap.me`** (registered in Route53, DNS stays there):
   1. In Vercel, open *Project → Settings → Domains* and add `minemap.me` and `www.minemap.me`. Make `minemap.me` the primary and `www` redirect to it.
   2. Vercel then shows the DNS records it wants, usually an `A` record for `minemap.me` and a `CNAME` for `www`. Use the exact values it shows: they can be project-specific.
   3. In Route53, open *Hosted zones → minemap.me* and create those two records. Vercel issues the HTTPS certificate once it sees them, usually within minutes.
   - Getting the direction right matters. Each hostname keeps its own browser storage, so a licence saved on `www` isn't visible on the bare domain.
4. **Stripe sandbox:**
   1. Turn on **Managed Payments**.
   2. Create a product called "Minemap unlock":
      - **Price:** $5, one-time.
      - **Tax included in the price** (*Include tax in price: Yes*, `tax_behavior: inclusive`). Buyers then pay exactly $5 everywhere, and VAT comes out of that. Without it, Stripe adds tax on top, so a Spanish buyer would pay $6.05.
      - **Tax code:** one labelled "Eligible for Managed Payments". We use `txcd_10103001`, Software as a service (SaaS), personal use.
   3. Create a **Payment Link** for it:
      - **Managed Payments:** enabled.
      - **After payment:** choose *Don't show confirmation page* and redirect to `https://minemap.me/?session_id={CHECKOUT_SESSION_ID}`. Type the braces exactly. **Without this redirect, buyers pay but never get back to the app.**
      - **Billing address:** *auto* (`billing_address_collection: auto`; in the Dashboard, *Collect customers' addresses* off). Stripe then asks only for what tax needs, the country and sometimes a postcode. Don't use *required*: it adds a street field with Google address suggestions that won't let buyers enter a street Google doesn't know.
      - **Shipping:** none.
      - Managed Payments turns on automatic tax itself, with Stripe as the liable party, so the link shows it as on. That's expected.
   4. Create a **restricted key** (*Developers → API keys → Create restricted key*) with **Checkout Sessions: Read** and every other permission set to *None*.
      - The server only makes two Stripe calls: it retrieves one session in `/api/unlock` and lists sessions by email in `/api/restore`.
      - If the key leaks, it can only read checkout sessions. It can't charge, refund or change anything.
5. **Vercel environment variables** (*Project → Settings → Environment Variables*):

   | Name | Value | Notes |
   | --- | --- | --- |
   | `VITE_LICENSE_PUBLIC_JWK` | from step 1 | public, used at build time |
   | `VITE_STRIPE_PAYMENT_LINK` | the Payment Link URL | public, used at build time |
   | `STRIPE_SECRET_KEY` | the restricted key (`rk_…`) from step 4 | mark as sensitive |
   | `LICENSE_PRIVATE_JWK` | from step 1 | mark as sensitive |
   | `STRIPE_PAYMENT_LINK_ID` | `plink_…` | only this link unlocks. Needed for promotion codes: without it, free checkouts never unlock |
   | `POSTHOG_KEY` | PostHog project API key (`phc_…`) | optional: turns on the audit trail. It's an ingestion-only key, so it doesn't need to be sensitive. |
   | `POSTHOG_HOST` | `https://eu.i.posthog.com` | optional: the default |
   | `VITE_POSTHOG_KEY` | the same `phc_…` key | optional: real user monitoring in the app, only after a visitor accepts the banner ([ADR 0002](adr/0002-analytics-only-after-consent.md)). Without it there's no banner. Public, used at build time. |

   - **Scope:** set the Stripe values per environment. Live values go on *Production*; sandbox values go on *Preview* (see [End-to-end test](#end-to-end-test)).
   - **Redeploy after any change, with "Use existing build cache" unticked.** The `VITE_` values are built into the app's JavaScript, so a redeploy that reuses the cache keeps the old ones.
6. **Test in the sandbox:**
   - Run the end-to-end test (`npm run e2e:purchase`, see below).
   - Or buy by hand with test card `4242 4242 4242 4242` (any future date, any CVC). Check that the limits lift, and that after clearing site data, *Already paid on another device?* with the same email unlocks again.
7. **Going live** (see [Going live](#going-live)).

Until steps 1 and 5 are done, the unlock button is disabled and says unlocking isn't set up. The free limits still apply.

**Local testing:** `npm run dev` serves the app without the endpoints. To run both, install the Vercel CLI and run `vercel dev` with the values in `.env.local` (see `.env.example`).

## Going live

1. **Activate the Stripe account** with business details, identity, a bank account for payouts and a statement descriptor.
2. **Set up the live product and Payment Link.** Stripe can copy the sandbox's product and link into live mode, which is the safest option. If you build them by hand instead, they must match step 4 exactly. Check in particular:
   - [ ] tax included in the price;
   - [ ] the eligible tax code;
   - [ ] Managed Payments on for the link;
   - [ ] billing address *auto*, not *required*;
   - [ ] **the *After payment* redirect to `https://minemap.me/?session_id={CHECKOUT_SESSION_ID}`.**

   In live mode, Managed Payments can only be turned on once a product exists, so create the product first.
3. **Create a live restricted key**, with Checkout Sessions: Read only.
4. **Switch Vercel's Production values** for `VITE_STRIPE_PAYMENT_LINK`, `STRIPE_PAYMENT_LINK_ID` and `STRIPE_SECRET_KEY`, and leave Preview on the sandbox. Redeploy without the build cache.
5. **Check with real money:**
   - Make a purchase in a private window. You should land back on minemap.me with "Unlocked — thank you!".
   - Clear site data and do a restore by email. That exercises both Stripe calls with the live key.
   - Both audit rows should show `result: issued` and `livemode: true`.
   - Then refund the payments (see below).

The live checkout lets buyers choose their local currency. A Spanish buyer sees, for example, **€4.74 or US$5.00**. The euro price is $5 converted, plus a conversion fee of about 4% that the buyer pays (Adaptive Pricing, turned on by Managed Payments). The sandbox doesn't show this.

## Free unlocks for testers

Testers get the full version with a promotion code for the 100%-off coupon "Feedback tester", entered at the normal checkout ([ADR 0005](adr/0005-free-unlocks-with-promotion-codes.md)). The checkout totals $0, Stripe skips the card step, and the app unlocks as for a sale.

- **Set up once per mode:** in *Product catalog → Coupons*, create a coupon: *Percentage discount* 100%, *Duration* once, named "Feedback tester". Then, on the Payment Link, turn on *Allow promotion codes*. `STRIPE_PAYMENT_LINK_ID` must be set, or code checkouts won't unlock.
- **A code per person:** on the coupon, *Add promotion code*, with a code such as `MINEMAP-ALEX` and *Limit the number of times this code can be redeemed* set to 1.
- **A code for a group** (a class, a club): the same, limited to 30. That's 30 uses in total, not one per person.
- **To stop a code:** archive it (in the API, `active: false`). Licences already issued keep working, and a tester can restore theirs by email like any buyer.
- **Where they show:** Stripe lists free orders under [No-cost orders](https://dashboard.stripe.com/no-cost-orders) (the page appears after the first one). In PostHog, `license_unlock` has `amount_total: 0` and the `promotion_code` id.
- **Sandbox:** Stripe allows a $0 order on a sandbox Payment Link only when the checkout email contains `+no_cost_orders`, for example `you+no_cost_orders@example.com`.

The sandbox has `TEST-PERSON` (1 use) and `TEST-CLASS` (30 uses).

## Running it

- **Where payments appear:** in the Stripe Dashboard under ***Transactions***. *Payments → Payment Analytics* can show nothing for recent sales, because its charts update with a delay.
- **Refunds:** open the payment under *Transactions* and click *Refund*.
  - The buyer gets the full amount back in the currency they paid, tax included.
  - In some countries Stripe still has to pay the original tax, so your balance goes down by that amount too.
  - Buyers can also ask Link support for refunds, and Stripe may refund within 60 days without asking you. It contacts you first when it needs product-specific input, so keep the support email in *Settings → Business details* up to date.
- **Refunds don't revoke licences.** Licences are checked offline and never expire, so a refunded buyer stays unlocked.
- **Disputes** are handled by Stripe and appear under *Disputes*.

## Audit trail

Stripe is the record of payments, refunds and tax. With `POSTHOG_KEY` set, the endpoints also send one PostHog event per request, so you can see every licence issued or refused:

- **`license_unlock`:** `result` (`issued`, `refused`, `not_found`, `bad_input`, `not_configured`), `session_id`, `livemode`, `deploy_env` (`production`, `preview`; events from before 18 November 2026 don't have it), and when issued, `amount_total` (in the smallest unit of `currency`, which is the buyer's own with Adaptive Pricing; `0` for a free promotion code), `currency`, and `promotion_code` (`promo_…`) if one was used. Count sales with `amount_total` above 0 or not set (it isn't on events from before the codes).
- **`license_restore`:** the same results plus `stripe_error`, with `email_hash` (SHA-256 of the lower-cased email, never the email itself) and, when issued, the `session_id` that was restored.

The `session_id` links each event to the Checkout Session in Stripe, and `livemode` separates real sales from tests. When the buyer accepted analytics, the app passes their visit to Stripe as the Payment Link's `client_reference_id`. `license_unlock` is then recorded under that visitor's `distinct_id`, with the visit's `$session_id`, so PostHog can break sales down by campaign ([ADR 0004](adr/0004-link-sales-to-visits.md)). Otherwise `distinct_id` is the checkout id. Events are sent without person profiles. A PostHog outage never blocks an unlock: the event is just lost. Events take a minute or two to become queryable.

Two saved queries are worth keeping in PostHog (*SQL editor → Save as insight*, then put both on a "Licence audit" dashboard):

```sql
-- Licence audit trail: every unlock and restore, newest first
SELECT timestamp, event,
       properties.result AS result,
       properties.session_id AS session_id,
       properties.livemode AS livemode,
       properties.deploy_env AS deploy_env,
       properties.email_hash AS email_hash
FROM events
WHERE event IN ('license_unlock', 'license_restore')
  AND timestamp >= now() - INTERVAL 90 DAY
  AND coalesce(properties.deploy_env, 'production') != 'preview'  -- hide e2e runs on Previews
ORDER BY timestamp DESC
LIMIT 1000
```

```sql
-- Purchases restored more than 3 times in 90 days (possible shared or abused email)
SELECT properties.session_id AS session_id,
       countIf(properties.result = 'issued') AS restores_issued,
       uniq(properties.email_hash) AS distinct_emails,
       min(timestamp) AS first_restore,
       max(timestamp) AS last_restore
FROM events
WHERE event = 'license_restore'
  AND timestamp >= now() - INTERVAL 90 DAY
  AND properties.result = 'issued'
  AND coalesce(properties.deploy_env, 'production') != 'preview'
GROUP BY session_id
HAVING restores_issued > 3
ORDER BY restores_issued DESC
LIMIT 100
```

The second query should stay empty. If it isn't, the restore-by-email trade-off below is probably being abused.

## End-to-end test

```sh
E2E_BASE_URL=https://<preview deployment> npm run e2e:purchase
```

[scripts/e2e-purchase.ts](../scripts/e2e-purchase.ts) checks a sandbox purchase end to end, against a **Vercel Preview deployment**. minemap.me runs on live keys and can't see sandbox sessions, so the script refuses it.

1. **In the browser** (Playwright): it pays through the real sandbox Payment Link with Spain as the billing country. The link redirects to `minemap.me/?session_id=…`, and inside the script's browser only, that redirect is rerouted to the Preview. It then checks that the Preview's `/api/unlock` returns a licence and that the app stores it.
2. **In Stripe:** the session is complete and paid; the total is exactly $5.00 with IVA inside it; Managed Payments is on; it came from our link; it was billed to Spain.
3. **In PostHog:** a `license_unlock` event with result `issued` and `deploy_env: preview` arrives for the session. This step needs `POSTHOG_PERSONAL_API_KEY` (`phx_…` with `query:read`) and is skipped without it.

**What it needs:**

- **Vercel Preview environment variables:** the sandbox values for `VITE_STRIPE_PAYMENT_LINK`, `STRIPE_PAYMENT_LINK_ID` and `STRIPE_SECRET_KEY` (a test key, ideally restricted to Checkout Sessions: Read). It also needs `VITE_LICENSE_PUBLIC_JWK`, `LICENSE_PRIVATE_JWK` and `POSTHOG_KEY`, which can be the same as Production. Redeploy the Preview after setting them.
- **In `.env.local`:**
  - `STRIPE_SECRET_KEY`, a test key, which the script uses to check the session;
  - `STRIPE_PAYMENT_LINK_ID`, the sandbox link;
  - `VERCEL_AUTOMATION_BYPASS_SECRET`, from *Project → Settings → Deployment Protection → Protection Bypass for Automation*. Vercel Pro protects Previews with a login, and the script sends this secret only to the Preview, never to Stripe.
- **A Preview URL:** any Preview deployment works. The branch URL (`minemap-git-<branch>-<team>.vercel.app`) stays the same across pushes.

**In CI:** [.github/workflows/e2e-preview.yml](../.github/workflows/e2e-preview.yml) runs the test on every pull request into `main`. It waits for Vercel's Preview of the PR (the "Vercel" commit status), then tests the branch URL `minemap-git-<branch>-petebouchers-projects.vercel.app`. Make *e2e purchase on Preview* a required check on `main` so a PR can't be merged until it passes. It needs these repository settings (*Settings → Secrets and variables → Actions*):

| Kind | Name | Value |
| --- | --- | --- |
| secret | `E2E_STRIPE_SECRET_KEY` | a sandbox restricted key (`rk_test_…`) with **Checkout Sessions: Read** and **Payment Links: Read** (the script checks the link first) |
| secret | `VERCEL_AUTOMATION_BYPASS_SECRET` | the same bypass secret as in `.env.local` |
| secret | `POSTHOG_PERSONAL_API_KEY` | optional: turns on the audit-event check |
| variable | `E2E_STRIPE_PAYMENT_LINK_ID` | `plink_1Ucox323L6ObqQbB4esNXqTJ` |

Each run makes one sandbox purchase. Pull requests from forks are skipped, because they don't get secrets. Branch names need to stay short (up to about 29 characters): Vercel shortens longer Preview hostnames, and the workflow fails with a clear message if that happens.

The script refuses live keys and live links. Set `E2E_HEADED=1` to watch the browser. On a failure, it saves a screenshot and prints its path.

Things that look like bugs but aren't:

- It uses Playwright's full Chromium browser (`channel: "chromium"`). With the default stripped-down headless browser, Stripe's checkout silently ignores the Pay click.
- It fills only the address fields Checkout shows, so it works whether the link collects addresses on *auto* or *required*. It prints which fields it saw.
- It waits a moment before clicking Pay, because Stripe recalculates tax after the address is entered, and a click during that is ignored. Stripe's page never goes network-idle, so the wait is a fixed pause. If Pay is still ignored, it clicks again (up to 3 times); a session can't be paid twice.
- With *required*, typing the street can open Google address suggestions over the form. The script closes them with Escape *in the street field*: an Escape sent to the page goes to whichever field has focus and leaves them open.
- The app removes `?session_id=` from the address bar straight away, so the script reads the session id from the app's call to `/api/unlock`.

## Troubleshooting

| What you see | Cause and fix |
| --- | --- |
| "Unlocking isn't set up on this copy of Minemap yet." | The build has no `VITE_STRIPE_PAYMENT_LINK`, or `VITE_LICENSE_PUBLIC_JWK` is missing or isn't valid JSON (for example because of stray quotes). Set both for the right environment and redeploy without the build cache. If the variables are right, the browser is running an old build: hard-reload. |
| Payment succeeds, but the buyer stays on Stripe's page | The Payment Link has no *After payment* redirect. Edit the link (the URL and `plink_` id stay the same). The buyer can unlock now with *Already paid on another device?* and their email. |
| "No purchase found for that email." | Stripe was reached, but no paid session from our link has that email. Usually it's a different email from the one entered at checkout. |
| "Couldn't check your purchase right now." | Stripe refused the request. Check that the key has *Checkout Sessions: Read* and was pasted in full. Stripe also rejects searching by email and Payment Link together, which is why `isPaid()` checks the link after the search. |
| "Couldn't find that purchase." | The session id isn't one Stripe knows with this key, for example a sandbox session on a live deployment. |
| No payments in Payment Analytics | Look under *Transactions*. |

## Free version limits

These are set in `src/core/license.ts` (`FREE`): 1 world of your own (the demo doesn't count), 30 places and 5 map screenshots per world. Backup export and import are paid.

## Known trade-offs

- **Restore by email:** anyone who knows a buyer's email can unlock with it. That's acceptable for a $5 unlock, and the second audit query watches for abuse. The stronger fix is to email a restore link, which needs an email service.
- **No server-side enforcement:** the licence check runs in the browser, so someone determined can bypass it. Everything is stored on the device, so there's nothing on a server to protect.
- **No revocation:** licences don't expire and refunds don't take them back.
- **Key rotation:** changing the key pair invalidates every licence already issued.
