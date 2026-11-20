// Linking a sale to the visit that led to it (docs/adr/0004-link-sales-to-visits.md).
// For visitors who accepted analytics, the Unlock button passes their PostHog visit to Stripe as the
// checkout's client_reference_id; the server reads it back and records the sale under that visit.

/** A browser visit in PostHog: the visitor's anonymous distinct id and the session id. */
export interface Visit {
  distinct_id: string;
  session_id: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REFERENCE = new RegExp(`^(${UUID})_(${UUID})$`, "i");

/** The Payment Link to open: with the visit as its reference when there is one, otherwise unchanged. */
export function checkoutLink(paymentLink: string, visit?: Visit | null): string {
  const ref = visit && `${visit.distinct_id}_${visit.session_id}`;
  if (!paymentLink || !ref || !REFERENCE.test(ref)) return paymentLink;
  const url = new URL(paymentLink);
  url.searchParams.set("client_reference_id", ref);
  return url.toString();
}

/** The visit in a Checkout Session's client_reference_id. Anyone can edit the link, so anything else is ignored. */
export function visitFromReference(ref: string | null | undefined): Visit | undefined {
  const m = REFERENCE.exec(ref ?? "");
  return m ? { distinct_id: m[1], session_id: m[2] } : undefined;
}
