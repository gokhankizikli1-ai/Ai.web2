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
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
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
});
