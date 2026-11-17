// POST /api/restore { email } → { license }
// Re-issues a licence for a paid purchase made with that email (new device, cleared browser data).
//
// Known trade-off: anyone who knows a buyer's email can unlock with it. For a $5 one-time unlock that
// is accepted for now; the stronger option is to email a restore link instead (needs an email service).
import { type CheckoutSession, type Env, configured, isPaid, json, licenseFor, stripeGet } from "./_stripe";

export async function handleRestore(request: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (!configured(env)) return json({ error: "Unlocking isn't set up on this server." }, 503);
  let email = "";
  try { email = String(((await request.json()) as { email?: unknown }).email ?? "").trim().toLowerCase(); } catch { /* bad body */ }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: "Enter the email you used to pay." }, 400);
  const q = new URLSearchParams({ "customer_details[email]": email, status: "complete", limit: "20" });
  if (env.STRIPE_PAYMENT_LINK_ID) q.set("payment_link", env.STRIPE_PAYMENT_LINK_ID);
  const list = await stripeGet<{ data: CheckoutSession[] }>(env, `checkout/sessions?${q}`, fetchFn);
  const paid = list?.data.find((s) => isPaid(s, env));
  if (!paid) return json({ error: "No purchase found for that email." }, 404);
  return json({ license: await licenseFor(paid, env) });
}

export const onRequestPost = ({ request, env }: { request: Request; env: Env }) => handleRestore(request, env);
