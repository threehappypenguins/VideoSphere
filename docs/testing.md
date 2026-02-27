# Testing Guide

## Why Testing Matters

Tests are your safety net. They verify that your code works correctly and catch regressions when you make changes. In a team environment, tests give everyone confidence that their changes don't break existing features.

Comprehensive test coverage is a path to a higher grade.

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
pnpm test:ui       # Open the Vitest UI in your browser
pnpm test:coverage # Generate a code coverage report
```

## Writing Your First Component Test

Here's a step-by-step example of testing a simple component.

### 1. Create a component

```tsx
// components/ui/Button.tsx
interface ButtonProps {
  label: string;
  onClick: () => void;
}

export default function Button({ label, onClick }: ButtonProps) {
  return (
    <button onClick={onClick} className="rounded bg-primary px-4 py-2 text-white">
      {label}
    </button>
  );
}
```

### 2. Write a test

```tsx
// components/ui/Button.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import Button from './Button';

describe('Button', () => {
  it('renders with the correct label', () => {
    render(<Button label="Click me" onClick={() => {}} />);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const handleClick = vi.fn();
    render(<Button label="Click me" onClick={handleClick} />);

    await userEvent.click(screen.getByText('Click me'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
```

### 3. Run the test

```bash
pnpm test
```

## Where to Put Test Files

You have two options — pick one and be consistent:

1. **Next to the file**: `components/ui/Button.test.tsx` (recommended)
2. **In `__tests__/`**: `__tests__/Button.test.tsx`

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
  await page.goto('http://localhost:3000');
  await expect(page).toHaveTitle(/Your App Name/);
});
```

## Useful Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Playwright Documentation](https://playwright.dev/)
- [Kent C. Dodds — Testing JavaScript](https://testingjavascript.com/)
