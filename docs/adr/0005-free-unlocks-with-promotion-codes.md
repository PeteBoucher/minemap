# Free unlocks are Stripe promotion codes on the normal checkout

Feedback testers get the full version free. We give them Stripe promotion codes for a 100%-off coupon ("Feedback tester"), entered on the normal Payment Link checkout. There are two kinds: a personal code (`max_redemptions: 1`) and a shared code for a group, such as a school class (`max_redemptions: 30`). A code makes the total $0, so Stripe completes the checkout without asking for a card, with `payment_status: "no_payment_required"`. The server accepts that like `"paid"`: the link's price isn't zero, so a free session can only come from one of our codes. The tester returns to the app and unlocks as a buyer does, and *Already paid on another device?* works for them too.

## Considered Options

- **Sign licences ourselves with a script and send them out.** Rejected: there's no record in Stripe, restore by email wouldn't find them, and the app would need a new way to take in a licence.
- **Our own code-redemption endpoint.** Rejected: it means a store of codes and redemption counts, which Stripe already keeps.
- **A separate free Payment Link.** Rejected: anyone who had the link could unlock, with no way to limit or revoke it.

## Consequences

- Every buyer sees an "Add promotion code" field at checkout. Only our codes work.
- A shared code caps total uses at 30, not 30 different people. Stripe can't limit each person to one use without accounts.
- A licence from a code can't be revoked, like any licence. Deactivating a code in Stripe only stops new unlocks.
- `license_unlock` records `amount_total` and `promotion_code`. Sales charts must exclude `amount_total = 0`, or every code counts as a sale.
- In a sandbox, Stripe allows a $0 Payment Link order only with a checkout email containing `+no_cost_orders` (e.g. `you+no_cost_orders@example.com`). Live has no such restriction.
