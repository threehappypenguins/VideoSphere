// =============================================================================
// EDIT DRAFT PAGE COMPONENT TESTS
// =============================================================================
// Basic UI rendering tests for the Edit Draft page: verify form fields,
// actions, and navigation links render correctly.
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Import the page component
import EditDraftPage from '@/app/(dashboard)/dashboard/drafts/[id]/page';

describe('EditDraftPage', () => {
  it('renders the Edit Draft heading', async () => {
    const component = await EditDraftPage({
      params: Promise.resolve({ id: 'draft-123' }),
    });
    render(component);
    expect(screen.getByRole('heading', { name: /edit draft/i, level: 1 })).toBeInTheDocument();
  });

  it('displays the draft ID in the subtitle', async () => {
    const component = await EditDraftPage({
      params: Promise.resolve({ id: 'abc-xyz-789' }),
    });
    render(component);
    expect(screen.getByText('abc-xyz-789')).toBeInTheDocument();
  });

  it('renders the Metadata section with Title, Description, and Tags fields', async () => {
    const component = await EditDraftPage({
      params: Promise.resolve({ id: 'test-id' }),
    });
    render(component);

    // Labels
    expect(screen.getByLabelText(/^Title$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Description$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Tags$/)).toBeInTheDocument();
  });

  it('renders the Distribution section with Target Platforms', async () => {
    const component = await EditDraftPage({
      params: Promise.resolve({ id: 'test-id' }),
    });
    render(component);

    const targetPlatformsLabel = screen.getByText('Target Platforms');
    expect(targetPlatformsLabel).toBeInTheDocument();

    // Platform checkboxes
    expect(screen.getByRole('checkbox', { name: /youtube/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /vimeo/i })).toBeInTheDocument();
  });

  it('renders the Visibility select with correct options', async () => {
    const component = await EditDraftPage({
      params: Promise.resolve({ id: 'test-id' }),
    });
    render(component);

    const visibilitySelect = screen.getByRole('combobox', { name: /visibility/i });
    expect(visibilitySelect).toBeInTheDocument();
    expect(visibilitySelect).toHaveValue('public');

    // Check all visibility options are present
    expect(screen.getByRole('option', { name: 'Public' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Unlisted' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Private' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Scheduled' })).toBeInTheDocument();
  });

  it('renders Save draft button', async () => {
    const component = await EditDraftPage({
      params: Promise.resolve({ id: 'test-id' }),
    });
    render(component);

    const saveButton = screen.getByRole('button', { name: /save draft/i });
    expect(saveButton).toBeInTheDocument();
    expect(saveButton).toHaveClass('bg-primary');
  });

  it('renders Cancel link targeting /dashboard/drafts', async () => {
    const component = await EditDraftPage({
      params: Promise.resolve({ id: 'test-id' }),
    });
    render(component);

    const cancelLink = screen.getByRole('link', { name: /cancel/i });
    expect(cancelLink).toBeInTheDocument();
    expect(cancelLink).toHaveAttribute('href', '/dashboard/drafts');
  });

  it('renders all form input fields as uncontrolled with empty defaults', async () => {
    const component = await EditDraftPage({
      params: Promise.resolve({ id: 'test-id' }),
    });
    render(component);

    const titleInput = screen.getByRole('textbox', { name: /^Title$/ });
    const descriptionInput = screen.getByRole('textbox', { name: /^Description$/ });
    const tagsInput = screen.getByRole('textbox', { name: /^Tags$/ });

    expect(titleInput).toHaveValue('');
    expect(descriptionInput).toHaveValue('');
    expect(tagsInput).toHaveValue('');
  });

  it('renders Description textarea with 4 rows', async () => {
    const component = await EditDraftPage({
      params: Promise.resolve({ id: 'test-id' }),
    });
    render(component);

    const descriptionInput = screen.getByRole('textbox', {
      name: /^Description$/,
    }) as HTMLTextAreaElement;
    expect(descriptionInput).toHaveAttribute('rows', '4');
  });
});
