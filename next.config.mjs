/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // src/server/**/*.ts uses ESM-style ".js" specifiers for local imports
  // (e.g. `from "./config.js"`, resolved to config.ts). TypeScript's
  // "Bundler" moduleResolution understands this natively, but Next's
  // webpack bundler does not by default — teach it the same aliasing.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
export default nextConfig;
