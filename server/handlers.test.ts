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
    const { fetchFn, calls } = fakeStripe({ "checkout/sessions?": { data: [
      session({ payment_status: "unpaid", id: "cs_test_unpaid000000" }),
      session({ payment_link: "plink_other", id: "cs_test_otherlink000" }),
      session(),
    ] } });
    const r = await restore({ email: " Buyer@Example.com " }, fetchFn);
    expect(r.status).toBe(200);
    const { license } = (await r.json()) as { license: string };
    expect(await verifyLicense(license, publicJwk)).toMatchObject({ sid: "cs_test_abcdefghijkl" });
    const q = new URL(calls[0].url).searchParams;
    expect(q.get("customer_details[email]")).toBe("buyer@example.com");
    // Stripe refuses customer_details combined with payment_link, so the link is checked here instead.
    expect(q.has("payment_link")).toBe(false);
  });

  it("reports a Stripe error instead of saying there's no purchase", async () => {
    const failing = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    expect((await restore({ email: "buyer@example.com" }, failing)).status).toBe(502);
  });

  it("finds nothing for an email without a purchase, and rejects bad input", async () => {
    expect((await restore({ email: "nobody@example.com" }, fakeStripe({ "checkout/sessions?": { data: [] } }).fetchFn)).status).toBe(404);
    expect((await restore({ email: "not-an-email" }, fakeStripe({}).fetchFn)).status).toBe(400);
  });
});

describe("audit trail", () => {
  const audited = { POSTHOG_KEY: "phc_test", POSTHOG_HOST: "https://ph.test/", VERCEL_ENV: "preview" };
  /** Stripe routes plus a PostHog capture endpoint; returns the captured events. */
  function withPostHog(routes: Record<string, unknown>, posthogUp = true) {
    const events: Record<string, any>[] = [];
    const stripe = fakeStripe(routes).fetchFn;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (!url.startsWith("https://ph.test/")) return stripe(url, init);
      if (!posthogUp) throw new Error("PostHog down");
      expect(url).toBe("https://ph.test/i/v0/e/");
      events.push(JSON.parse(String(init?.body)));
      return new Response("{}");
    }) as typeof fetch;
    return { fetchFn, events };
  }

  it("records issued and refused unlocks with the session id", async () => {
    const ok = withPostHog({ "checkout/sessions/": session() });
    await unlock("cs_test_abcdefghijkl", ok.fetchFn, { ...env, ...audited });
    expect(ok.events[0]).toMatchObject({ api_key: "phc_test", event: "license_unlock", distinct_id: "cs_test_abcdefghijkl",
      properties: { result: "issued", session_id: "cs_test_abcdefghijkl", livemode: false, deploy_env: "preview", $process_person_profile: false } });

    const unpaid = withPostHog({ "checkout/sessions/": session({ payment_status: "unpaid" }) });
    await unlock("cs_test_abcdefghijkl", unpaid.fetchFn, { ...env, ...audited });
    expect(unpaid.events[0].properties.result).toBe("refused");
  });

  it("records a sale under the visit that started checkout, when the buyer accepted analytics", async () => {
    const visitor = "019a8f2e-1c3b-7d4e-9f00-123456789abc", visit = "019a8f2e-5555-7aaa-8bbb-cccccccccccc";
    const ok = withPostHog({ "checkout/sessions/": session({ client_reference_id: `${visitor}_${visit}` }) });
    await unlock("cs_test_abcdefghijkl", ok.fetchFn, { ...env, ...audited });
    expect(ok.events[0]).toMatchObject({ distinct_id: visitor,
      properties: { result: "issued", session_id: "cs_test_abcdefghijkl", $session_id: visit, $process_person_profile: false } });
  });

  it("ignores a missing or tampered checkout reference", async () => {
    for (const ref of [null, "", "not-a-visit", "019a8f2e-1c3b-7d4e-9f00-123456789abc", "<script>_x", "a".repeat(36) + "_" + "b".repeat(36) + "_extra"]) {
      const r = withPostHog({ "checkout/sessions/": session({ client_reference_id: ref }) });
      await unlock("cs_test_abcdefghijkl", r.fetchFn, { ...env, ...audited });
      expect(r.events[0].distinct_id).toBe("cs_test_abcdefghijkl");
      expect(r.events[0].properties).not.toHaveProperty("$session_id");
    }
  });

  it("records restores with an email hash, never the email", async () => {
    const { fetchFn, events } = withPostHog({ "checkout/sessions?": { data: [] } });
    const r = await handleRestore(new Request("https://app.test/api/restore", { method: "POST", body: JSON.stringify({ email: "Buyer@Example.com" }) }), { ...env, ...audited }, fetchFn);
    expect(r.status).toBe(404);
    expect(events[0]).toMatchObject({ event: "license_restore", properties: { result: "not_found" } });
    expect(events[0].properties.email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(events[0]).toLowerCase()).not.toContain("buyer@example.com");
  });

  it("still unlocks when PostHog is down, and sends nothing when it isn't configured", async () => {
    const down = withPostHog({ "checkout/sessions/": session() }, false);
    expect((await unlock("cs_test_abcdefghijkl", down.fetchFn, { ...env, ...audited })).status).toBe(200);
    const off = withPostHog({ "checkout/sessions/": session() });
    await unlock("cs_test_abcdefghijkl", off.fetchFn);
    expect(off.events).toHaveLength(0);
  });
});
