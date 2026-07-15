import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// ── Build-time constants ─────────────────────────────────────────────────
// Injected into the bundle so the running app can show its own version
// + build time. Used by BuildInfoOverlay to let the operator confirm
// which deploy is actually live (cured the "Vercel cached an old build"
// guessing game). Vercel exposes VERCEL_GIT_COMMIT_SHA on every build;
// the others are best-effort.
const BUILD_COMMIT = (
  process.env.VITE_BUILD_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.COMMIT_SHA ||
  'dev'
).slice(0, 12)
const BUILD_TIME = new Date().toISOString()
const BUILD_ENV = (
  process.env.VITE_BUILD_ENV ||
  process.env.VERCEL_ENV ||
  process.env.NODE_ENV ||
  'development'
)
const BUILD_BRANCH = (
  process.env.VITE_BUILD_BRANCH ||
  process.env.VERCEL_GIT_COMMIT_REF ||
  ''
)

// https://vite.dev/config/
// Config is a function so we can gate dev-only instrumentation by build command
// (Phase 14I.1). `command` is 'serve' for the dev server (`vite`) and 'build'
// for a production build (`vite build`).
export default defineConfig(({ command }) => ({
  base: './',
  // kimi-plugin-inspect-react injects source-location data-* attributes
  // (internal file path + line/column) onto every JSX element so the LOCAL dev
  // inspector can map DOM → source. That instrumentation must NEVER ship to
  // production: register it ONLY for the dev server (`command === 'serve'`), so
  // `vite build` (all production/preview bundles) emits no such attributes. The
  // React plugin always runs.
  plugins: [...(command === 'serve' ? [inspectAttr()] : []), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
    __BUILD_TIME__:   JSON.stringify(BUILD_TIME),
    __BUILD_ENV__:    JSON.stringify(BUILD_ENV),
    __BUILD_BRANCH__: JSON.stringify(BUILD_BRANCH),
  },
}));
