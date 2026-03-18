/**
 * Real handler tests for Stripe checkout + webhook routes.
 *
 * This file was previously placeholder-like (hard-coded constants).
 * The tests below import and execute the actual exported route handlers,
 * while mocking Stripe and Appwrite dependencies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// `vi.mock` factories are hoisted, so mock fns must be declared with `vi.hoisted`.
const checkoutSessionCreateMock = vi.hoisted(() => vi.fn());
const constructEventMock = vi.hoisted(() => vi.fn());
const setSupporterStatusMock = vi.hoisted(() => vi.fn());
const accountGetMock = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => {
  const StripeMock = class {
    public checkout = {
      sessions: { create: checkoutSessionCreateMock },
    };

    constructor(..._args: any[]) {
      // Checkout uses instance; webhook uses static Stripe.webhooks.constructEvent.
    }
  };
  (StripeMock as any).webhooks = { constructEvent: constructEventMock };
  return { __esModule: true, default: StripeMock };
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
      constructor(..._args: any[]) {
        // no-op
      }
      get = accountGetMock;
    },
  };
});

vi.mock('@/lib/repositories/users', () => ({
  setSupporterStatus: setSupporterStatusMock,
}));

import { POST as checkoutPOST } from '@/app/api/payments/checkout/route';
import { POST as webhookPOST } from '@/app/api/webhooks/stripe/route';

function createCheckoutRequest({
  projectId,
  cookies,
}: {
  projectId: string;
  cookies?: Record<string, string>;
}): NextRequest {
  const cookieName = `a_session_${projectId}`;
  const cookieHeader = cookies ? `${cookieName}=${cookies[cookieName]}` : '';
  const url = new URL('http://localhost:3000/api/payments/checkout');

  return new NextRequest(url, {
    method: 'POST',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
    body: undefined,
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

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (stripeSignature !== undefined) headers['stripe-signature'] = stripeSignature;

  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

describe('Stripe integration (checkout + webhook)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APPWRITE_ENDPOINT', 'http://localhost/v1');
    vi.stubEnv('NEXT_PUBLIC_APPWRITE_PROJECT_ID', 'test-project');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');

    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_webhook');
    vi.stubEnv('STRIPE_PRICE_ID', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('Checkout Route (POST /api/payments/checkout)', () => {
    it('returns 401 when session cookie is missing', async () => {
      vi.stubEnv('NEXT_PUBLIC_APPWRITE_ENDPOINT', 'http://localhost/v1');
      vi.stubEnv('NEXT_PUBLIC_APPWRITE_PROJECT_ID', 'test-project');

      const req = createCheckoutRequest({
        projectId: 'test-project',
      });

      const res = await checkoutPOST(req);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Not authenticated' });

      expect(accountGetMock).not.toHaveBeenCalled();
      expect(checkoutSessionCreateMock).not.toHaveBeenCalled();
    });

    it('returns 500 when STRIPE_SECRET_KEY is missing', async () => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');

      accountGetMock.mockResolvedValueOnce({ $id: 'user_123' });

      const req = createCheckoutRequest({
        projectId: 'test-project',
        cookies: { 'a_session_test-project': 'session-secret' },
      });

      const res = await checkoutPOST(req);
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe('Payment service not configured');

      expect(checkoutSessionCreateMock).not.toHaveBeenCalled();
    });

    it('creates a Stripe checkout session and returns checkoutUrl', async () => {
      accountGetMock.mockResolvedValueOnce({ $id: 'user_123' });
      checkoutSessionCreateMock.mockResolvedValueOnce({
        url: 'https://checkout.stripe.com/pay/test',
      });

      const req = createCheckoutRequest({
        projectId: 'test-project',
        cookies: { 'a_session_test-project': 'session-secret' },
      });

      const res = await checkoutPOST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/test' });

      expect(checkoutSessionCreateMock).toHaveBeenCalledTimes(1);
      const call = checkoutSessionCreateMock.mock.calls[0]?.[0];
      expect(call.client_reference_id).toBe('user_123');
      expect(call.success_url).toContain('/profile?upgrade=success');
      expect(call.cancel_url).toContain('/pricing');
      expect(call.line_items).toEqual([
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

    it('uses STRIPE_PRICE_ID when provided', async () => {
      vi.stubEnv('STRIPE_PRICE_ID', 'price_test_123');

      accountGetMock.mockResolvedValueOnce({ $id: 'user_123' });
      checkoutSessionCreateMock.mockResolvedValueOnce({
        url: 'https://checkout.stripe.com/pay/test',
      });

      const req = createCheckoutRequest({
        projectId: 'test-project',
        cookies: { 'a_session_test-project': 'session-secret' },
      });

      const res = await checkoutPOST(req);
      expect(res.status).toBe(200);

      const call = checkoutSessionCreateMock.mock.calls[0]?.[0];
      expect(call.client_reference_id).toBe('user_123');
      expect(call.line_items).toEqual([{ price: 'price_test_123', quantity: 1 }]);
    });
  });

  describe('Webhook Route (POST /api/webhooks/stripe)', () => {
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
      expect(setSupporterStatusMock).not.toHaveBeenCalled();
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
      expect(setSupporterStatusMock).not.toHaveBeenCalled();
    });

    it('returns 400 when signature verification fails', async () => {
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
      const body = await res.json();
      expect(body.error).toBe('Invalid webhook signature');
      expect(setSupporterStatusMock).not.toHaveBeenCalled();
    });

    it('updates user for checkout.session.completed', async () => {
      constructEventMock.mockReturnValueOnce({
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'user_123',
            id: 'cs_test_123',
          },
        },
      });

      setSupporterStatusMock.mockResolvedValueOnce(undefined);

      const res = await webhookPOST(
        createWebhookRequest({
          rawBody: '{"id":"evt_test","type":"checkout.session.completed"}',
          stripeSignature: 't=123,v1=abc',
        })
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true });
      expect(setSupporterStatusMock).toHaveBeenCalledWith('user_123', true);
    });
  });
});
