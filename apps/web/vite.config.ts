import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Deliberately not `PORT` — that name is reserved for "the port this
      // process itself binds to" (used that way by apps/api, and by tooling
      // that launches dev servers and injects PORT to control their bind
      // port). Reusing it here for "the backend's port, as seen by the
      // proxy" collides with that convention: a launcher that injects
      // PORT=5173 (this dev server's own port) makes the proxy target
      // itself instead of the API, causing every /api request to hang.
      "/api": {
        target: `http://localhost:${process.env.API_PORT ?? 4000}`,
        changeOrigin: true,
      },
    },
  },
});
