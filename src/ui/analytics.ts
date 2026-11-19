// Real user monitoring in PostHog (EU): pageviews, Web Vitals, JS errors and session replay.
// Loaded only after the visitor accepts the banner, so a visitor who hasn't is sent nothing and gets no cookie.
// See docs/adr/0002-analytics-only-after-consent.md.
import type { PostHog } from "posthog-js";
import { type Consent, readConsent, writeConsent } from "../core/consent";

const KEY: string = import.meta.env.VITE_POSTHOG_KEY ?? "";
const HOST: string = import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com";

let ph: PostHog | null = null;

const storage = (): Storage | undefined => {
  try { return window.localStorage; } catch { return undefined; }
};

async function start(): Promise<void> {
  if (!KEY) {
    if (import.meta.env.DEV) {
      throw new Error("VITE_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_KEY is configured");
    }
    return; // production build without a key: analytics is simply off
  }
  if (ph) { ph.opt_in_capturing(); return; }
  const { default: posthog } = await import("posthog-js");
  posthog.init(KEY, {
    api_host: HOST,
    defaults: "2026-08-30",
    capture_exceptions: true, // uncaught errors and unhandled rejections become $exception events
    capture_performance: { web_vitals: true },
    session_recording: { maskAllInputs: true }, // replays never show what was typed
  });
  ph = posthog;
}

function stop(): void {
  if (!ph) return;
  ph.opt_out_capturing(); // stops capture and replay for the rest of this visit
  ph.reset(); // forget this visitor's id
}

/** Record the visitor's answer and start or stop analytics to match. */
export function setConsent(answer: "granted" | "denied"): void {
  writeConsent(storage(), answer);
  if (answer === "granted") void start();
  else stop();
}

export const currentConsent = (): Consent => readConsent(storage());

/** At startup: begin analytics only if the visitor already accepted. */
export function initAnalytics(): void {
  if (currentConsent() === "granted") void start();
}
