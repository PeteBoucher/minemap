// Real user monitoring in PostHog (EU): pageviews, Web Vitals, JS errors and session replay.
// Loaded only after the visitor accepts the banner, so a visitor who hasn't is sent nothing and gets no cookie.
// See docs/adr/0002-analytics-only-after-consent.md.
import type { PostHog } from "posthog-js";
import { type Answer, type Consent, readConsent, writeConsent } from "../core/consent";

const POSTHOG_KEY: string = import.meta.env.VITE_POSTHOG_KEY ?? "";
const POSTHOG_HOST: string = import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com";

/** Analytics is configured for this build; without a key there's nothing to ask consent for. */
export const analyticsAvailable = POSTHOG_KEY !== "" || import.meta.env.DEV;

let loading: Promise<PostHog | null> | null = null;

const storage = (): Storage | undefined => {
  try { return window.localStorage; } catch { return undefined; }
};

export const currentConsent = (): Consent => readConsent(storage());

function load(): Promise<PostHog | null> {
  loading ??= import("posthog-js").then(({ default: posthog }) => {
    // The visitor may have declined while the SDK was downloading; init would already send a pageview.
    if (currentConsent() !== "granted") { loading = null; return null; }
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      defaults: "2026-08-30",
      capture_exceptions: true, // uncaught errors and unhandled rejections become $exception events
      capture_performance: { web_vitals: true },
      session_recording: { maskAllInputs: true }, // replays never show what was typed
      // Only what the visitor was told about: pageviews, speed, errors and replay. No click autocapture or heatmaps.
      autocapture: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      opt_out_persistence_by_default: true, // declining also stops PostHog writing its cookie and storage
      // Last gate on every event: Web Vitals, for one, sends a delayed batch that ignores the opt-out.
      before_send: (event) => (currentConsent() === "granted" ? event : null),
    });
    return posthog;
  });
  return loading;
}

async function start(): Promise<void> {
  if (!POSTHOG_KEY) {
    // Loud in development, silent in a production build without a key (analytics is simply off there).
    if (import.meta.env.DEV) console.error("VITE_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_KEY is configured");
    return;
  }
  (await load())?.opt_in_capturing(); // also clears an opt-out from earlier in this visit
}

function stop(): void {
  // PostHog keeps its own opt-out flag in localStorage while it's running on this page; the rest goes now,
  // and the flag goes on the next page load, when the SDK isn't loaded (initAnalytics).
  void loading?.then((ph) => {
    ph?.opt_out_capturing();
    forgetPostHog({ keepOptOut: true });
  });
  forgetPostHog({ keepOptOut: true });
}

/**
 * Remove every cookie and storage entry PostHog wrote, so a visitor who declines keeps none. While the SDK is
 * running on this page its opt-out flag must stay: removing it switches capturing back on.
 */
function forgetPostHog({ keepOptOut = false } = {}): void {
  const ours = (k: string) => (k.startsWith("ph_") || k.startsWith("__ph_")) && !(keepOptOut && k.startsWith("__ph_opt_in_out_"));
  for (const s of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const store = s();
      for (const k of Object.keys(store)) if (ours(k)) store.removeItem(k);
    } catch { /* storage unavailable: nothing was written there */ }
  }
  const host = location.hostname;
  const domains = ["", host, ...host.split(".").map((_, i, parts) => "." + parts.slice(i).join(".")).slice(0, -1)];
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0].trim();
    if (!ours(name)) continue;
    for (const d of domains) document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ""}`;
  }
}

/** Record the visitor's answer and start or stop analytics to match. */
export function setConsent(answer: Answer): void {
  writeConsent(storage(), answer);
  if (answer === "granted") void start();
  else stop();
}

/** At startup: begin analytics only if the visitor already accepted; otherwise clear anything PostHog left. */
export function initAnalytics(): void {
  if (currentConsent() === "granted") void start();
  else forgetPostHog();
}
