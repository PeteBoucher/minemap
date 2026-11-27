import { describe, expect, it } from "vitest";
import { previewCommit } from "./build";

describe("previewCommit", () => {
  it("shows the short commit on a Preview build", () => {
    expect(previewCommit({ env: "preview", sha: "d10bd8a3f2c94e1b8a7d6c5e4f3a2b1c0d9e8f7a" })).toBe("d10bd8a");
  });

  it("shows nothing in production or a local build", () => {
    expect(previewCommit({ env: "production", sha: "d10bd8a3f2c94e1b8a7d6c5e4f3a2b1c0d9e8f7a" })).toBeNull();
    expect(previewCommit({ env: "", sha: "" })).toBeNull();
  });

  it("shows nothing on a Preview built without a commit", () => {
    expect(previewCommit({ env: "preview", sha: "" })).toBeNull();
  });
});
