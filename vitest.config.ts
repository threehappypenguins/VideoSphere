// =============================================================================
// VITEST CONFIGURATION
// =============================================================================
// Vitest is a fast unit testing framework that works great with React and
// Next.js. This file configures the test environment.
//
// Run tests:
//   pnpm test             — run tests in watch mode
//   pnpm test:ui          — open the Vitest UI in your browser
//   pnpm test:coverage    — generate a coverage report
//
// See /docs/testing.md for guidance on writing tests.
// =============================================================================

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    include: ['**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
