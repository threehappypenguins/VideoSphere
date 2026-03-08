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

// Required for connected-accounts repository tests (token encryption at rest).
// Must be a 32-byte key, base64-encoded. This value is for testing only.
if (!process.env.APPWRITE_TOKEN_ENCRYPTION_KEY) {
  process.env.APPWRITE_TOKEN_ENCRYPTION_KEY = Buffer.from('A'.repeat(32)).toString('base64');
}
