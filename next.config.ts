import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Sin cacheComponents/PPR: el shell estático no lleva nonce y el CSP bloquearía todo el JS.
  // Sin source maps públicos; los de Sentry se suben en privado durante el build.
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  compiler: { removeConsole: { exclude: ["error", "warn"] } },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Teselas versionadas por nombre de archivo: caché larga e inmutable.
      {
        source: "/tiles/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
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

// Los source maps se suben a Sentry en privado y se borran del output (§13).
// Sin SENTRY_AUTH_TOKEN no se sube nada y el build sigue funcionando.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  // El valor por defecto del SDK es NO borrar (pese a lo que dicen sus tipos): forzarlo.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
