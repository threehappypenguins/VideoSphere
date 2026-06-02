import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('Navbar accessibility', () => {
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

  it('exposes current-page semantics and keyboard mobile menu support without axe violations', async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<Navbar initialSessionUser={null} />);

    const menuButton = screen.getByRole('button', { name: /toggle navigation menu/i });
    expect(menuButton).toHaveAttribute('aria-controls', 'site-navigation-mobile-menu');

    const homeLink = screen.getByRole('link', { name: /videosphere/i });
    expect(homeLink).toHaveAttribute('aria-current', 'page');

    menuButton.focus();
    await user.keyboard('{Enter}');

    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument();

    await expectNoAxeViolations(baseElement);
  });
});
