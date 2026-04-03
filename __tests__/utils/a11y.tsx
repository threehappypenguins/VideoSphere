import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { axe } from 'vitest-axe';

export async function expectNoAxeViolations(root: Element | Document) {
  expect(await axe(root)).toHaveNoViolations();
}

export function renderWithMain(ui: ReactElement, options?: RenderOptions) {
  return render(<main>{ui}</main>, options);
}
