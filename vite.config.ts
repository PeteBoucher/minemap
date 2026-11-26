import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // which build this is: Preview builds show their commit (src/core/build.ts)
  define: { __BUILD__: JSON.stringify({ env: process.env.VERCEL_ENV ?? "", sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "" }) },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      // PostHog loads only after the visitor accepts analytics (ADR 0002), so don't precache it for everyone.
      workbox: { globIgnores: ["**/posthog-*.js"] },
      manifest: {
        name: "Minemap",
        short_name: "Minemap",
        description: "A map companion for Minecraft: save places, plan routes, and line up your in-game map screenshots.",
        theme_color: "#2f7d4f",
        background_color: "#eef1ec",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
        // TODO: Android share target (share Switch screenshots straight into the app). Needs a custom
        // service worker (injectManifest) to receive the POSTed files, so it's left out until then.
      },
    }),
  ],
  build: {
    rollupOptions: { output: { manualChunks: (id) => (id.includes("/node_modules/posthog-js/") ? "posthog" : undefined) } },
  },
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
