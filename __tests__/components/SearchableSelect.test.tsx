import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchableSelect } from '@/components/drafts/SearchableSelect';

describe('SearchableSelect', () => {
  const options = [
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'French' },
  ];

  beforeEach(() => {
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = () => false;
      HTMLElement.prototype.setPointerCapture = () => undefined;
      HTMLElement.prototype.releasePointerCapture = () => undefined;
    }
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => undefined;
    }
  });

  it('shows a None option by default and clears the selection', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <SearchableSelect
        id="test-select"
        value="en"
        options={options}
        onValueChange={onValueChange}
      />
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'None' }));
    expect(onValueChange).toHaveBeenCalledWith(undefined);
  });

  it('omits the None option when allowClear is false', async () => {
    const user = userEvent.setup();

    render(
      <SearchableSelect
        id="test-select"
        value="en"
        options={options}
        allowClear={false}
        onValueChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('option', { name: 'None' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'French' })).toBeInTheDocument();
  });

  it('sets aria-invalid on the combobox trigger when invalid is true', () => {
    render(
      <SearchableSelect
        id="test-select"
        value="en"
        options={options}
        invalid
        onValueChange={vi.fn()}
      />
    );

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  });
});
