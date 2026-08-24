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
    // Neither var is named `PORT` — that generic name is what dev-server
    // launchers (including some hosting platforms) inject to mean "bind
    // yourself here," so a launcher can hand out PORT=5173 to this very
    // process. If this file read `PORT` for either its own bind or the
    // API's location, that injected value would collide with one of the
    // two meanings. VITE_PORT and API_PORT are unambiguous either way.
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.API_PORT ?? 4000}`,
        changeOrigin: true,
      },
    },
  },
});
