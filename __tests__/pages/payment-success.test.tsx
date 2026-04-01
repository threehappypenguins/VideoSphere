/**
 * Tests for the /payment/success bounce page.
 *
 * Verifies the page calls redirect() to /profile?upgrade=success so that
 * Stripe's cross-site redirect resolves into a same-site navigation that
 * carries the session cookie.
 */
import { describe, it, expect, vi } from 'vitest';

const redirectMock = vi.fn();
const retrieveCheckoutSessionMock = vi.hoisted(() => vi.fn());
const setSupporterStatusMock = vi.hoisted(() => vi.fn());
const getUserByEmailMock = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => {
  const StripeMock = class {
    checkout = {
      sessions: {
        retrieve: retrieveCheckoutSessionMock,
      },
    };

    constructor(..._args: unknown[]) {}
  };
  return { __esModule: true, default: StripeMock };
});

vi.mock('@/lib/repositories/users', () => ({
  setSupporterStatus: setSupporterStatusMock,
  getUserByEmail: getUserByEmailMock,
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error('NEXT_REDIRECT');
  },
}));

import PaymentSuccessPage from '@/app/payment/success/page';

describe('PaymentSuccessPage', () => {
  it('redirects to /profile?upgrade=success', async () => {
    await expect(PaymentSuccessPage({})).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/profile?upgrade=success');
  });

  it('reconciles supporter status when paid session_id is present', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    retrieveCheckoutSessionMock.mockResolvedValueOnce({
      client_reference_id: 'user_123',
      payment_status: 'paid',
      metadata: {},
    });
    setSupporterStatusMock.mockResolvedValueOnce(undefined);

    await expect(
      PaymentSuccessPage({ searchParams: Promise.resolve({ session_id: 'cs_test_123' }) })
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(retrieveCheckoutSessionMock).toHaveBeenCalledWith('cs_test_123');
    expect(setSupporterStatusMock).toHaveBeenCalledWith('user_123', true);
    expect(redirectMock).toHaveBeenCalledWith('/profile?upgrade=success');
  });

  it('falls back to customer email when client_reference_id is missing', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    retrieveCheckoutSessionMock.mockResolvedValueOnce({
      client_reference_id: null,
      customer_details: { email: 'test@test.com' },
      payment_status: 'paid',
      status: 'complete',
      metadata: {},
    });
    getUserByEmailMock.mockResolvedValueOnce({ userId: 'user_by_email' });
    setSupporterStatusMock.mockResolvedValueOnce(undefined);

    await expect(
      PaymentSuccessPage({ searchParams: Promise.resolve({ session_id: 'cs_test_456' }) })
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(getUserByEmailMock).toHaveBeenCalledWith('test@test.com');
    expect(setSupporterStatusMock).toHaveBeenCalledWith('user_by_email', true);
  });
});
