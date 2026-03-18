// =============================================================================
// PAYMENTS ROUTE TESTS
// =============================================================================
// Handler-level tests that invoke the actual exported Next.js route handlers
// while mocking Stripe + Appwrite dependencies.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// `vi.mock` factories are hoisted, so these mocks must be declared with
// `vi.hoisted` to avoid initialization-order issues.
const checkoutSessionCreateMock = vi.hoisted(() => vi.fn());
const constructEventMock = vi.hoisted(() => vi.fn());
const updateUserMock = vi.hoisted(() => vi.fn());
const accountGetMock = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => {
  return {
    __esModule: true,
    default: class StripeMock {
      public checkout = {
        sessions: {
          create: checkoutSessionCreateMock,
        },
      };

      public webhooks = {
        constructEvent: constructEventMock,
      };

      constructor(..._args: any[]) {
        // no-op
      }
    },
  };
});

vi.mock('node-appwrite', () => {
  return {
    __esModule: true,
    Client: class ClientMock {
      setEndpoint() {
        return this;
      }
      setProject() {
        return this;
      }
      setSession() {
        return this;
      }
    },
    Account: class AccountMock {
      constructor(..._args: any[]) {}
      get = accountGetMock;
    },
  };
});

vi.mock('@/lib/repositories/users', () => ({
  updateUser: updateUserMock,
}));

import { POST as checkoutPOST } from '@/app/api/payments/checkout/route';
import { POST as webhookPOST } from '@/app/api/webhooks/stripe/route';

function createCheckoutRequest({
  projectId,
  sessionSecret,
}: {
  projectId: string;
  sessionSecret?: string;
}): NextRequest {
  const url = new URL('http://localhost:3000/api/payments/checkout');
  const cookieName = `a_session_${projectId}`;

  return new NextRequest(url, {
    method: 'POST',
    headers: sessionSecret ? { Cookie: `${cookieName}=${sessionSecret}` } : {},
  });
}

function createWebhookRequest({
  rawBody,
  stripeSignature,
}: {
  rawBody: string;
  stripeSignature?: string;
}): NextRequest {
  const url = new URL('http://localhost:3000/api/webhooks/stripe');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (stripeSignature !== undefined) headers['stripe-signature'] = stripeSignature;

  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

describe('Payments route handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubEnv('NEXT_PUBLIC_APPWRITE_ENDPOINT', 'http://localhost/v1');
    vi.stubEnv('NEXT_PUBLIC_APPWRITE_PROJECT_ID', 'test-project');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');

    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('POST /api/payments/checkout', () => {
    it('returns 401 when session cookie is missing', async () => {
      const res = await checkoutPOST(createCheckoutRequest({ projectId: 'test-project' }));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Not authenticated' });
      expect(accountGetMock).not.toHaveBeenCalled();
      expect(checkoutSessionCreateMock).not.toHaveBeenCalled();
    });

    it('returns 500 when STRIPE_SECRET_KEY is missing', async () => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      vi.stubEnv('STRIPE_PRICE_ID', '');

      accountGetMock.mockResolvedValueOnce({ $id: 'user_123' });

      const res = await checkoutPOST(
        createCheckoutRequest({
          projectId: 'test-project',
          sessionSecret: 'session-secret',
        })
      );

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Payment service not configured');
      expect(checkoutSessionCreateMock).not.toHaveBeenCalled();
    });

    it('creates checkout session and returns checkoutUrl', async () => {
      vi.stubEnv('STRIPE_PRICE_ID', '');

      accountGetMock.mockResolvedValueOnce({ $id: 'user_123' });
      checkoutSessionCreateMock.mockResolvedValueOnce({
        url: 'https://checkout.stripe.com/pay/test',
      });

      const res = await checkoutPOST(
        createCheckoutRequest({
          projectId: 'test-project',
          sessionSecret: 'session-secret',
        })
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/test' });

      expect(checkoutSessionCreateMock).toHaveBeenCalledTimes(1);
      const stripeArgs = checkoutSessionCreateMock.mock.calls[0]?.[0];
      expect(stripeArgs.client_reference_id).toBe('user_123');
      expect(stripeArgs.success_url).toContain('/profile?upgrade=success');
      expect(stripeArgs.cancel_url).toContain('/pricing');
      expect(stripeArgs.line_items).toEqual([
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'VideoSphere Supporter Upgrade',
              description: 'Unlock unlimited uploads, all platforms, and premium AI',
            },
            unit_amount: 900,
          },
          quantity: 1,
        },
      ]);
    });
  });

  describe('POST /api/webhooks/stripe', () => {
    it('returns 403 when STRIPE_WEBHOOK_SECRET is missing', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');

      const res = await webhookPOST(
        createWebhookRequest({
          rawBody: '{"type":"checkout.session.completed"}',
          stripeSignature: 't=123,v1=abc',
        })
      );

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Webhook secret not configured' });
      expect(constructEventMock).not.toHaveBeenCalled();
      expect(updateUserMock).not.toHaveBeenCalled();
    });

    it('returns 400 when stripe-signature header is missing', async () => {
      const res = await webhookPOST(
        createWebhookRequest({
          rawBody: '{"type":"checkout.session.completed"}',
        })
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Invalid request: missing stripe-signature header',
      });
      expect(constructEventMock).not.toHaveBeenCalled();
      expect(updateUserMock).not.toHaveBeenCalled();
    });

    it('returns 400 when constructEvent throws', async () => {
      constructEventMock.mockImplementationOnce(() => {
        throw new Error('bad signature');
      });

      const res = await webhookPOST(
        createWebhookRequest({
          rawBody: '{"type":"checkout.session.completed"}',
          stripeSignature: 't=123,v1=abc',
        })
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid webhook signature' });
      expect(updateUserMock).not.toHaveBeenCalled();
    });

    it('updates user and returns 200 for checkout.session.completed', async () => {
      constructEventMock.mockReturnValueOnce({
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'user_123',
            id: 'cs_test_123',
          },
        },
      });

      updateUserMock.mockResolvedValueOnce({ userId: 'user_123', isSupporter: true });

      const res = await webhookPOST(
        createWebhookRequest({
          rawBody: '{"id":"evt_test","type":"checkout.session.completed"}',
          stripeSignature: 't=123,v1=abc',
        })
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true });
      expect(updateUserMock).toHaveBeenCalledWith('user_123', { isSupporter: true });
    });
  });
});
