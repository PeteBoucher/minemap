// Which build is running, so a Preview can be told apart from the one before it (the service worker
// can keep an older build running for a load or two after a deploy).

/** What the build was made from: Vercel's environment (preview, production) and commit, empty elsewhere. */
export interface BuildInfo { env: string; sha: string }

/** The short commit to show, on Preview builds only; production and local builds show nothing. */
export function previewCommit(b: BuildInfo): string | null {
  return b.env === "preview" && b.sha ? b.sha.slice(0, 7) : null;
}
