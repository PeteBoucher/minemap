import { describe, expect, it } from "vitest";
import { FREE, freeLeft, generateLicenseKeys, signLicense, verifyLicense } from "./license";

describe("licences", () => {
  it("verifies a licence signed with the matching key", async () => {
    const { publicJwk, privateJwk } = await generateLicenseKeys();
    const token = await signLicense({ v: 1, email: "a@b.co", sid: "cs_test_123", iat: 1 }, privateJwk);
    expect(await verifyLicense(token, publicJwk)).toEqual({ v: 1, email: "a@b.co", sid: "cs_test_123", iat: 1 });
  });

  it("rejects tampered, foreign and malformed licences", async () => {
    const mine = await generateLicenseKeys(), other = await generateLicenseKeys();
    const token = await signLicense({ v: 1, email: "a@b.co", sid: "cs_test_123", iat: 1 }, mine.privateJwk);
    const [payload, sig] = token.split(".");
    const forged = btoa(JSON.stringify({ v: 1, email: "x@y.z", sid: "cs_test_999", iat: 1 })).replace(/=+$/, "");
    expect(await verifyLicense(`${forged}.${sig}`, mine.publicJwk)).toBeNull();
    expect(await verifyLicense(token, other.publicJwk)).toBeNull();
    expect(await verifyLicense(payload, mine.publicJwk)).toBeNull();
    expect(await verifyLicense("not a licence", mine.publicJwk)).toBeNull();
  });
});

describe("free tier", () => {
  it("counts what's left", () => {
    expect(FREE).toEqual({ worlds: 1, places: 30, maps: 5 });
    expect(freeLeft("maps", 3)).toBe(2);
    expect(freeLeft("maps", 9)).toBe(0);
  });
});
