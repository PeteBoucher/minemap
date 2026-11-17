// GET /api/unlock?session_id=cs_… → { license }
// Stripe's Payment Link sends buyers back to the app with the Checkout Session id; this checks with
// Stripe that the session was paid and returns a signed licence.
import { type CheckoutSession, type Env, configured, isPaid, json, licenseFor, stripeGet } from "./_stripe";

export async function handleUnlock(request: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (!configured(env)) return json({ error: "Unlocking isn't set up on this server." }, 503);
  const sid = new URL(request.url).searchParams.get("session_id") ?? "";
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sid)) return json({ error: "Missing or invalid session_id." }, 400);
  const session = await stripeGet<CheckoutSession>(env, `checkout/sessions/${sid}`, fetchFn);
  if (!session) return json({ error: "Couldn't find that purchase." }, 404);
  if (!isPaid(session, env)) return json({ error: "That purchase hasn't been paid." }, 402);
  return json({ license: await licenseFor(session, env) });
}

export const onRequestGet = ({ request, env }: { request: Request; env: Env }) => handleUnlock(request, env);
