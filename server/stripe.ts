// Stripe helpers for the unlock endpoints (api/unlock.ts, api/restore.ts).
import { type License, signLicense } from "../src/core/license";

export interface Env {
  /** Stripe secret key (sk_test_… or sk_live_…). */
  STRIPE_SECRET_KEY: string;
  /** Private JWK (JSON) for signing licences; generate with scripts/gen-license-keys.ts. */
  LICENSE_PRIVATE_JWK: string;
  /** Only sessions from this Payment Link (plink_…) unlock, if set. */
  STRIPE_PAYMENT_LINK_ID?: string;
}

export interface CheckoutSession {
  id: string;
  status: string;
  payment_status: string;
  payment_link: string | null;
  customer_details: { email: string | null } | null;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function stripeGet<T>(env: Env, path: string, fetchFn: typeof fetch = fetch): Promise<T | null> {
  const r = await fetchFn(`https://api.stripe.com/v1/${path}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  return r.ok ? ((await r.json()) as T) : null;
}

/** A completed, paid session from our Payment Link. */
export const isPaid = (s: CheckoutSession, env: Env) =>
  s.status === "complete" && s.payment_status === "paid" && (!env.STRIPE_PAYMENT_LINK_ID || s.payment_link === env.STRIPE_PAYMENT_LINK_ID);

export async function licenseFor(s: CheckoutSession, env: Env): Promise<string> {
  const lic: License = { v: 1, email: s.customer_details?.email ?? "", sid: s.id, iat: Date.now() };
  return signLicense(lic, JSON.parse(env.LICENSE_PRIVATE_JWK));
}

export const configured = (env: Env) => !!env.STRIPE_SECRET_KEY && !!env.LICENSE_PRIVATE_JWK;

/** Server configuration from environment variables (set them in the Vercel project, or .env.local for `vercel dev`). */
export function envFromProcess(): Env {
  const e = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
  return {
    STRIPE_SECRET_KEY: e.STRIPE_SECRET_KEY ?? "",
    LICENSE_PRIVATE_JWK: e.LICENSE_PRIVATE_JWK ?? "",
    STRIPE_PAYMENT_LINK_ID: e.STRIPE_PAYMENT_LINK_ID || undefined,
  };
}
