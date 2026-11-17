// Generates the key pair that signs unlock licences.
// Usage: npx tsx scripts/gen-license-keys.ts
// The public key goes in the app build (VITE_LICENSE_PUBLIC_JWK); the private key is a server secret
// (LICENSE_PRIVATE_JWK). Never commit the private key. Rotating keys invalidates every issued licence.
import { generateLicenseKeys } from "../src/core/license";

const { publicJwk, privateJwk } = await generateLicenseKeys();
console.log("# App build (.env.local, and a Vercel environment variable):");
console.log(`VITE_LICENSE_PUBLIC_JWK='${JSON.stringify(publicJwk)}'`);
console.log("\n# Server secret (.env.local for `vercel dev`, and a sensitive Vercel environment variable) - keep private:");
console.log(`LICENSE_PRIVATE_JWK='${JSON.stringify(privateJwk)}'`);
