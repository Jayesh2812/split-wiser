/// <reference types="vitest/config" />
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Serve `api/*.ts` from the dev server, the way the host serves them in
 * production.
 *
 * Without this `npm run dev` has no /api at all — Vite is a static server — and
 * the Members tab can only report the email lookup as unavailable. `vercel dev`
 * is the official answer, but it insists on building the project first and picks
 * yarn to do it on a project whose framework preset is unset, so this keeps the
 * one command that already works.
 *
 * Dev only (`apply: "serve"`): nothing here is part of a build, and the handler
 * runs in the dev server's own process, so a crash shows up as a stack trace in
 * the terminal rather than an opaque 500.
 */
function devApi(env: Record<string, string>): Plugin {
  return {
    name: "dev-api",
    apply: "serve",
    configureServer(server) {
      // The handler reads process.env, as it does on the host. These come from
      // .env.local, which is gitignored; nothing here is prefixed VITE_, so none
      // of it can reach the browser bundle.
      for (const [k, v] of Object.entries(env)) {
        if (!(k in process.env)) process.env[k] = v;
      }

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) return next();
        // Name only, never a path: this resolves to a file to execute.
        const name = url.slice("/api/".length).split("?")[0] ?? "";
        if (!/^[a-z0-9-]+$/.test(name)) return next();

        const body = await new Promise<string>((resolve) => {
          let raw = "";
          req.on("data", (c) => (raw += c));
          req.on("end", () => resolve(raw));
        });

        /** The two response methods the handlers use, over a plain ServerResponse. */
        const shim = {
          status(code: number) {
            res.statusCode = code;
            return shim;
          },
          json(payload: unknown) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(payload));
          },
        };

        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          const handler = mod.default as (q: unknown, s: unknown) => Promise<void>;
          // `body` stays a string; the handlers parse it themselves, because the
          // host hands them a string too when the content type is not JSON.
          await handler({ method: req.method, headers: req.headers, body }, shim);
        } catch (e) {
          // A module that will not even load (the usual cause) must say so here,
          // or it looks exactly like a route that does not exist.
          server.config.logger.error(`dev-api /api/${name} failed: ${String(e)}`);
          shim.status(500).json({ ok: false, reason: "dev-api", detail: String(e) });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  // Absolute, not "./": path routing serves the app from nested URLs, where
  // relative asset references would resolve against the wrong directory.
  base: "/",
  plugins: [
    react(),
    // "" as the prefix: loadEnv filters to VITE_ otherwise, and the service
    // account is deliberately not a VITE_ variable.
    devApi(loadEnv(mode, process.cwd(), "")),
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
}));
