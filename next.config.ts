import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Sin cacheComponents/PPR: el shell estático no lleva nonce y el CSP bloquearía todo el JS.
  // Sin source maps públicos; los de Sentry se suben en privado durante el build.
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  compiler: { removeConsole: { exclude: ["error", "warn"] } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
