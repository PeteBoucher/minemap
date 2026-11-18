// End-to-end test of a test-mode purchase: pay through the real Payment Link, land back on the app,
// get a licence, then check the purchase in Stripe and the audit event in PostHog.
//
// Usage:  npx tsx --env-file=.env.local scripts/e2e-purchase.ts   (or: npm run e2e:purchase)
//
// Needs (in .env.local or the environment):
//   STRIPE_SECRET_KEY         sk_test_… or rk_test_… (live keys are refused)
//   STRIPE_PAYMENT_LINK_ID    plink_… of the test Payment Link
// Optional:
//   E2E_BASE_URL              app to land on (default https://minemap.me)
//   POSTHOG_PERSONAL_API_KEY  phx_… with query:read, to check the audit event (skipped without it)
//   POSTHOG_PROJECT_ID        default 139417
//   POSTHOG_API_HOST          default https://eu.posthog.com
//   E2E_HEADED=1              show the browser
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const env = process.env;
const BASE_URL = (env.E2E_BASE_URL || "https://minemap.me").replace(/\/+$/, "");
const STRIPE_KEY = env.STRIPE_SECRET_KEY ?? "";
const LINK_ID = env.STRIPE_PAYMENT_LINK_ID ?? "";
const PH_KEY = env.POSTHOG_PERSONAL_API_KEY ?? "";
const PH_PROJECT = env.POSTHOG_PROJECT_ID || "139417";
const PH_HOST = (env.POSTHOG_API_HOST || "https://eu.posthog.com").replace(/\/+$/, "");

/** The Spanish buyer from scenario 1: 21% IVA, which must come out of the $5, not on top. */
const BUYER = {
  email: `e2e+${Date.now()}@example.com`,
  name: "E2E Test",
  country: "ES",
  line1: "Calle Mayor 1",
  postal: "28013",
  city: "Madrid",
  province: "Madrid",
};

let failures = 0;
function check(ok: boolean, what: string, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function stripe<T>(path: string): Promise<T> {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { authorization: `Bearer ${STRIPE_KEY}` } });
  const body = await r.json();
  if (!r.ok) throw new Error(`Stripe ${path}: ${r.status} ${JSON.stringify(body)}`);
  return body as T;
}

/** Fills a Checkout field if it's on the page; Stripe shows different fields per country and layout. */
async function fillIfShown(page: Page, selector: string, value: string) {
  const el = page.locator(selector).first();
  if (await el.isVisible().catch(() => false)) await el.fill(value);
}

async function payOnCheckout(page: Page, url: string) {
  await page.goto(url);
  await page.locator("#email").fill(BUYER.email);
  // Card sits in an accordion when other methods (Cash App) are offered. Its button is an invisible
  // overlay, so click the accordion item itself.
  const card = page.locator('[data-testid="card-accordion-item"]');
  if (await card.count()) await card.click();
  await page.locator("#cardNumber").fill("4242424242424242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill(BUYER.name);
  await page.locator("#billingCountry").selectOption(BUYER.country);
  await fillIfShown(page, "#billingAddressLine1", BUYER.line1);
  await fillIfShown(page, "#billingPostalCode", BUYER.postal);
  await fillIfShown(page, "#billingLocality", BUYER.city);
  const province = page.locator("#billingAdministrativeArea");
  if (await province.isVisible().catch(() => false)) {
    await province.selectOption({ label: BUYER.province }).catch(() => province.fill(BUYER.province));
  }
  // Stripe recalculates tax once the address is in; a click during that is silently ignored.
  // (Stripe's page never goes network-idle: it keeps sending analytics beacons.)
  await page.waitForTimeout(2500);
  await page.locator('[data-testid="hosted-payment-submit-button"]').click();
}

/** The app keeps the licence in IndexedDB (idb-keyval's default store) only after verifying it. */
async function storedLicense(page: Page): Promise<string | null> {
  return page.evaluate(() => new Promise<string | null>((resolve) => {
    const open = indexedDB.open("keyval-store");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("keyval")) return resolve(null);
      const get = db.transaction("keyval").objectStore("keyval").get("license");
      get.onsuccess = () => resolve((get.result as string | undefined) ?? null);
      get.onerror = () => resolve(null);
    };
  }));
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined>, timeoutMs: number, everyMs = 1000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

