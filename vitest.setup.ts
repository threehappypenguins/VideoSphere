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
import { config as loadDotEnv } from 'dotenv';
import { expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

expect.extend(axeMatchers);

// Deterministic env loading for Vitest: load local overrides before modules import.
loadDotEnv({ path: '.env.local' });
loadDotEnv();

// Server modules (e.g. `lib/appwrite.ts`) validate env at import time; API route tests import them.
if (!process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT) {
  process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
}
if (!process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID) {
  process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
}
if (!process.env.APPWRITE_API_KEY) {
  process.env.APPWRITE_API_KEY = 'test-api-key';
}

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-vitest-only';
}

if (!process.env.JWT_SESSION_COOKIE_NAME) {
  process.env.JWT_SESSION_COOKIE_NAME = 'videosphere_session';
}

// Required for connected-accounts repository tests (token encryption at rest).
// Must be a 32-byte key, base64-encoded. This value is for testing only.
if (!process.env.APPWRITE_TOKEN_ENCRYPTION_KEY) {
  process.env.APPWRITE_TOKEN_ENCRYPTION_KEY = Buffer.from('A'.repeat(32)).toString('base64');
}

if (!process.env.TOKEN_ENCRYPTION_KEY) {
  process.env.TOKEN_ENCRYPTION_KEY = process.env.APPWRITE_TOKEN_ENCRYPTION_KEY;
}

if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/videosphere-test';
}
