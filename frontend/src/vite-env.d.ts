/// <reference types="vite/client" />

// Custom Vite env vars exposed to the client (must be VITE_-prefixed). Declared so `tsc --noEmit` (strict)
// accepts `import.meta.env.VITE_SENTRY_DSN`. Values live in frontend/.env.local (git-ignored); absent = Sentry off.
interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
