// POST /api/restore { email } → { license }
// Re-issues a licence for a paid purchase made with that email (new device, cleared browser data).
// Every outcome is audited with a hash of the email, so repeated restores of one purchase show up.
//
// Known trade-off: anyone who knows a buyer's email can unlock with it. For a $5 one-time unlock that
// is accepted for now; the stronger option is to email a restore link instead (needs an email service).
import { type AuditResult, audit, hashEmail } from "./audit";
import { type CheckoutSession, type Env, configured, isPaid, json, licenseFor, stripeGet } from "./stripe";

export async function handleRestore(request: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  let email = "";
  try { email = String(((await request.json()) as { email?: unknown }).email ?? "").trim().toLowerCase(); } catch { /* bad body */ }
  const email_hash = email ? await hashEmail(email) : undefined;
  const done = async (res: Response, result: AuditResult, session_id?: string) => {
    await audit(env, { event: "license_restore", result, email_hash, session_id }, fetchFn);
    return res;
  };

  if (!configured(env)) return done(json({ error: "Unlocking isn't set up on this server." }, 503), "not_configured");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return done(json({ error: "Enter the email you used to pay." }, 400), "bad_input");
  // Stripe rejects customer_details together with payment_link, so isPaid() checks the link instead.
  const q = new URLSearchParams({ "customer_details[email]": email, status: "complete", limit: "20" });
  const list = await stripeGet<{ data: CheckoutSession[] }>(env, `checkout/sessions?${q}`, fetchFn);
  if (!list) return done(json({ error: "Couldn't check your purchase right now. Try again in a minute." }, 502), "stripe_error");
  const paid = list.data.find((s) => isPaid(s, env));
  if (!paid) return done(json({ error: "No purchase found for that email." }, 404), "not_found");
  return done(json({ license: await licenseFor(paid, env) }), "issued", paid.id);
}
