import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { expect } from 'vitest';
import { configureAxe } from 'vitest-axe';

const axe = configureAxe({
  rules: {
    // JSDOM does not implement the canvas APIs used by this rule.
    'color-contrast': { enabled: false },
  },
});

/**
 * Runs axe-core against a rendered root element and asserts that no violations exist.
 * @param root - Root DOM element returned from Testing Library render helpers.
 * @returns A promise that resolves after the accessibility assertion completes.
 */
export async function expectNoAxeViolations(root: Element) {
  expect(await axe(root)).toHaveNoViolations();
}

/**
 * Renders test UI wrapped in a semantic main landmark for page-level accessibility tests.
 * @param ui - React element under test.
 * @param options - Optional Testing Library render options.
 * @returns The Testing Library render result.
 */
export function renderWithMain(ui: ReactElement, options?: RenderOptions) {
  return render(<main>{ui}</main>, options);
}
