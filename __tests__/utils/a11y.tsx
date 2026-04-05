import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { expect } from 'vitest';
import { axe } from 'vitest-axe';

export async function expectNoAxeViolations(root: Element) {
  expect(await axe(root)).toHaveNoViolations();
}

export function renderWithMain(ui: ReactElement, options?: RenderOptions) {
  return render(<main>{ui}</main>, options);
}
