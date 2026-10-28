import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API = "http://127.0.0.1:3100";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: API },
      "/ws": { target: API, ws: true },
    },
  },
  build: { outDir: "dist" },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
