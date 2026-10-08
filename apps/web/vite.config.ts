import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// In development the SPA runs on :8080 and proxies /api to the Express server
// on :3001, so the browser sees a single origin (first-party session cookie,
// no CORS) exactly like production, where Express serves the built app.
const apiTarget = process.env.VITE_DEV_API_TARGET || "http://localhost:3001";

export default defineConfig({
  server: {
    host: "localhost",
    port: 8080,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false, xfwd: true },
    },
  },
  preview: {
    host: "localhost",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
