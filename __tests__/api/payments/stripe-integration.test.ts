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
const getUserByIdMock = vi.hoisted(() => vi.fn());
const claimStripeWebhookEventMock = vi.hoisted(() => vi.fn());
const markStripeWebhookEventBookkeepingFailedMock = vi.hoisted(() => vi.fn());
const markStripeWebhookEventCompletedMock = vi.hoisted(() => vi.fn());
const markStripeWebhookEventFailedMock = vi.hoisted(() => vi.fn());
const markStripeWebhookEventNonRetryableFailedMock = vi.hoisted(() => vi.fn());
const deleteStripeWebhookEventMock = vi.hoisted(() => vi.fn());

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
  getUserById: getUserByIdMock,
}));

vi.mock('@/lib/repositories/webhook-events', () => ({
  claimStripeWebhookEvent: claimStripeWebhookEventMock,
  markStripeWebhookEventBookkeepingFailed: markStripeWebhookEventBookkeepingFailedMock,
  markStripeWebhookEventCompleted: markStripeWebhookEventCompletedMock,
  markStripeWebhookEventFailed: markStripeWebhookEventFailedMock,
  markStripeWebhookEventNonRetryableFailed: markStripeWebhookEventNonRetryableFailedMock,
  deleteStripeWebhookEvent: deleteStripeWebhookEventMock,
}));

import { POST as checkoutPOST } from '@/app/api/payments/checkout/route';
import { POST as webhookPOST } from '@/app/api/webhooks/stripe/route';