async function auditEvent(sessionId: string): Promise<{ result: string } | null> {
  const r = await fetch(`${PH_HOST}/api/projects/${PH_PROJECT}/query/`, {
    method: "POST",
    headers: { authorization: `Bearer ${PH_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query:
      `SELECT properties.result FROM events WHERE event = 'license_unlock' AND timestamp >= now() - INTERVAL 1 HOUR
       AND properties.session_id = '${sessionId.replace(/[^A-Za-z0-9_]/g, "")}' ORDER BY timestamp DESC LIMIT 1` } }),
  });
  if (!r.ok) throw new Error(`PostHog query: ${r.status} ${await r.text()}`);
  const rows = ((await r.json()) as { results: string[][] }).results;
  return rows.length ? { result: rows[0][0] } : null;
}

async function main() {
  if (!/^(sk|rk)_test_/.test(STRIPE_KEY)) throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_… or rk_test_…). This script never runs against live mode.");
  if (!LINK_ID.startsWith("plink_")) throw new Error("Set STRIPE_PAYMENT_LINK_ID to the test Payment Link (plink_…).");

  console.log("Payment Link");
  const link = await stripe<{ url: string; livemode: boolean; active: boolean }>(`payment_links/${LINK_ID}`);
  check(!link.livemode && link.active, "test-mode link is active", link.url);
  if (link.livemode) throw new Error("Refusing to buy through a live Payment Link.");

  console.log(`Checkout as ${BUYER.email} (${BUYER.city}, ${BUYER.country})`);
  const browser = await chromium.launch({ headless: !env.E2E_HEADED, channel: "chromium" });
  let sessionId = "";
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  try {
    await payOnCheckout(page, link.url);
    // The app strips ?session_id= from the address bar straight away, so watch its call to the API instead.
    const unlock = await page.waitForResponse((r) => r.url().startsWith(`${BASE_URL}/api/unlock?`), { timeout: 90_000 });
    sessionId = new URL(unlock.url()).searchParams.get("session_id") ?? "";
    check(sessionId.startsWith("cs_test_"), "redirected back to the app with a session id", sessionId.slice(0, 24) + "…");
    check(unlock.status() === 200, "/api/unlock issued a licence", `HTTP ${unlock.status()}`);
    const license = await waitFor("the app to store a licence", () => storedLicense(page), 30_000).catch(() => null);
    check(!!license, "app verified and stored a licence");
  } catch (e) {
    const shot = join(env.E2E_ARTIFACTS || tmpdir(), "minemap-e2e-failure.png");
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    check(false, "checkout and redirect", `${(e as Error).message.split("\n")[0]} — screenshot: ${shot}`);
  } finally {
    await browser.close();
  }
  if (!sessionId) return;

  console.log("Stripe");
  const s = await stripe<{
    status: string; payment_status: string; amount_total: number; currency: string; payment_link: string;
    managed_payments?: { enabled: boolean }; total_details: { amount_tax: number };
    customer_details: { email: string; address: { country: string } };
  }>(`checkout/sessions/${sessionId}`);
  check(s.status === "complete" && s.payment_status === "paid", "session complete and paid", `${s.status}/${s.payment_status}`);
  check(s.amount_total === 500 && s.currency === "usd", "buyer paid exactly $5.00", `${s.amount_total} ${s.currency}`);
  check(s.total_details.amount_tax > 0 && s.total_details.amount_tax < 500, "IVA is included in the $5", `tax ${s.total_details.amount_tax}`);
  check(s.managed_payments?.enabled === true, "Managed Payments on");
  check(s.payment_link === LINK_ID, "came from our Payment Link");
  check(s.customer_details.address.country === BUYER.country, "billed to Spain", s.customer_details.address.country);

  console.log("PostHog audit trail");
  if (!PH_KEY) {
    console.log("  - skipped: set POSTHOG_PERSONAL_API_KEY (query:read) to check the license_unlock event");
  } else {
    // Ingestion takes a minute or two before events are queryable.
    const ev = await waitFor("the license_unlock event", () => auditEvent(sessionId), 180_000, 10_000).catch(() => null);
    check(ev?.result === "issued", "license_unlock event recorded as issued", ev ? ev.result : "not found after 3 minutes");
  }
}

main()
  .catch((e) => { console.error(`\n${(e as Error).message}`); failures++; })
  .finally(() => {
    console.log(failures ? `\nFAILED: ${failures} check(s)` : "\nPASSED");
    process.exit(failures ? 1 : 0);
  });
