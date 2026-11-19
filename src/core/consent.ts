// The visitor's answer to the analytics banner. Nothing is sent to PostHog, and no cookie is set, until it's "granted".
// See docs/adr/0002-analytics-only-after-consent.md.

export type Answer = "granted" | "denied";
export type Consent = Answer | null;

type Store = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "minemap.analytics";

/** The remembered answer, or null if the visitor hasn't answered (or storage is unavailable, so ask again). */
export function readConsent(store: Store | undefined): Consent {
  try {
    const v = store?.getItem(STORAGE_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function writeConsent(store: Store | undefined, answer: Answer): void {
  try {
    store?.setItem(STORAGE_KEY, answer);
  } catch {
    /* private window or blocked site data: the banner will just ask again next visit */
  }
}
