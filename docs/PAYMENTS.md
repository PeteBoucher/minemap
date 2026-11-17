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

## Accounts you need

Both accounts are free to open.

- **Stripe.** Test mode works straight away. Before taking real payments, Stripe asks for identity and bank details to activate the account.
  - **Tax:** Stripe doesn't handle VAT for you. Selling digital products to EU consumers means charging VAT at the buyer's country's rate, usually by registering for the EU One-Stop Shop (OSS). Stripe Tax can calculate it, for an extra fee. Check with a tax adviser before going live.
- **Vercel.** The Hobby plan is free but limited to non-commercial use, so move to Pro (currently $20/month) before charging money.

## One-time setup

1. **Keys.** Run `npx tsx scripts/gen-license-keys.ts`.
   - Keep `LICENSE_PRIVATE_JWK` secret.
   - `VITE_LICENSE_PUBLIC_JWK` is public: it's built into the app.
2. **Vercel.** Import the GitHub repo as a new project. Vercel detects Vite, so the defaults are right: build command `npm run build`, output directory `dist`. The `api/` folder becomes the endpoints automatically.
3. **Domain: `minemap.me`** (registered in Route53, DNS stays there):
   1. In Vercel, open *Project → Settings → Domains* and add `minemap.me` and `www.minemap.me`. Make `www` redirect to the bare domain.
   2. Vercel then shows the DNS records it wants, usually an `A` record for `minemap.me` and a `CNAME` for `www`. Use the exact values it shows: they can be project-specific.
   3. In Route53, open *Hosted zones → minemap.me* and create those two records. Vercel issues the HTTPS certificate once it sees them, usually within minutes.
4. **Stripe** (in test mode first):
   1. Create a product called "Minemap unlock", priced at $5 as a one-time payment.
   2. Create a **Payment Link** for it. Under *After payment*, choose *Don't show confirmation page* and redirect to `https://minemap.me/?session_id={CHECKOUT_SESSION_ID}`.
   3. Note the link URL (`https://buy.stripe.com/test_…`), its id (`plink_…`) and the test secret key (`sk_test_…`, under *Developers → API keys*).
5. **Vercel environment variables** (*Project → Settings → Environment Variables*):

   | Name | Value | Notes |
   |---|---|---|
   | `VITE_LICENSE_PUBLIC_JWK` | from step 1 | public, used at build time |
   | `VITE_STRIPE_PAYMENT_LINK` | the Payment Link URL | public, used at build time |
   | `STRIPE_SECRET_KEY` | `sk_test_…` | mark as sensitive |
   | `LICENSE_PRIVATE_JWK` | from step 1 | mark as sensitive |
   | `STRIPE_PAYMENT_LINK_ID` | `plink_…` | optional: only this link unlocks |

   Redeploy after setting them. The `VITE_` values are built into the app.
6. **Test.** Buy with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC) and check:
   - the limits lift;
   - after clearing site data, *Already paid on another device?* with the same email unlocks again.
7. **Going live.** Activate the Stripe account. Make a live-mode product and Payment Link, then swap in the live link, its `plink_…` id and the `sk_live_…` key.

Until these are set, the unlock button is disabled and says unlocking isn't set up. The free limits still apply.

**Local testing:** `npm run dev` serves the app without the endpoints. To run both, install the Vercel CLI and run `vercel dev` with the values in `.env.local` (see `.env.example`).

## Free version limits

These are set in `src/core/license.ts` (`FREE`): 1 world of your own (the demo doesn't count), 30 places and 5 map screenshots per world. Backup export and import are paid.

## Known trade-offs

- **Restore by email:** anyone who knows a buyer's email can unlock with it. That's acceptable for a $5 unlock. The stronger fix is to email a restore link, which needs an email service.
- **No server-side enforcement:** the licence check runs in the browser, so someone determined can bypass it. Everything is stored on the device, so there's nothing on a server to protect.
- **Key rotation:** changing the key pair invalidates every licence already issued.
