// BACKEND-09: Sentry browser SDK — this is one of the few pieces that works identically
// serverless, since Sentry's browser SDK reports from the client by design.
import * as Sentry from 'https://esm.sh/@sentry/browser@7';
import { ENV } from '../config/env.js';

export function initSentry({ environment }) {
  if (!ENV.sentry.dsn || ENV.sentry.dsn.startsWith('YOUR_')) {
    console.info('[TableVibe] Sentry DSN not configured yet — skipping init.');
    return;
  }
  Sentry.init({
    dsn: ENV.sentry.dsn,
    environment: environment || (location.hostname === 'localhost' ? 'development' : 'production'),
    tracesSampleRate: 0.2,
  });
}

export function captureError(error, context = {}) {
  console.error('[TableVibe]', error, context);
  try {
    Sentry.captureException(error, { extra: context });
  } catch (_) {
    /* Sentry not initialized — error already logged above */
  }
}
