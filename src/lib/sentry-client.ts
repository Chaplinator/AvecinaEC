import {
  dedupeIntegration,
  globalHandlersIntegration,
  init,
  linkedErrorsIntegration,
} from "@sentry/browser";
import { scrubEvent, sentryDataCollection } from "./sentry-scrub";

// Imports con nombre para que el bundler descarte replay, feedback, tracing, etc.
export function initSentryClient(dsn: string) {
  init({
    dsn,
    defaultIntegrations: false,
    integrations: [globalHandlersIntegration(), linkedErrorsIntegration(), dedupeIntegration()],
    dataCollection: { ...sentryDataCollection, httpBodies: [] },
    beforeSend: scrubEvent,
  });
}
