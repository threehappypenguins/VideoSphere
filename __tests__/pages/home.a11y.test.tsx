import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '@/__tests__/utils/a11y';

const mockIsFirstRunSetupPending = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/first-run-setup', () => ({
  isFirstRunSetupPending: (...args: unknown[]) => mockIsFirstRunSetupPending(...args),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import HomePage from '@/app/(marketing)/page';

describe('Home page accessibility', () => {
  beforeEach(() => {
    mockIsFirstRunSetupPending.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders semantic landmarks and heading hierarchy without axe violations', async () => {
    const { baseElement } = render(<main>{await HomePage()}</main>);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /upload once\. distribute everywhere\./i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /everything you need to grow your audience/i,
      })
    ).toBeInTheDocument();

    await expectNoAxeViolations(baseElement);
  });
});
