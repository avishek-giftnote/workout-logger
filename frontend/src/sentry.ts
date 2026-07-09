import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import { useLocation, useNavigationType, createRoutesFromChildren, matchRoutes } from "react-router-dom";

/**
 * Initialise Sentry for the browser. Call ONCE, as early as possible, before rendering (see main.tsx).
 *
 * Guarded on VITE_SENTRY_DSN: with no DSN (local dev / CI) this is a no-op, so the app runs untouched.
 *
 * Privacy (this app shows bodyweight + email and sends a JWT as a Bearer header):
 *  - Session Replay runs in MAX-PRIVACY mode — all text + inputs masked, media blocked, no network bodies.
 *  - sendDefaultPii is false; beforeSend/beforeBreadcrumb additionally strip Authorization/Cookie so a token
 *    can never ride out in an event or breadcrumb.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    integrations: [
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
      Sentry.replayIntegration({
        maskAllText: true,   // bodyweight / email / notes → masked blocks
        maskAllInputs: true, // every form field masked
        blockAllMedia: true,
        // no networkDetailAllowUrls → request/response bodies are NOT recorded
      }),
    ],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
    // Replay: sample 10% of normal sessions in prod, but ALWAYS keep the replay around an error.
    replaysSessionSampleRate: import.meta.env.PROD ? 0.1 : 0,
    replaysOnErrorSampleRate: 1.0,
    sendDefaultPii: false,
    beforeBreadcrumb(crumb) {
      if ((crumb.category === "fetch" || crumb.category === "xhr") && crumb.data) {
        const data = crumb.data as Record<string, unknown>;
        delete data.request_headers;
        delete data.Authorization;
      }
      return crumb;
    },
    beforeSend(event) {
      const headers = event.request?.headers as Record<string, string> | undefined;
      if (headers) {
        delete headers.Authorization;
        delete headers.Cookie;
      }
      return event;
    },
  });
}
