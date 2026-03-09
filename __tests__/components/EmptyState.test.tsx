// =============================================================================
// EMPTYSTATE COMPONENT TESTS
// =============================================================================
// Locks in rendering: title always; description, icon, and CTA only when provided.
// CTA supports either href (Link/anchor) or onClick (button). Label requires an action.
// =============================================================================

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmptyState from '@/components/EmptyState';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('EmptyState', () => {
  it('always renders the title', () => {
    render(<EmptyState title="No items" />);
    expect(screen.getByRole('heading', { name: 'No items' })).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="No items" description="Add your first item to get started." />);
    expect(screen.getByText('Add your first item to get started.')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    render(<EmptyState title="No items" />);
    expect(screen.queryByText(/get started/i)).not.toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<EmptyState title="No items" icon={<span data-testid="custom-icon">Icon</span>} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    expect(screen.getByText('Icon')).toBeInTheDocument();
  });

  it('does not render icon when not provided', () => {
    render(<EmptyState title="No items" />);
    expect(screen.queryByTestId('custom-icon')).not.toBeInTheDocument();
  });

  it('renders CTA link when action has href (internal)', () => {
    render(<EmptyState title="No videos" action={{ label: 'Upload video', href: '/upload' }} />);
    const link = screen.getByRole('link', { name: 'Upload video' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/upload');
  });

  it('renders CTA link when action has external href', () => {
    render(
      <EmptyState title="Learn more" action={{ label: 'Docs', href: 'https://example.com/docs' }} />
    );
    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
  });

  it('renders CTA button when action has onClick', async () => {
    const onClick = vi.fn();
    render(<EmptyState title="Error" action={{ label: 'Try again', onClick }} />);
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button).toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not render CTA when action is not provided', () => {
    render(<EmptyState title="No items" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders title, description, and CTA when all provided', () => {
    render(
      <EmptyState
        title="No videos yet"
        description="Upload your first video."
        action={{ label: 'Upload video', href: '/upload' }}
      />
    );
    expect(screen.getByRole('heading', { name: 'No videos yet' })).toBeInTheDocument();
    expect(screen.getByText('Upload your first video.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload video' })).toHaveAttribute('href', '/upload');
  });

  it('renders icon, title, description, and CTA when all provided', () => {
    render(
      <EmptyState
        icon={<span data-testid="icon">📭</span>}
        title="No messages"
        description="Your inbox is empty."
        action={{ label: 'Refresh', onClick: () => {} }}
      />
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No messages' })).toBeInTheDocument();
    expect(screen.getByText('Your inbox is empty.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});
