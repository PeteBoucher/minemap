import { beforeAll, describe, expect, it } from "vitest";
import { generateLicenseKeys, verifyLicense } from "../src/core/license";
import type { CheckoutSession, Env } from "./stripe";
import { handleRestore } from "./restore";
import { handleUnlock } from "./unlock";

let env: Env, publicJwk: JsonWebKey;
beforeAll(async () => {
  const k = await generateLicenseKeys();
  publicJwk = k.publicJwk;
  env = { STRIPE_SECRET_KEY: "sk_test_x", LICENSE_PRIVATE_JWK: JSON.stringify(k.privateJwk), STRIPE_PAYMENT_LINK_ID: "plink_ours" };
});

const session = (over: Partial<CheckoutSession> = {}): CheckoutSession => ({
  id: "cs_test_abcdefghijkl", status: "complete", payment_status: "paid", payment_link: "plink_ours",
  customer_details: { email: "buyer@example.com" }, ...over,
});

/** A fake Stripe API that records the requests it gets. */
function fakeStripe(routes: Record<string, unknown>) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    const path = url.replace("https://api.stripe.com/v1/", "");
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    return key ? new Response(JSON.stringify(routes[key])) : new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const unlock = (sid: string, f: typeof fetch, e = env) => handleUnlock(new Request(`https://app.test/api/unlock?session_id=${sid}`), e, f);

describe("GET /api/unlock", () => {
  it("returns a valid licence for a paid session", async () => {
    const { fetchFn, calls } = fakeStripe({ "checkout/sessions/cs_test_abcdefghijkl": session() });
    const r = await unlock("cs_test_abcdefghijkl", fetchFn);
    expect(r.status).toBe(200);
    const { license } = (await r.json()) as { license: string };
    expect(await verifyLicense(license, publicJwk)).toMatchObject({ email: "buyer@example.com", sid: "cs_test_abcdefghijkl" });
    expect(calls[0].auth).toBe("Bearer sk_test_x");
  });

  it("refuses unpaid sessions and sessions from another payment link", async () => {
    expect((await unlock("cs_test_abcdefghijkl", fakeStripe({ "checkout/sessions/": session({ payment_status: "unpaid" }) }).fetchFn)).status).toBe(402);
    expect((await unlock("cs_test_abcdefghijkl", fakeStripe({ "checkout/sessions/": session({ payment_link: "plink_other" }) }).fetchFn)).status).toBe(402);
  });

  it("refuses unknown and malformed session ids without asking Stripe about bad input", async () => {
    expect((await unlock("cs_test_abcdefghijkl", fakeStripe({}).fetchFn)).status).toBe(404);
    const { fetchFn, calls } = fakeStripe({});
    expect((await unlock("../../customers", fetchFn)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("says when the server isn't configured", async () => {
    expect((await unlock("cs_test_abcdefghijkl", fakeStripe({}).fetchFn, { ...env, STRIPE_SECRET_KEY: "" })).status).toBe(503);
  });
});

describe("POST /api/restore", () => {
  const restore = (body: unknown, f: typeof fetch) =>
    handleRestore(new Request("https://app.test/api/restore", { method: "POST", body: JSON.stringify(body) }), env, f);

  it("re-issues a licence for a paid purchase with that email", async () => {
    const { fetchFn, calls } = fakeStripe({ "checkout/sessions?": { data: [session({ payment_status: "unpaid", id: "cs_test_unpaid000000" }), session()] } });
    const r = await restore({ email: " Buyer@Example.com " }, fetchFn);
    expect(r.status).toBe(200);
    const { license } = (await r.json()) as { license: string };
    expect(await verifyLicense(license, publicJwk)).toMatchObject({ sid: "cs_test_abcdefghijkl" });
    const q = new URL(calls[0].url).searchParams;
    expect(q.get("customer_details[email]")).toBe("buyer@example.com");
    expect(q.get("payment_link")).toBe("plink_ours");
  });

  it("finds nothing for an email without a purchase, and rejects bad input", async () => {
    expect((await restore({ email: "nobody@example.com" }, fakeStripe({ "checkout/sessions?": { data: [] } }).fetchFn)).status).toBe(404);
    expect((await restore({ email: "not-an-email" }, fakeStripe({}).fetchFn)).status).toBe(400);
  });
});
