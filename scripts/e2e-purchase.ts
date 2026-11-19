// End-to-end test of a test-mode purchase against a Vercel Preview deployment: pay through the real
// sandbox Payment Link, land back on the Preview, get a licence, then check the purchase in Stripe and
// the audit event in PostHog.
//
// Usage:  E2E_BASE_URL=https://<preview>.vercel.app npm run e2e:purchase
//
// The sandbox Payment Link redirects to minemap.me, which runs on live keys and can't see sandbox
// sessions. Inside this script's browser only, that redirect is rerouted to E2E_BASE_URL.
//
// Needs (in .env.local or the environment):
//   E2E_BASE_URL              the Preview deployment (production minemap.me is refused)
//   STRIPE_SECRET_KEY         sk_test_… or rk_test_… (live keys are refused)
//   STRIPE_PAYMENT_LINK_ID    plink_… of the sandbox Payment Link
// Optional:
//   VERCEL_AUTOMATION_BYPASS_SECRET  Vercel "Protection Bypass for Automation" secret, if previews
//                                    are protected (sent only to E2E_BASE_URL, never to Stripe)
//   POSTHOG_PERSONAL_API_KEY  phx_… with query:read, to check the audit event (skipped without it)
//   POSTHOG_PROJECT_ID        default 139417
//   POSTHOG_API_HOST          default https://eu.posthog.com
//   E2E_HEADED=1              show the browser
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const env = process.env;
const BASE_URL = (env.E2E_BASE_URL ?? "").replace(/\/+$/, "");
const BYPASS = env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
/** Where the sandbox Payment Link sends buyers; rerouted to BASE_URL in this browser. */
const LINK_REDIRECT_ORIGIN = "https://minemap.me";
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
  // Which address fields Checkout asks for depends on the link's billing_address_collection: all of
  // them for "required", only what tax needs (country, maybe postcode) for "auto". Fill what's shown.
  const shown = async (sel: string) => page.locator(sel).isVisible().catch(() => false);
  if (await shown("#billingName")) await page.locator("#billingName").fill(BUYER.name);
  await page.locator("#billingCountry").selectOption(BUYER.country);
  await page.waitForTimeout(500); // the form re-renders for the chosen country
  const fields = ["#billingName", "#billingAddressLine1", "#billingPostalCode", "#billingLocality", "#billingAdministrativeArea"];
  const visible = [];
  for (const f of fields) if (await shown(f)) visible.push(f.replace("#billing", ""));
  console.log(`  · address fields shown: Country${visible.length ? ", " + visible.join(", ") : ""}`);
  if (await shown("#billingAddressLine1")) {
    await page.locator("#billingAddressLine1").fill(BUYER.line1);
    // Depending on where the browser is (GitHub's US runners, for one), typing the street opens Google
    // address suggestions over the postcode, city and province fields. Close them before going on.
    await page.locator("#billingAddressLine1").press("Escape");
  }
  if (await shown("#billingPostalCode")) await page.locator("#billingPostalCode").fill(BUYER.postal);
  if (await shown("#billingLocality")) await page.locator("#billingLocality").fill(BUYER.city);
  const province = page.locator("#billingAdministrativeArea");
  if (await province.isVisible().catch(() => false)) {
    await province.selectOption({ label: BUYER.province }).catch(() => province.fill(BUYER.province));
  }
  // Stripe recalculates tax once the address is in; a click during that is silently ignored.
  // (Stripe's page never goes network-idle: it keeps sending analytics beacons.)
  await page.waitForTimeout(2500);
  // The suggestions can arrive after the Escape above and reopen over the form; Stripe then ignores Pay.
  await closeAddressSuggestions(page);
  // Pay can still be ignored if Checkout is re-validating the address. Click again until the page
  // starts processing (the button disables) or leaves Checkout; a session can't be paid twice.
  const pay = page.locator('[data-testid="hosted-payment-submit-button"]');
  const startUrl = page.url();
  for (let i = 1; i <= 3; i++) {
    await pay.click().catch(() => {});
    const started = await page.waitForFunction(
      ([url, sel]) => location.href !== url || (document.querySelector(sel) as HTMLButtonElement | null)?.disabled === true,
      [startUrl, '[data-testid="hosted-payment-submit-button"]'] as const, { timeout: 8000 },
    ).then(() => true, () => false);
    if (started) return;
    console.log(`  · Pay click ${i} was ignored`);
  }
}