function createCheckoutRequest({
  projectId,
  cookies,
  origin = 'http://localhost:3000',
  url,
  extraHeaders,
}: {
  projectId: string;
  cookies?: Record<string, string>;
  origin?: string | null;
  url?: string;
  extraHeaders?: Record<string, string>;
}): NextRequest {
  const cookieName = `a_session_${projectId}`;
  const cookieHeader = cookies ? `${cookieName}=${cookies[cookieName]}` : '';
  const requestUrl = new URL(url ?? 'http://localhost:3000/api/payments/checkout');

  const headers: Record<string, string> = { ...extraHeaders };
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  if (origin) headers['Origin'] = origin;

  return new NextRequest(requestUrl, {
    method: 'POST',
    headers,
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
    getUserByIdMock.mockResolvedValue({ role: 'user' });
    claimStripeWebhookEventMock.mockResolvedValue({ claimed: true, status: 'processing' });
    markStripeWebhookEventBookkeepingFailedMock.mockResolvedValue(undefined);
    markStripeWebhookEventCompletedMock.mockResolvedValue(undefined);
    markStripeWebhookEventFailedMock.mockResolvedValue(undefined);
    markStripeWebhookEventNonRetryableFailedMock.mockResolvedValue(undefined);
    deleteStripeWebhookEventMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('Checkout Route (POST /api/payments/checkout)', () => {
    it('returns 403 when Origin header is missing', async () => {
      const req = createCheckoutRequest({
        projectId: 'test-project',
        origin: null,
      });

      const res = await checkoutPOST(req);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Forbidden' });
    });

    it('returns 403 when Origin does not match app URL', async () => {
      const req = createCheckoutRequest({
        projectId: 'test-project',
        origin: 'https://evil-site.com',
      });

      const res = await checkoutPOST(req);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Forbidden' });
    });

    describe('CSRF – forwarded host (Codespaces / devcontainers)', () => {
      const CODESPACE_HOST = 'psychic-tribble-q7ggrwvq9gxv29q7p.app.github.dev';

      it('accepts a *.app.github.dev Origin via Host header in non-production mode', async () => {
        // NODE_ENV is 'test' (not 'production'), so the dev path is taken.
        // The handler derives hostOrigin from req.nextUrl.protocol + Host header.
        // CSRF passes → handler falls through to auth and returns 401 (no cookie), not 403.
        const req = createCheckoutRequest({
          projectId: 'test-project',
          url: `https://${CODESPACE_HOST}/api/payments/checkout`,
          origin: `https://${CODESPACE_HOST}`,
          extraHeaders: { host: CODESPACE_HOST },
        });

        const res = await checkoutPOST(req);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Not authenticated' });
      });

      it('accepts a *.app.github.dev Origin via x-forwarded-host in production mode', async () => {
        vi.stubEnv('NODE_ENV', 'production');

        const req = createCheckoutRequest({
          projectId: 'test-project',
          origin: `https://${CODESPACE_HOST}`,
          extraHeaders: {
            host: CODESPACE_HOST,
            'x-forwarded-host': CODESPACE_HOST,
            'x-forwarded-proto': 'https',
          },
        });

        // CSRF passes → 401 (no session cookie), not 403.
        const res = await checkoutPOST(req);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Not authenticated' });
      });

      it('rejects an x-forwarded-host that does not match the *.app.github.dev allowlist', async () => {
        vi.stubEnv('NODE_ENV', 'production');

        const req = createCheckoutRequest({
          projectId: 'test-project',
          origin: 'https://evil.domain.com',
          extraHeaders: {
            host: 'evil.domain.com',
            'x-forwarded-host': 'evil.domain.com',
            'x-forwarded-proto': 'https',
          },
        });

        const res = await checkoutPOST(req);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Forbidden' });
      });

      it('rejects a matching x-forwarded-host when x-forwarded-proto is not https', async () => {
        vi.stubEnv('NODE_ENV', 'production');

        const req = createCheckoutRequest({
          projectId: 'test-project',
          origin: `http://${CODESPACE_HOST}`,
          extraHeaders: {
            host: CODESPACE_HOST,
            'x-forwarded-host': CODESPACE_HOST,
            'x-forwarded-proto': 'http',
          },
        });

        const res = await checkoutPOST(req);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Forbidden' });
      });
    });

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

    it('returns 403 when authenticated user has admin role', async () => {
      accountGetMock.mockResolvedValueOnce({ $id: 'admin_123' });
      getUserByIdMock.mockResolvedValueOnce({ role: 'admin' });

      const req = createCheckoutRequest({
        projectId: 'test-project',
        cookies: { 'a_session_test-project': 'session-secret' },
      });

      const res = await checkoutPOST(req);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: 'Forbidden',
        message: 'Admin accounts do not require supporter upgrades',
      });
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
      expect(call.success_url).toContain('/payment/success');
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
      expect(claimStripeWebhookEventMock).not.toHaveBeenCalled();
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
      expect(claimStripeWebhookEventMock).not.toHaveBeenCalled();
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
      expect(claimStripeWebhookEventMock).not.toHaveBeenCalled();
      expect(setSupporterStatusMock).not.toHaveBeenCalled();
    });

    it('updates user for checkout.session.completed', async () => {
      constructEventMock.mockReturnValueOnce({
        id: 'evt_test',
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
      expect(claimStripeWebhookEventMock).toHaveBeenCalledWith(
        'evt_test',
        'checkout.session.completed'
      );
      expect(setSupporterStatusMock).toHaveBeenCalledWith('user_123', true);
      expect(markStripeWebhookEventCompletedMock).toHaveBeenCalledWith('evt_test');
    });

    it('returns 200 no-op for duplicate webhook deliveries', async () => {
      claimStripeWebhookEventMock.mockResolvedValueOnce({ claimed: false, status: 'completed' });
      constructEventMock.mockReturnValueOnce({
        id: 'evt_duplicate',
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'user_123',
            id: 'cs_test_123',
          },
        },
      });

      const res = await webhookPOST(
        createWebhookRequest({
          rawBody: '{"id":"evt_duplicate","type":"checkout.session.completed"}',
          stripeSignature: 't=123,v1=abc',
        })
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, duplicate: true });
      expect(setSupporterStatusMock).not.toHaveBeenCalled();
      expect(markStripeWebhookEventCompletedMock).not.toHaveBeenCalled();
    });

    it('returns 500 when webhook event claim indicates retry is required', async () => {
      claimStripeWebhookEventMock.mockResolvedValueOnce({ claimed: false, status: 'failed' });
      constructEventMock.mockReturnValueOnce({
        id: 'evt_claim_failed',
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'user_123',
            id: 'cs_test_claim_failed',
          },
        },
      });

      const res = await webhookPOST(
        createWebhookRequest({
          rawBody: '{"id":"evt_claim_failed","type":"checkout.session.completed"}',
          stripeSignature: 't=123,v1=abc',
        })
      );

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Webhook event claim requires retry' });
      expect(setSupporterStatusMock).not.toHaveBeenCalled();
    });

    it('returns 200 with bookkeeping warning when completion status update fails', async () => {
      constructEventMock.mockReturnValueOnce({
        id: 'evt_completion_mark_fail',
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'user_123',
            id: 'cs_test_completion_mark_fail',
          },
        },
      });
      setSupporterStatusMock.mockResolvedValueOnce(undefined);
      markStripeWebhookEventCompletedMock.mockRejectedValue(new Error('Appwrite update outage'));

      const res = await webhookPOST(
        createWebhookRequest({
          rawBody: '{"id":"evt_completion_mark_fail","type":"checkout.session.completed"}',
          stripeSignature: 't=123,v1=abc',
        })
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, bookkeepingWarning: true });
      expect(setSupporterStatusMock).toHaveBeenCalledWith('user_123', true);
      expect(markStripeWebhookEventCompletedMock).toHaveBeenCalledTimes(3);
      expect(markStripeWebhookEventBookkeepingFailedMock).toHaveBeenCalledWith(
        'evt_completion_mark_fail',
        'Appwrite update outage'
      );
      expect(markStripeWebhookEventFailedMock).not.toHaveBeenCalled();
      expect(deleteStripeWebhookEventMock).not.toHaveBeenCalled();
    });
  });
});
