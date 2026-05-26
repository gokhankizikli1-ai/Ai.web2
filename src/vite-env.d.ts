// Build-time constants injected by vite.config.ts via the `define` option.
// Available at runtime as plain string literals. Used by BuildInfoOverlay
// (owner-only) to verify which build is actually live on prod.
//
// NOTE: intentionally NOT including `/// <reference types="vite/client" />`
// here — the local dev environment doesn't have vite types installed
// and adding the reference produces a spurious TS2688. On the Vercel
// build env where the types ARE installed, tsconfig.app.json already
// pulls them in via compilerOptions.types.
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__:   string;
declare const __BUILD_ENV__:    string;
declare const __BUILD_BRANCH__: string;
