// The Vercel entry points in api/: method checks and reading config from the environment.
// (Kept here rather than in api/, where Vercel would treat a test file as an endpoint.)
import { afterEach, describe, expect, it, vi } from "vitest";
import restore, { config as restoreConfig } from "../api/restore";
import unlock, { config as unlockConfig } from "../api/unlock";

afterEach(() => vi.unstubAllEnvs());

describe("api endpoints", () => {
  it("run on the Edge runtime", () => {
    expect(unlockConfig.runtime).toBe("edge");
    expect(restoreConfig.runtime).toBe("edge");
  });

  it("only accept their own method", async () => {
    expect((await unlock(new Request("https://x.test/api/unlock", { method: "POST" }))).status).toBe(405);
    expect((await restore(new Request("https://x.test/api/restore"))).status).toBe(405);
  });

  it("report when the server has no Stripe configuration", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("LICENSE_PRIVATE_JWK", "");
    const r = await unlock(new Request("https://x.test/api/unlock?session_id=cs_test_abcdefghijkl"));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Unlocking isn't set up on this server." });
  });

  it("read configuration from the environment", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("LICENSE_PRIVATE_JWK", "{}");
    // configured, so a bad session id is rejected before Stripe is called
    expect((await unlock(new Request("https://x.test/api/unlock?session_id=nope"))).status).toBe(400);
  });
});
