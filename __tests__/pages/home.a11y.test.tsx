import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '@/app/(marketing)/page';
import Navbar from '@/components/layout/Navbar';
import { expectNoAxeViolations } from '@/__tests__/utils/a11y';

const mockPathname = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => mockPathname(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ alt, priority: _priority, ...rest }: any) => (
    <span role="img" aria-label={alt} {...rest} />
  ),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'system',
    setTheme: vi.fn(),
    resolvedTheme: 'light',
  }),
}));

vi.mock('@/lib/auth-client', () => ({
  logout: vi.fn(),
}));

describe('Home page accessibility', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders semantic landmarks, heading hierarchy, and descriptive image alt text without axe violations', async () => {
    const { baseElement } = render(
      <>
        <Navbar initialSessionUser={null} initialHasAdminRole={false} />
        <main>
          <HomePage />
        </main>
      </>
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
    expect(screen.getByRole('img', { name: /videosphere logo/i })).toBeInTheDocument();

    await expectNoAxeViolations(baseElement);
  });
});
