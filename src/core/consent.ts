// The visitor's answer to the analytics banner. Nothing is sent to PostHog, and no cookie is set, until it's "granted".
// See docs/adr/0002-analytics-only-after-consent.md.

export type Consent = "granted" | "denied" | null;

type Store = Pick<Storage, "getItem" | "setItem">;

const KEY = "minemap.analytics";

/** The remembered answer, or null if the visitor hasn't answered (or storage is unavailable, so ask again). */
export function readConsent(store: Store | undefined): Consent {
  try {
    const v = store?.getItem(KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function writeConsent(store: Store | undefined, answer: "granted" | "denied"): void {
  try {
    store?.setItem(KEY, answer);
  } catch {
    /* private window or blocked site data: the banner will just ask again next visit */
  }
}
