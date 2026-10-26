// Sentry en el navegador, versión liviana (CLAUDE.md §3 y §13):
// - @sentry/browser con integraciones mínimas: solo errores no capturados y rechazos de promesas.
// - Sin tracing ni replay.
// - Se descarga cuando el navegador está ocioso, con la app ya interactiva.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  const start = () => import("@/lib/sentry-client").then((m) => m.initSentryClient(dsn));
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => void start(), { timeout: 5000 });
  } else {
    setTimeout(() => void start(), 3000);
  }
}
