/**
 * Real handler tests for POST /api/webhooks/stripe.
 *
 * These tests exercise the exported `POST(req)` route handler directly and
 * assert on the returned `NextResponse` status/body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const constructEventMock = vi.hoisted(() => vi.fn());
const setSupporterStatusMock = vi.hoisted(() => vi.fn());
const claimStripeWebhookEventMock = vi.hoisted(() => vi.fn());
const markStripeWebhookEventBookkeepingFailedMock = vi.hoisted(() => vi.fn());
const markStripeWebhookEventCompletedMock = vi.hoisted(() => vi.fn());
const markStripeWebhookEventFailedMock = vi.hoisted(() => vi.fn());
const deleteStripeWebhookEventMock = vi.hoisted(() => vi.fn());

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

vi.mock('@/lib/repositories/webhook-events', () => ({
  claimStripeWebhookEvent: claimStripeWebhookEventMock,
  markStripeWebhookEventBookkeepingFailed: markStripeWebhookEventBookkeepingFailedMock,
  markStripeWebhookEventCompleted: markStripeWebhookEventCompletedMock,
  markStripeWebhookEventFailed: markStripeWebhookEventFailedMock,
  deleteStripeWebhookEvent: deleteStripeWebhookEventMock,
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
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_webhook');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');

    claimStripeWebhookEventMock.mockResolvedValue({ claimed: true, status: 'processing' });
    markStripeWebhookEventBookkeepingFailedMock.mockResolvedValue(undefined);
    markStripeWebhookEventCompletedMock.mockResolvedValue(undefined);
    markStripeWebhookEventFailedMock.mockResolvedValue(undefined);
    deleteStripeWebhookEventMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('returns 403 when STRIPE_WEBHOOK_SECRET is missing', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');

    const res = await POST(
      createRequest({
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

  it('still processes webhooks when STRIPE_SECRET_KEY is missing', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');

    const rawBody = '{"id":"evt_test","type":"checkout.session.completed"}';
    const stripeSignature = 't=123,v1=abc';
    const webhookSecret = 'whsec_test_webhook';

    constructEventMock.mockReturnValueOnce({
      id: 'evt_test',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user_123',
          id: 'cs_test_1234567890',
        },
      },
    });
    setSupporterStatusMock.mockResolvedValueOnce(undefined);

    const res = await POST(createRequest({ rawBody, stripeSignature }));

    expect(res.status).toBe(200);
    expect(constructEventMock).toHaveBeenCalledWith(
      Buffer.from(rawBody),
      stripeSignature,
      webhookSecret
    );
    expect(claimStripeWebhookEventMock).toHaveBeenCalledWith(
      'evt_test',
      'checkout.session.completed'
    );
    expect(setSupporterStatusMock).toHaveBeenCalledWith('user_123', true);
    expect(markStripeWebhookEventCompletedMock).toHaveBeenCalledWith('evt_test');
    expect(await res.json()).toEqual({ received: true });
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await POST(
      createRequest({
        rawBody: '{"type":"checkout.session.completed"}',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request: missing stripe-signature header' });
    expect(constructEventMock).not.toHaveBeenCalled();
    expect(claimStripeWebhookEventMock).not.toHaveBeenCalled();
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
  });

  it('returns 400 when stripe.webhooks.constructEvent throws', async () => {
    constructEventMock.mockImplementationOnce(() => {
      throw new Error('bad signature');
    });

    const res = await POST(
      createRequest({
        rawBody: '{"type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid webhook signature' });
    expect(claimStripeWebhookEventMock).not.toHaveBeenCalled();
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
  });

  it('processes a new checkout.session.completed event successfully', async () => {
    const rawBody = '{"id":"evt_test","type":"checkout.session.completed"}';
    const stripeSignature = 't=123,v1=abc';
    const webhookSecret = 'whsec_test_webhook';

    constructEventMock.mockReturnValueOnce({
      id: 'evt_test',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user_123',
          id: 'cs_test_1234567890',
        },
      },
    });
    setSupporterStatusMock.mockResolvedValueOnce(undefined);

    const res = await POST(createRequest({ rawBody, stripeSignature }));

    expect(res.status).toBe(200);
    expect(constructEventMock).toHaveBeenCalledWith(
      Buffer.from(rawBody),
      stripeSignature,
      webhookSecret
    );
    expect(claimStripeWebhookEventMock).toHaveBeenCalledWith(
      'evt_test',
      'checkout.session.completed'
    );
    expect(setSupporterStatusMock).toHaveBeenCalledWith('user_123', true);
    expect(markStripeWebhookEventCompletedMock).toHaveBeenCalledWith('evt_test');
    expect(await res.json()).toEqual({ received: true });
  });

  it('receives the same event id twice and processes side effects only once', async () => {
    constructEventMock
      .mockReturnValueOnce({
        id: 'evt_duplicate',
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'user_123',
            id: 'cs_test_duplicate',
          },
        },
      })
      .mockReturnValueOnce({
        id: 'evt_duplicate',
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'user_123',
            id: 'cs_test_duplicate',
          },
        },
      });
    claimStripeWebhookEventMock
      .mockResolvedValueOnce({ claimed: true, status: 'processing' })
      .mockResolvedValueOnce({ claimed: false, status: 'completed' });
    setSupporterStatusMock.mockResolvedValueOnce(undefined);

    const firstRes = await POST(
      createRequest({
        rawBody: '{"id":"evt_duplicate","type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );
    const secondRes = await POST(
      createRequest({
        rawBody: '{"id":"evt_duplicate","type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(firstRes.status).toBe(200);
    expect(secondRes.status).toBe(200);
    expect(await secondRes.json()).toEqual({ received: true, duplicate: true });
    expect(setSupporterStatusMock).toHaveBeenCalledTimes(1);
    expect(markStripeWebhookEventCompletedMock).toHaveBeenCalledTimes(1);
  });

  it('returns 200 no-op for duplicate deliveries', async () => {
    claimStripeWebhookEventMock.mockResolvedValueOnce({ claimed: false, status: 'completed' });
    constructEventMock.mockReturnValueOnce({
      id: 'evt_duplicate',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user_123',
          id: 'cs_test_duplicate',
        },
      },
    });

    const res = await POST(
      createRequest({
        rawBody: '{"id":"evt_duplicate","type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
    expect(markStripeWebhookEventCompletedMock).not.toHaveBeenCalled();
    expect(markStripeWebhookEventFailedMock).not.toHaveBeenCalled();
    expect(deleteStripeWebhookEventMock).not.toHaveBeenCalled();
  });

  it('returns 200 for duplicate in-progress deliveries', async () => {
    claimStripeWebhookEventMock.mockResolvedValueOnce({ claimed: false, status: 'processing' });
    constructEventMock.mockReturnValueOnce({
      id: 'evt_in_progress',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user_123',
          id: 'cs_test_in_progress',
        },
      },
    });

    const res = await POST(
      createRequest({
        rawBody: '{"id":"evt_in_progress","type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true, inProgress: true });
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
  });

  it('returns 500 when event claim status is failed and requires retry', async () => {
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

    const res = await POST(
      createRequest({
        rawBody: '{"id":"evt_claim_failed","type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Webhook event claim requires retry' });
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
  });

  it('returns 200 when checkout.session.completed is missing client_reference_id', async () => {
    constructEventMock.mockReturnValueOnce({
      id: 'evt_missing_user',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: null,
          metadata: {},
          id: 'cs_test_1234567890',
        },
      },
    });

    const res = await POST(
      createRequest({
        rawBody: '{"id":"evt_missing_user","type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(res.status).toBe(200);
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
    expect(markStripeWebhookEventCompletedMock).toHaveBeenCalledWith('evt_missing_user');
    expect(await res.json()).toEqual({ received: true });
  });

  it('uses metadata.userId when client_reference_id is missing', async () => {
    const rawBody = '{"id":"evt_metadata","type":"checkout.session.completed"}';
    const stripeSignature = 't=123,v1=abc';
    const webhookSecret = 'whsec_test_webhook';

    constructEventMock.mockReturnValueOnce({
      id: 'evt_metadata',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: null,
          metadata: { userId: 'user_from_metadata' },
          id: 'cs_test_1234567890',
        },
      },
    });
    setSupporterStatusMock.mockResolvedValueOnce(undefined);

    const res = await POST(createRequest({ rawBody, stripeSignature }));

    expect(res.status).toBe(200);
    expect(constructEventMock).toHaveBeenCalledWith(
      Buffer.from(rawBody),
      stripeSignature,
      webhookSecret
    );
    expect(setSupporterStatusMock).toHaveBeenCalledWith('user_from_metadata', true);
    expect(markStripeWebhookEventCompletedMock).toHaveBeenCalledWith('evt_metadata');
    expect(await res.json()).toEqual({ received: true });
  });

  it('returns 200 for unhandled event types without updating the user', async () => {
    constructEventMock.mockReturnValueOnce({
      id: 'evt_unhandled',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_123',
        },
      },
    });

    const res = await POST(
      createRequest({
        rawBody: '{"id":"evt_unhandled","type":"payment_intent.succeeded"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(res.status).toBe(200);
    expect(setSupporterStatusMock).not.toHaveBeenCalled();
    expect(claimStripeWebhookEventMock).toHaveBeenCalledWith(
      'evt_unhandled',
      'payment_intent.succeeded'
    );
    expect(markStripeWebhookEventCompletedMock).toHaveBeenCalledWith('evt_unhandled');
    expect(await res.json()).toEqual({ received: true });
  });

  it('marks a failed event for retry and then succeeds on retry', async () => {
    constructEventMock
      .mockReturnValueOnce({
        id: 'evt_retryable',
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'user_123',
            id: 'cs_test_retryable',
          },
        },
      })
      .mockReturnValueOnce({
        id: 'evt_retryable',
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'user_123',
            id: 'cs_test_retryable',
          },
        },
      });
    setSupporterStatusMock
      .mockRejectedValueOnce(new Error('Appwrite unavailable'))
      .mockResolvedValueOnce(undefined);

    const firstRes = await POST(
      createRequest({
        rawBody: '{"id":"evt_retryable","type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(firstRes.status).toBe(500);
    expect(await firstRes.json()).toEqual({ error: 'Failed to process webhook event' });
    expect(markStripeWebhookEventFailedMock).toHaveBeenCalledWith(
      'evt_retryable',
      'Appwrite unavailable'
    );
    expect(deleteStripeWebhookEventMock).not.toHaveBeenCalled();

    const secondRes = await POST(
      createRequest({
        rawBody: '{"id":"evt_retryable","type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    expect(secondRes.status).toBe(200);
    expect(await secondRes.json()).toEqual({ received: true });
    expect(setSupporterStatusMock).toHaveBeenCalledTimes(2);
    expect(markStripeWebhookEventCompletedMock).toHaveBeenCalledWith('evt_retryable');
  });

  it('returns 200 with bookkeeping warning when completion update fails after side effects', async () => {
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

    const res = await POST(
      createRequest({
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

  it('allows only one side effect for near-simultaneous deliveries of the same event id', async () => {
    constructEventMock.mockReturnValue({
      id: 'evt_race',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user_123',
          id: 'cs_test_race',
        },
      },
    });

    let resolveFirstClaim: ((value: { claimed: true; status: 'processing' }) => void) | null = null;
    const firstClaimDeferred = new Promise<{ claimed: true; status: 'processing' }>((resolve) => {
      resolveFirstClaim = resolve;
    });

    claimStripeWebhookEventMock
      .mockImplementationOnce(() => firstClaimDeferred)
      .mockResolvedValueOnce({ claimed: false, status: 'processing' });
    setSupporterStatusMock.mockResolvedValueOnce(undefined);

    const firstPromise = POST(
      createRequest({
        rawBody: '{"id":"evt_race","type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );
    const secondPromise = POST(
      createRequest({
        rawBody: '{"id":"evt_race","type":"checkout.session.completed"}',
        stripeSignature: 't=123,v1=abc',
      })
    );

    // Ensure one request stays in-flight until we intentionally release the claim.
    await Promise.resolve();
    resolveFirstClaim?.({ claimed: true, status: 'processing' });

    const [firstRes, secondRes] = await Promise.all([firstPromise, secondPromise]);

    expect(firstRes.status).toBe(200);
    expect(secondRes.status).toBe(200);
    expect(setSupporterStatusMock).toHaveBeenCalledTimes(1);
    expect(markStripeWebhookEventCompletedMock).toHaveBeenCalledTimes(1);
    expect(markStripeWebhookEventFailedMock).not.toHaveBeenCalled();
    expect(deleteStripeWebhookEventMock).not.toHaveBeenCalled();
  });
});
