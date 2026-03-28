/**
 * Tests for the /payment/success bounce page.
 *
 * Verifies the page calls redirect() to /profile?upgrade=success so that
 * Stripe's cross-site redirect resolves into a same-site navigation that
 * carries the session cookie.
 */
import { describe, it, expect, vi } from 'vitest';

const redirectMock = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error('NEXT_REDIRECT');
  },
}));

import PaymentSuccessPage from '@/app/payment/success/page';

describe('PaymentSuccessPage', () => {
  it('redirects to /profile?upgrade=success', () => {
    expect(() => PaymentSuccessPage()).toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/profile?upgrade=success');
  });
});
