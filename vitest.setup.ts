// =============================================================================
// VITEST SETUP
// =============================================================================
// This file runs before every test suite and sets up the testing environment.
// It imports jest-dom matchers which add custom assertions like:
//   - toBeInTheDocument()
//   - toHaveTextContent()
//   - toBeVisible()
//   - toBeDisabled()
//   and many more.
//
// See: https://github.com/testing-library/jest-dom
// =============================================================================

import '@testing-library/jest-dom';
import { expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

expect.extend(axeMatchers);

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width: 640px'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Keep tests hermetic: do not read .env files in Vitest setup.
// Force test-safe values before modules are imported.
process.env.JWT_SECRET = 'test-jwt-secret-for-vitest-only';
process.env.JWT_SESSION_COOKIE_NAME = 'videosphere_session';

// Required for connected-accounts repository tests (token encryption at rest).
// Must be a 32-byte key, base64-encoded. This value is for testing only.
process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('A'.repeat(32)).toString('base64');

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/videosphere-test';
