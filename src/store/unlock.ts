// Whether this device has unlocked Minemap, and getting a licence from the server.
import { del, get, set } from "idb-keyval";
import { type License, verifyLicense } from "../core/license";

/** Public key the app checks licences with (set VITE_LICENSE_PUBLIC_JWK at build time). */
const PUBLIC_JWK: JsonWebKey | null = (() => {
  try { return import.meta.env.VITE_LICENSE_PUBLIC_JWK ? JSON.parse(import.meta.env.VITE_LICENSE_PUBLIC_JWK) : null; } catch { return null; }
})();
/** Stripe Payment Link the "Unlock" button opens (set VITE_STRIPE_PAYMENT_LINK at build time). */
export const PAYMENT_LINK: string = import.meta.env.VITE_STRIPE_PAYMENT_LINK ?? "";

/** Unlocking needs both a public key and a payment link to be configured. */
export const unlockConfigured = (): boolean => !!PUBLIC_JWK && !!PAYMENT_LINK;

let cached: License | null | undefined;

/** The stored, verified licence, or null. */
export async function currentLicense(): Promise<License | null> {
  if (cached !== undefined) return cached;
  const token = await get<string>("license");
  cached = token && PUBLIC_JWK ? await verifyLicense(token, PUBLIC_JWK) : null;
  return cached;
}

export const isUnlocked = async (): Promise<boolean> => !!(await currentLicense());

async function store(token: string): Promise<License> {
  const lic = PUBLIC_JWK ? await verifyLicense(token, PUBLIC_JWK) : null;
  if (!lic) throw new Error("The server sent a licence this app can't verify.");
  await set("license", token);
  cached = lic;
  return lic;
}

async function fetchLicense(input: string, init?: RequestInit): Promise<License> {
  let r: Response;
  try { r = await fetch(input, init); } catch { throw new Error("Couldn't reach the server. Check your connection and try again."); }
  const body = (await r.json().catch(() => ({}))) as { license?: string; error?: string };
  if (!r.ok || !body.license) throw new Error(body.error ?? `Something went wrong (${r.status}).`);
  return store(body.license);
}

/** After paying, Stripe sends the buyer back with ?session_id=…; swap it for a licence. */
export const claimSession = (sessionId: string) => fetchLicense(`/api/unlock?session_id=${encodeURIComponent(sessionId)}`);

/** Get the licence again on a new device, by the email used to pay. */
export const restoreByEmail = (email: string) =>
  fetchLicense("/api/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });

/** For testing: forget the licence on this device. */
export async function forgetLicense(): Promise<void> {
  await del("license");
  cached = null;
}
