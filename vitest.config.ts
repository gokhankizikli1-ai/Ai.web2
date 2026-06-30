import path from 'path';
import { defineConfig } from 'vitest/config';

// Minimal Vitest config for Sprint 1.8 — node environment, pure-logic unit
// tests only (no DOM / network / LLM). Reuses the app's `@` alias so tests can
// import from '@/lib/...'. Kept separate from vite.config.ts so the app's
// React/inspect plugins are not loaded for tests.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
