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
        // Android: lets people share Switch screenshots straight into the app (handled in step 5)
        share_target: {
          action: "/share",
          method: "POST",
          enctype: "multipart/form-data",
          params: { files: [{ name: "screens", accept: ["image/*"] }] },
        },
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
