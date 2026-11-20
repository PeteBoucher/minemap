import { describe, expect, it } from "vitest";
import { checkoutLink } from "./checkout";

const LINK = "https://buy.stripe.com/test_fZu9AM2aqfeA1Ro3ac4c800";
const visit = { distinct_id: "019a8f2e-1c3b-7d4e-9f00-123456789abc", session_id: "019a8f2e-5555-7aaa-8bbb-cccccccccccc" };

describe("checkoutLink", () => {
  it("is the plain Payment Link without a visit, so nothing about a visitor who declined reaches Stripe", () => {
    expect(checkoutLink(LINK)).toBe(LINK);
    expect(checkoutLink(LINK, null)).toBe(LINK);
  });

  it("carries the visit to Stripe as the checkout's reference", () => {
    const url = new URL(checkoutLink(LINK, visit));
    expect(url.origin + url.pathname).toBe(LINK);
    expect(url.searchParams.get("client_reference_id"))
      .toBe("019a8f2e-1c3b-7d4e-9f00-123456789abc_019a8f2e-5555-7aaa-8bbb-cccccccccccc");
  });

  it("keeps the link's own query, such as a prefilled email or locale", () => {
    const url = new URL(checkoutLink(`${LINK}?locale=es`, visit));
    expect(url.searchParams.get("locale")).toBe("es");
    expect(url.searchParams.has("client_reference_id")).toBe(true);
  });

  it("leaves out ids Stripe wouldn't accept as a reference", () => {
    expect(checkoutLink(LINK, { distinct_id: "someone@example.com", session_id: visit.session_id })).toBe(LINK);
    expect(checkoutLink(LINK, { distinct_id: visit.distinct_id, session_id: "" })).toBe(LINK);
  });

  it("doesn't break an unset link", () => {
    expect(checkoutLink("", visit)).toBe("");
  });
});
