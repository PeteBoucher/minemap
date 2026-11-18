// Audit trail for the unlock endpoints: one PostHog event per request, whatever the outcome.
// Stripe stays the record of payments; this records which licences were issued or refused, and why.
// Emails are never sent, only a SHA-256 hash, so the trail holds no personal data but can still
// show one email being restored many times. Session ids link each event back to Stripe.

export interface AuditEnv {
  /** PostHog project API key (phc_…). Auditing is off when unset. */
  POSTHOG_KEY?: string;
  /** PostHog ingestion host, e.g. https://eu.i.posthog.com */
  POSTHOG_HOST?: string;
  /** Set by Vercel: production, preview or development. Tags events so test runs can be filtered out. */
  VERCEL_ENV?: string;
}

export type AuditResult = "issued" | "refused" | "not_found" | "bad_input" | "stripe_error" | "not_configured";

export interface AuditEvent {
  event: "license_unlock" | "license_restore";
  result: AuditResult;
  session_id?: string;
  email_hash?: string;
}

export async function hashEmail(email: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sends one audit event. Never throws: a PostHog outage must not block an unlock. */
export async function audit(env: AuditEnv, e: AuditEvent, fetchFn: typeof fetch = fetch): Promise<void> {
  if (!env.POSTHOG_KEY) return;
  const host = (env.POSTHOG_HOST || "https://eu.i.posthog.com").replace(/\/+$/, "");
  const { event, ...props } = e;
  try {
    await fetchFn(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: env.POSTHOG_KEY,
        event,
        distinct_id: e.session_id || e.email_hash || "anonymous",
        timestamp: new Date().toISOString(),
        properties: {
          ...props,
          livemode: e.session_id ? e.session_id.startsWith("cs_live_") : undefined,
          deploy_env: env.VERCEL_ENV || "unknown",
          source: "minemap-api",
          $process_person_profile: false,
          $geoip_disable: true,
        },
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch { /* auditing is best effort */ }
}
