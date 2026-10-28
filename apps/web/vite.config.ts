import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const API = "http://127.0.0.1:3100";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // An inline (empty) config stops Vite walking up to the v1 app's postcss.config, which runs Tailwind 3.
  css: { postcss: {} },
  server: {
    proxy: {
      "/api": { target: API },
      "/ws": { target: API, ws: true },
    },
  },
  build: { outDir: "dist" },
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"] },
});
