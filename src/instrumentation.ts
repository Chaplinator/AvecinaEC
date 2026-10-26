import * as Sentry from "@sentry/nextjs";
import { scrubEvent, sentryDataCollection } from "@/lib/sentry-scrub";

export function register() {
  const dsn = process.env.SENTRY_DSN;
  Sentry.init({
    dsn,
    enabled: Boolean(dsn),
    dataCollection: { ...sentryDataCollection, httpBodies: [] },
    tracesSampleRate: 0.05,
    beforeSend: scrubEvent,
  });
}

export const onRequestError = Sentry.captureRequestError;
