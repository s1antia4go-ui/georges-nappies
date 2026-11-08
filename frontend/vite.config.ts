import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the Vite server proxies API + WebSocket traffic to FastAPI on :8000,
// so the browser sees a single origin and session cookies just work.
export default defineConfig({
  plugins: [react()],
  // The web app lives under /app; the public website is served at "/".
  base: "/app/",
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: false },
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 600 },
});
