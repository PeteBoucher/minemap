import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
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
  test: {
    include: ["src/**/*.test.ts"],
  },
});
