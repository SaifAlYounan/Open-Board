import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// The frontend dev/preview server uses its OWN port (WEB_PORT), independent of
// the API server's PORT — running both with a single shared PORT would collide.
// Defaults keep `pnpm dev` working with zero configuration.
const rawWebPort = process.env.WEB_PORT ?? "5173";
const webPort = Number(rawWebPort);

if (Number.isNaN(webPort) || webPort <= 0) {
  throw new Error(`Invalid WEB_PORT value: "${rawWebPort}"`);
}

// Where the API server is reachable during dev. All `/api` and websocket calls
// are proxied there so the browser only ever talks to one origin (no CORS in dev).
const apiPort = process.env.PORT ?? "3000";
const apiTarget = process.env.API_PROXY_TARGET ?? `http://localhost:${apiPort}`;

// Base path the SPA is served under. Defaults to root; override to host under a
// sub-path (e.g. "/board/").
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: webPort,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/socket.io": { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
  preview: {
    port: webPort,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
