import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude native modules and packages with dynamic requires from webpack bundling.
  // They'll be resolved by Node.js at runtime instead.
  serverExternalPackages: ["@libsql/client", "apify-client", "got-scraping", "ow", "playwright-core"],
};

export default nextConfig;
