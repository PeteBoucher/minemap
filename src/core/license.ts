// Unlock licences: a small signed token, "<payload>.<signature>" in base64url. The server signs it
// with a private key after Stripe confirms payment; the app checks it offline with the public key.
// ECDSA P-256 / SHA-256 via WebCrypto, which browsers, Node and Vercel's Edge runtime all support.

export interface License {
  v: 1;
  /** Buyer's email, as Stripe recorded it. */
  email: string;
  /** Stripe Checkout Session id the licence was issued for. */
  sid: string;
  /** Issued at (ms since epoch). */
  iat: number;
}

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export async function generateLicenseKeys(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  return {
    publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}

export async function signLicense(license: License, privateJwk: JsonWebKey): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privateJwk, ALG, false, ["sign"]);
  const payload = toB64url(new TextEncoder().encode(JSON.stringify(license)));
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(payload)));
  return `${payload}.${toB64url(sig)}`;
}

/** The licence if `token` was signed by the matching private key, otherwise null. */
export async function verifyLicense(token: string, publicJwk: JsonWebKey): Promise<License | null> {
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const key = await crypto.subtle.importKey("jwk", publicJwk, ALG, false, ["verify"]);
    if (!(await crypto.subtle.verify(SIGN, key, fromB64url(sig), new TextEncoder().encode(payload)))) return null;
    const lic = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as License;
    return lic.v === 1 && typeof lic.sid === "string" ? lic : null;
  } catch {
    return null;
  }
}

/* ---------- free tier ---------- */

/** What the free version allows. The demo world doesn't count towards any of these. */
export const FREE = { worlds: 1, places: 30, maps: 5 } as const;

export type LimitReason = "worlds" | "places" | "maps" | "backup";

/** How many more of `kind` the free version allows, given how many exist. */
export const freeLeft = (kind: "worlds" | "places" | "maps", count: number): number => Math.max(0, FREE[kind] - count);
