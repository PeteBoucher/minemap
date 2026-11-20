# A sale is linked to the visit that led to it, through Stripe's client_reference_id

To see which campaigns lead to sales, each sale needs to be linked to the visit that led to it. For a visitor who accepted analytics, the *Unlock for $5* button adds `?client_reference_id=<PostHog distinct id>_<PostHog session id>` to the Payment Link. Both are random UUIDs that PostHog generated. Stripe stores the reference on the Checkout Session. `/api/unlock` reads it from the session it already fetches and records the issued `license_unlock` under that visitor, with `$session_id` set to that visit. PostHog then attributes the sale to the visit's entry channel, referrer and campaign tags, and links it to the visit's replay. `session_id` (the checkout id) stays on the event, so the audit trail and the e2e check are unchanged.

A visitor who declined or never answered gets the plain link, so Stripe receives nothing about them and their sale is recorded under the checkout id as before. The server accepts only the exact `<uuid>_<uuid>` format: anyone can edit the link, so anything else is ignored. The browser reads the visit when the unlock dialog opens and drops it if the visitor declines before clicking. A forged reference can only mis-attribute a sale in our own analytics. It never affects the licence.

## Considered Options

- **Record the purchase in the browser when the buyer returns.** Rejected: the sale is lost if the buyer closes the tab before Stripe redirects back, and the link has to work even then. It also adds a second purchase event to keep consistent with `license_unlock`.
- **Send UTM tags as Checkout Session metadata.** Not possible: a Payment Link takes only `client_reference_id` (and prefill fields) from its URL. Metadata would require creating Checkout Sessions on our server.
- **Use only the distinct id.** Rejected: without the session id, PostHog can't tie the sale to the visit's campaign tags or replay. A buyer's first visit and the visit where they bought can come from different campaigns.

## Consequences

- The PostHog visitor id is stored in Stripe with the buyer's email, which links an otherwise pseudonymous analytics visitor to a named buyer. That happens only with consent, and the banner says so: Stripe is given the visitor's analytics id. Deleting a buyer's data means deleting it in both places.
- Sales from visitors who didn't accept analytics have no visit. A "sales by campaign" chart is a lower bound, like the visitor counts (ADR 0002).
- `license_unlock` events no longer all have the checkout id as `distinct_id`. Count sales with `total` (or unique `properties.session_id`), not unique users.
- Refused unlocks and restores aren't linked: only a sale is attributed, and a restoring visit isn't where the sale came from.
