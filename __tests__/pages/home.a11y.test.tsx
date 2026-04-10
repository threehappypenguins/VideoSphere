import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '@/app/(marketing)/page';
import { expectNoAxeViolations } from '@/__tests__/utils/a11y';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('Home page accessibility', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders semantic landmarks and heading hierarchy without axe violations', async () => {
    const { baseElement } = render(
      <main>
        <HomePage />
      </main>
    );

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