async function closeAddressSuggestions(page: Page) {
  const box = page.getByText("Suggestions powered by");
  const open = () => box.isVisible().catch(() => false);
  // A page-level Escape goes to whichever field has focus (by now the city or province), not the
  // street field that owns the suggestions. So send it to the street field, then click away from it.
  const attempts: [string, () => Promise<unknown>][] = [
    ["Escape in the street field", () => page.locator("#billingAddressLine1").press("Escape")],
    ["a click outside the box", () => page.getByText("Contact information").click({ timeout: 2000 })],
  ];
  for (const [how, attempt] of attempts) {
    if (!(await open())) return;
    await attempt().catch(() => {});
    await box.waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
    console.log(`  · address suggestions ${(await open()) ? "still open after" : "closed by"} ${how}`);
  }
  if (await open()) throw new Error("Google address suggestions won't close; Pay would be ignored");
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

async function auditEvent(sessionId: string): Promise<{ result: string; deploy_env: string } | null> {
  const r = await fetch(`${PH_HOST}/api/projects/${PH_PROJECT}/query/`, {
    method: "POST",
    headers: { authorization: `Bearer ${PH_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query:
      `SELECT properties.result, properties.deploy_env FROM events WHERE event = 'license_unlock' AND timestamp >= now() - INTERVAL 1 HOUR
       AND properties.session_id = '${sessionId.replace(/[^A-Za-z0-9_]/g, "")}' ORDER BY timestamp DESC LIMIT 1` } }),
  });
  if (!r.ok) throw new Error(`PostHog query: ${r.status} ${await r.text()}`);
  const rows = ((await r.json()) as { results: string[][] }).results;
  return rows.length ? { result: rows[0][0], deploy_env: rows[0][1] } : null;
}

/** Sends Stripe's redirect to the Preview, and gets past the Preview's Deployment Protection. */
async function routeToPreview(page: Page) {
  await page.route(`${LINK_REDIRECT_ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    return route.fulfill({ status: 302, headers: { location: `${BASE_URL}${u.pathname}${u.search}` } });
  });
  if (BYPASS) {
    // Playwright doesn't route the request a fulfilled redirect leads to, so a header can't be added
    // there. Instead Vercel sets a bypass cookie, scoped to the Preview's host, on this first visit.
    const q = new URLSearchParams({ "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" });
    await page.goto(`${BASE_URL}/?${q}`);
  }
}

async function main() {
  if (!/^https:\/\//.test(BASE_URL)) throw new Error("Set E2E_BASE_URL to the Preview deployment, e.g. https://minemap-git-<branch>-<team>.vercel.app");
  if (/^https:\/\/(www\.)?minemap\.me$/.test(BASE_URL)) throw new Error("minemap.me runs on live keys and can't see sandbox sessions. Point E2E_BASE_URL at a Preview deployment.");
  if (!/^(sk|rk)_test_/.test(STRIPE_KEY)) throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_… or rk_test_…). This script never runs against live mode.");
  if (!LINK_ID.startsWith("plink_")) throw new Error("Set STRIPE_PAYMENT_LINK_ID to the test Payment Link (plink_…).");

  console.log("Payment Link");
  const link = await stripe<{ url: string; livemode: boolean; active: boolean }>(`payment_links/${LINK_ID}`);
  check(!link.livemode && link.active, "test-mode link is active", link.url);
  if (link.livemode) throw new Error("Refusing to buy through a live Payment Link.");

  console.log(`Checkout as ${BUYER.email} (${BUYER.city}, ${BUYER.country}), landing on ${BASE_URL}`);
  const browser = await chromium.launch({ headless: !env.E2E_HEADED, channel: "chromium" });
  let sessionId = "";
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  try {
    await routeToPreview(page);
    const probe = await page.request.get(`${BASE_URL}/`, { headers: BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {}, maxRedirects: 0 });
    // Vercel's Deployment Protection answers with 401 or a redirect to its login (vercel.com/sso-api).
    const toLogin = /vercel\.com\//.test(probe.headers()["location"] ?? "");
    if (probe.status() === 401 || probe.status() === 403 || toLogin)
      throw new Error(`Preview answered HTTP ${probe.status()}: it's protected. ${BYPASS ? "VERCEL_AUTOMATION_BYPASS_SECRET was rejected." : "Set VERCEL_AUTOMATION_BYPASS_SECRET."}`);
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
    // Events usually become queryable within 2–7 minutes of the purchase.
    let lastError = "";
    const ev = await waitFor("the license_unlock event", () => auditEvent(sessionId).catch((e) => { lastError = (e as Error).message; return null; }), 600_000, 15_000).catch(() => null);
    check(ev?.result === "issued", "license_unlock event recorded as issued", ev ? ev.result : lastError || "not found after 10 minutes");
    if (ev) check(ev.deploy_env === "preview", "event tagged as a preview deployment", `deploy_env ${ev.deploy_env}`);
  }
}

main()
  .catch((e) => { console.error(`\n${(e as Error).message}`); failures++; })
  .finally(() => {
    console.log(failures ? `\nFAILED: ${failures} check(s)` : "\nPASSED");
    process.exit(failures ? 1 : 0);
  });
