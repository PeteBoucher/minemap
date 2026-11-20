// GET /api/unlock?session_id=cs_… → { license }
// Stripe's Payment Link sends buyers back to the app with the Checkout Session id; this checks with
// Stripe that the session was paid and returns a signed licence. Every outcome is audited.
import { type Visit, visitFromReference } from "../src/core/checkout";
import { type AuditResult, audit } from "./audit";
import { type CheckoutSession, type Env, configured, isPaid, json, licenseFor, stripeGet } from "./stripe";

export async function handleUnlock(request: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  const sid = new URL(request.url).searchParams.get("session_id") ?? "";
  const valid = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sid);
  let visit: Visit | undefined;
  const done = async (res: Response, result: AuditResult) => {
    await audit(env, { event: "license_unlock", result, session_id: valid ? sid : undefined, visit }, fetchFn);
    return res;
  };

  if (!configured(env)) return done(json({ error: "Unlocking isn't set up on this server." }, 503), "not_configured");
  if (!valid) return done(json({ error: "Missing or invalid session_id." }, 400), "bad_input");
  const session = await stripeGet<CheckoutSession>(env, `checkout/sessions/${sid}`, fetchFn);
  if (!session) return done(json({ error: "Couldn't find that purchase." }, 404), "not_found");
  visit = visitFromReference(session.client_reference_id);
  if (!isPaid(session, env)) return done(json({ error: "That purchase hasn't been paid." }, 402), "refused");
  return done(json({ license: await licenseFor(session, env) }), "issued");
}
