import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// `pnpm dev` pins the server to 3100 and a state dir of its own (apps/server/package.json),
// clear of the service on 8700 and of its database.
const API = "http://127.0.0.1:3100";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    proxy: {
      "/api": { target: API },
      "/ws": { target: API, ws: true },
    },
  },
  build: {
    outDir: "dist",
    rolldownOptions: {
      output: {
        // React, the router and the query client change only with a dependency bump: kept apart
        // from the app's own code, which every deploy changes, a phone keeps them cached across
        // deploys — and neither chunk crosses Vite's 500 kB warning.
        codeSplitting: {
          groups: [
            {
              name: "vendor",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|@tanstack[\\/][^\\/]+)[\\/]/,
            },
          ],
        },
      },
    },
  },
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"] },
});
