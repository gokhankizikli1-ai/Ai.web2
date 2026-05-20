import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
//
// Production cleanup: `inspectAttr()` injects the Kimi editor/inspect
// overlays (blue resize dots, drag handles, visual editor anchors) on
// every component. Useful during `vite` dev — never wanted in shipped
// builds. Gating it to `command === 'serve'` keeps the dev workflow
// unchanged while `vite build` produces a clean static UI for prod.
export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    ...(command === 'serve' ? [inspectAttr()] : []),
    react(),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
