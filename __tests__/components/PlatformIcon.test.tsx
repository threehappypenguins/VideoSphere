// =============================================================================
// PLATFORMICON COMPONENT TESTS
// =============================================================================
// Locks in SVGR inline SVG rendering and accessibility behavior (decorative vs
// named icon), preventing regressions from URL-based <img> rendering.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlatformIcon, PLATFORM_BRAND_ICONS } from '@/components/icons/PlatformIcon';
import { platformLabel } from '@/lib/ui/platform-label';

describe('PlatformIcon', () => {
  it('renders an inline svg element, not an img', () => {
    const { container } = render(<PlatformIcon platform="youtube" />);

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it.each(PLATFORM_BRAND_ICONS)('renders inline svg for %s platform assets', (platform) => {
    const { container } = render(<PlatformIcon platform={platform} />);

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('hides decorative icons from assistive technology by default', () => {
    const { container } = render(<PlatformIcon platform="youtube" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('hides decorative icons when decorative is explicitly true', () => {
    const { container } = render(<PlatformIcon platform="vimeo" decorative />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('exposes an accessible name when decorative is false', () => {
    render(<PlatformIcon platform="facebook" decorative={false} />);

    expect(screen.getByRole('img', { name: platformLabel('facebook') })).toBeInTheDocument();
  });

  it('uses the platform label as aria-label when decorative is false', () => {
    const { container } = render(<PlatformIcon platform="sermon_audio" decorative={false} />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('role', 'img');
    expect(svg).toHaveAttribute('aria-label', platformLabel('sermon_audio'));
    expect(svg).not.toHaveAttribute('aria-hidden');
  });
});
