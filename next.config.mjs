/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The supervisors poll /api/health every 5s — keep it out of the
  // request log so the dev console stays readable.
  logging: {
    incomingRequests: {
      ignore: [/\/api\/health/],
    },
  },
  turbopack: {},
};
export default nextConfig;
