/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// The web app shares the repository-root .env with the bot and server.
// Vite only exposes variables prefixed with VITE_ to the browser bundle, so
// the secrets in that file never reach the client.
const envDir = path.resolve(__dirname, "../..");

// In development the SPA runs on :8080 and proxies /api to the Express server
// on :3001, so the browser sees a single origin (first-party session cookie,
// no CORS) exactly like production, where Express serves the built app.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, envDir, "VITE_"), ...process.env };
  const apiTarget = env.VITE_DEV_API_TARGET || "http://localhost:3001";

  return {
    envDir,
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
    build: {
      rollupOptions: {
        output: {
          // Stable vendor chunks cache well across deploys; page code changes far more often.
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            motion: ["framer-motion"],
            query: ["@tanstack/react-query"],
          },
        },
      },
    },
    plugins: [react(), tailwindcss()],
    // Component tests render into jsdom; the pure-logic tests do not care which environment they run in.
    test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
