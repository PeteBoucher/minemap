import { describe, expect, it } from "vitest";
import { readConsent, writeConsent } from "./consent";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const blocked = {
  getItem: () => { throw new DOMException("denied", "SecurityError"); },
  setItem: () => { throw new DOMException("denied", "SecurityError"); },
};

describe("analytics consent", () => {
  it("a first-time visitor hasn't been asked yet", () => {
    expect(readConsent(memory())).toBe(null);
  });

  it("remembers accepting and declining", () => {
    const s = memory();
    writeConsent(s, "granted");
    expect(readConsent(s)).toBe("granted");
    writeConsent(s, "denied");
    expect(readConsent(s)).toBe("denied");
  });

  it("treats anything else stored as not asked", () => {
    const s = memory();
    s.setItem("minemap.analytics", "yes please");
    expect(readConsent(s)).toBe(null);
  });

  it("without usable storage (private window, blocked site data) it asks again and never throws", () => {
    expect(readConsent(blocked)).toBe(null);
    expect(() => writeConsent(blocked, "granted")).not.toThrow();
    expect(readConsent(undefined)).toBe(null);
  });
});
