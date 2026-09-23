/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  // Absolute, not "./": path routing serves the app from nested URLs, where
  // relative asset references would resolve against the wrong directory.
  base: "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg", "icons/icon-maskable.svg", "icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "Splitwiser — Offline Expense Splitter",
        short_name: "Splitwiser",
        description: "Offline-first group expense splitter with greedy settlement and PDF/CSV export.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        categories: ["finance", "productivity", "utilities"],
        icons: [
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icons/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "index.html",
        // A published settlement must come from the network, not the cached
        // shell: a shell built before that route existed has no public branch, so
        // <App/> would mount and writeRoute would erase the token from the URL.
        // autoUpdate only fixes that on the NEXT load, which is one too late.
        // /api/ joins it for the same reason: the serverless endpoints are not
        // part of the app shell and must always reach the network.
        navigateFallbackDenylist: [/^\/s\//, /^\/api\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
});
