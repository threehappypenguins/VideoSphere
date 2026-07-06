# Testing Guide

## Why Testing Matters

Tests are your safety net. They verify that your code works correctly and catch regressions when you make changes. In a team environment, tests give everyone confidence that their changes don't break existing features.

## Vitest — Our Testing Framework

This project uses [Vitest](https://vitest.dev/) instead of Jest. Vitest is:

- **Faster** — uses Vite's transform pipeline
- **Compatible** — uses the same API as Jest (`describe`, `it`, `expect`)
- **Modern** — native ESM support, TypeScript out of the box
- **Integrated** — works seamlessly with React and Next.js

## Types of Tests

| Type            | What It Tests                        | Tools                          |
| --------------- | ------------------------------------ | ------------------------------ |
| **Unit**        | Individual functions and utilities   | Vitest                         |
| **Component**   | React components in isolation        | Vitest + Testing Library       |
| **Integration** | Multiple components working together | Vitest + Testing Library       |
| **End-to-End**  | Full user flows in a real browser    | Playwright (not installed yet) |

## Running Tests

```bash
pnpm test          # Run tests in watch mode (re-runs on file changes)
pnpm test:a11y     # Run only the accessibility-focused Vitest + axe suite
pnpm test:ui       # Open the Vitest UI in your browser
pnpm test:coverage # Generate a code coverage report
```

Accessibility checks live in files matching `**/*.a11y.test.{ts,tsx}` and run with `vitest-axe` plus `axe-core` under `jsdom`.
They are excluded from the default `pnpm test` / `pnpm test run` suite and should be run with `pnpm test:a11y`.
Use them for runtime accessibility concerns that linting cannot fully verify, such as rendered landmarks, ARIA state, and labelled form controls.

## Manual upload flow (draft `document`, R2, distribute)

For presign → `curl` to R2 → complete → distribute, and for the **`document`** JSON on **`drafts`** and **`platform_uploads`**, see **[draft-document-and-upload-testing.md](/draft-document-and-upload-testing)**.

## Writing a Component Test

This project keeps tests under `__tests__/`, mirroring the source layout. Here is a real example from `__tests__/components/EmptyState.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmptyState from '@/components/EmptyState';

describe('EmptyState', () => {
  it('always renders the title', () => {
    render(<EmptyState title="No items" />);
    expect(screen.getByRole('heading', { name: 'No items' })).toBeInTheDocument();
  });

  it('calls onClick when the CTA button is clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<EmptyState title="No items" action={{ label: 'Add item', onClick }} />);
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

Run a single file:

```bash
pnpm test run __tests__/components/EmptyState.test.tsx
```

## Where to Put Test Files

You have two options — pick one and be consistent:

1. **In `__tests__/`** (project convention): `__tests__/components/EmptyState.test.tsx`
2. **Next to the file**: `components/EmptyState.test.tsx`

## Interpreting Test Results

```
 ✓ components/ui/Button.test.tsx (2 tests)
   ✓ Button > renders with the correct label
   ✓ Button > calls onClick when clicked

 Test Files  1 passed (1)
      Tests  2 passed (2)
```

### Coverage Report

Run `pnpm test:coverage` to see how much of your code is tested:

```
 File           | % Stmts | % Branch | % Funcs | % Lines |
 -------------- | ------- | -------- | ------- | ------- |
 Button.tsx     |     100 |      100 |     100 |     100 |
```

Aim for meaningful coverage, not 100% — focus on testing critical business logic and user interactions.

## Adding Playwright for E2E Testing

For end-to-end testing (testing complete user flows in a real browser):

```bash
pnpm add -D @playwright/test
npx playwright install
```

Create a test:

```typescript
// e2e/home.spec.ts
import { test, expect } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('http://localhost:9624');
  await expect(page).toHaveTitle(/Your App Name/);
});
```

## Useful Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Playwright Documentation](https://playwright.dev/)
- [Kent C. Dodds — Testing JavaScript](https://testingjavascript.com/)
