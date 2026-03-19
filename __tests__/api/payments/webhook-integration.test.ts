/**
 * Real handler tests for POST /api/webhooks/stripe.
 *
 * These tests exercise the exported `POST(req)` route handler directly and
 * assert on the returned `NextResponse` status/body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// `vi.mock` is hoisted to the top of the file, so the mock functions must be
// created via `vi.hoisted` to avoid "Cannot access ... before initialization".
const constructEventMock = vi.hoisted(() => vi.fn());
const setSupporterStatusMock = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => {
  const StripeMock = class {
    constructor(..._args: any[]) {
      // Route uses static Stripe.webhooks.constructEvent; no instance needed.
    }
  };
  (StripeMock as any).webhooks = { constructEvent: constructEventMock };
  return { __esModule: true, default: StripeMock };
});

vi.mock('@/lib/repositories/users', () => ({
  setSupporterStatus: setSupporterStatusMock,
}));

import { POST } from '@/app/api/webhooks/stripe/route';

function createRequest({
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
  if (stripeSignature !== undefined) {
    headers['stripe-signature'] = stripeSignature;
  }

  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default config: can be overridden per-test.
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_webhook');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('returns 403 when STRIPE_WEBHOOK_SECRET is missing', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');

    const req = createRequest({
      rawBody: '{"type":"checkout.session.completed"}',
      stripeSignature: 't=123,v1=abc',
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Webhook secret not configured');
    expect(constructEventMock).not.toHaveBeenCalled();
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
  });

  it('still processes webhooks when STRIPE_SECRET_KEY is missing', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');

    const rawBody = '{"id":"evt_test","type":"checkout.session.completed"}';
    const stripeSignature = 't=123,v1=abc';
    const webhookSecret = 'whsec_test_webhook';
    const userId = 'user_123';

    constructEventMock.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: userId,
          id: 'cs_test_1234567890',
        },
      },
    });

    setSupporterStatusMock.mockResolvedValueOnce(undefined);

    const res = await POST(
      createRequest({
        rawBody,
        stripeSignature,
      })
    );

    expect(res.status).toBe(200);
    expect(constructEventMock).toHaveBeenCalledWith(
      Buffer.from(rawBody),
      stripeSignature,
      webhookSecret
    );
    expect(setSupporterStatusMock).toHaveBeenCalledWith(userId, true);
    expect(await res.json()).toEqual({ received: true });
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const req = createRequest({
      rawBody: '{"type":"checkout.session.completed"}',
      stripeSignature: undefined,
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request: missing stripe-signature header');
    expect(constructEventMock).not.toHaveBeenCalled();
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
  });

  it('returns 400 when stripe.webhooks.constructEvent throws', async () => {
    constructEventMock.mockImplementationOnce(() => {
      throw new Error('bad signature');
    });

    const req = createRequest({
      rawBody: '{"type":"checkout.session.completed"}',
      stripeSignature: 't=123,v1=abc',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid webhook signature');
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
  });

  it('returns 200 and updates the user for checkout.session.completed', async () => {
    const rawBody = '{"id":"evt_test","type":"checkout.session.completed"}';
    const stripeSignature = 't=123,v1=abc';
    const webhookSecret = 'whsec_test_webhook';
    const userId = 'user_123';

    constructEventMock.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: userId,
          id: 'cs_test_1234567890',
        },
      },
    });

    setSupporterStatusMock.mockResolvedValueOnce(undefined);

    const res = await POST(
      createRequest({
        rawBody,
        stripeSignature,
      })
    );

    expect(res.status).toBe(200);
    expect(constructEventMock).toHaveBeenCalledWith(
      Buffer.from(rawBody),
      stripeSignature,
      webhookSecret
    );
    expect(setSupporterStatusMock).toHaveBeenCalledWith(userId, true);
    const body = await res.json();
    expect(body).toEqual({ received: true });
  });

  it('returns 200 when checkout.session.completed is missing client_reference_id', async () => {
    const req = createRequest({
      rawBody: '{"id":"evt_test","type":"checkout.session.completed"}',
      stripeSignature: 't=123,v1=abc',
    });

    constructEventMock.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: null,
          metadata: {},
          id: 'cs_test_1234567890',
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toEqual({ received: true });
  });

  it('uses checkout.session.completed metadata.userId when client_reference_id is missing', async () => {
    const rawBody = '{"id":"evt_test","type":"checkout.session.completed"}';
    const stripeSignature = 't=123,v1=abc';
    const webhookSecret = 'whsec_test_webhook';
    const userId = 'user_from_metadata';

    constructEventMock.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: null,
          metadata: { userId },
          id: 'cs_test_1234567890',
        },
      },
    });

    setSupporterStatusMock.mockResolvedValueOnce(undefined);

    const res = await POST(
      createRequest({
        rawBody,
        stripeSignature,
      })
    );

    expect(res.status).toBe(200);
    expect(constructEventMock).toHaveBeenCalledWith(
      Buffer.from(rawBody),
      stripeSignature,
      webhookSecret
    );
    expect(setSupporterStatusMock).toHaveBeenCalledWith(userId, true);
    expect(await res.json()).toEqual({ received: true });
  });

  it('returns 200 for unhandled event types without updating the user', async () => {
    constructEventMock.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          client_reference_id: 'user_123',
          id: 'pi_test_123',
        },
      },
    });

    const res = await POST(
      createRequest({
        rawBody: '{"type":"payment_intent.succeeded"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(res.status).toBe(200);
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toEqual({ received: true });
  });

  it('returns 500 when setSupporterStatus throws', async () => {
    constructEventMock.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user_123',
          id: 'cs_test_1234567890',
        },
      },
    });

    setSupporterStatusMock.mockRejectedValueOnce(new Error('Appwrite unavailable'));

    const res = await POST(
      createRequest({
        rawBody: '{"type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to update user tier');
  });

  it('returns 500 on unexpected errors in the handler', async () => {
    // Cause a crash inside the checkout.session.completed branch.
    constructEventMock.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: null,
      },
    });

    const res = await POST(
      createRequest({
        rawBody: '{"type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
  });
});
