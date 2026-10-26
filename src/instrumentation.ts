import * as Sentry from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent, sentryDataCollection } from "@/lib/sentry-scrub";

export function register() {
  const dsn = process.env.SENTRY_DSN;
  Sentry.init({
    dsn,
    enabled: Boolean(dsn),
    dataCollection: { ...sentryDataCollection, httpBodies: [] },
    // Sin tracing hasta que haga falta: las transacciones y spans no pasan por scrubEvent.
    tracesSampleRate: 0,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  });
}

export const onRequestError = Sentry.captureRequestError;
