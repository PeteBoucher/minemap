# Setting up the $5 unlock

Minemap has no accounts. A Stripe Payment Link takes the payment. A small Cloudflare Pages Function checks the payment with Stripe and returns a signed licence. The app stores the licence and checks it offline with a public key.

```text
Unlock button ──▶ Stripe Payment Link ──▶ back to /?session_id=cs_…
                                                │
app ── GET /api/unlock?session_id ──▶ function ── asks Stripe "paid?" ──▶ signs licence
app ◀────────────── { license } ─────────┘
```

Restoring on a new device works the same way: `POST /api/restore { email }` looks up a paid session for that email and signs a new licence.

## One-time setup

1. **Keys.** Run `npx tsx scripts/gen-license-keys.ts`.
   - Keep `LICENSE_PRIVATE_JWK` secret.
   - `VITE_LICENSE_PUBLIC_JWK` is public: it's built into the app.
2. **Stripe** (use test mode first):
   1. Create a product called "Minemap unlock", priced at $5 as a one-time payment.
   2. Create a **Payment Link** for it. Under *After payment*, choose *Don't show confirmation page* and redirect to `https://<your-domain>/?session_id={CHECKOUT_SESSION_ID}`.
   3. Note the link URL (`https://buy.stripe.com/…`), its id (`plink_…`) and your secret key (`sk_test_…`).
3. **Cloudflare Pages**: connect the GitHub repo. Use build command `npm run build` and output directory `dist`. The `functions/` folder is deployed automatically.
   - Build variables: `VITE_LICENSE_PUBLIC_JWK` and `VITE_STRIPE_PAYMENT_LINK`.
   - Secrets: `STRIPE_SECRET_KEY`, `LICENSE_PRIVATE_JWK` and `STRIPE_PAYMENT_LINK_ID`.
4. **Test.** Buy with Stripe's test card `4242 4242 4242 4242` and check:
   - the limits lift;
   - after clearing site data, *Already paid on another device?* with the same email unlocks again.

Until these are set, the unlock button is disabled and says unlocking isn't set up. The free limits still apply.

## Free version limits

These are set in `src/core/license.ts` (`FREE`): 1 world of your own (the demo doesn't count), 30 places and 5 map screenshots per world. Backup export and import are paid.

## Known trade-offs

- **Restore by email:** anyone who knows a buyer's email can unlock with it. That's acceptable for a $5 unlock. The stronger fix is to email a restore link, which needs an email service.
- **No server-side enforcement:** the licence check runs in the browser, so someone determined can bypass it. Everything is stored on the device, so there's nothing on a server to protect.
- **Key rotation:** changing the key pair invalidates every licence already issued.
