// =============================================================================
// POST /api/webhooks/stripe
// =============================================================================
// Receives and processes Stripe webhook events. Verifies webhook signature and
// handles checkout.session.completed to set user's isSupporter status.
//
// This handler is idempotent — processing the same event twice causes no harm.
// Stripe may retry webhook delivery, and we must handle duplicates gracefully.
//
// Request: POST with raw body and stripe-signature header
// Success response variants:
// - { received: true }
// - { received: true, duplicate: true }
// - { received: true, bookkeepingWarning: true }
// - { received: true, ignored: true, nonRetryable: true, reason: string }
// Errors:
// - 400 missing stripe-signature header
// - 400 invalid webhook signature
// - 400 invalid webhook payload (missing event.id)
// - 403 missing webhook secret
// - 500 retry-required processing/claim failure
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { setSupporterStatus } from '@/lib/repositories/users';
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventBookkeepingFailed,
  markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed,
  markStripeWebhookEventNonRetryableFailed,
} from '@/lib/repositories/webhook-events';

const COMPLETION_UPDATE_RETRY_DELAYS_MS = [0, 100, 300] as const;

class NonRetryableWebhookProcessingError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'NonRetryableWebhookProcessingError';
    this.code = code;
  }
}

/**
 * Read the raw request body as bytes for webhook signature verification.
 * Stripe verifies signatures over the exact raw payload bytes.
 */
async function getRawBody(request: NextRequest): Promise<Buffer> {
  const arrayBuffer = await request.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function getEventId(event: Stripe.Event): string {
  return typeof event.id === 'string' ? event.id.trim() : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function tryMarkCompletedWithBackoff(
  eventId: string
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  let lastError: unknown;

  for (const delayMs of COMPLETION_UPDATE_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      await markStripeWebhookEventCompleted(eventId);
      return { ok: true };
    } catch (error) {
      lastError = error;
    }
  }

  return { ok: false, error: lastError };
}

async function processCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session | null;

  const userId =
    session?.client_reference_id ||
    (session?.metadata?.userId ? String(session.metadata.userId) : null);

  if (!userId) {
    throw new NonRetryableWebhookProcessingError(
      `[POST /api/webhooks/stripe] checkout.session.completed: Missing userId for eventId=${event.id}`,
      'missing_user_id'
    );
  }

  await setSupporterStatus(userId, true);

  console.log(
    `[POST /api/webhooks/stripe] checkout.session.completed: Set isSupporter=true for userId=${userId} eventId=${event.id}`
  );
}

async function processEvent(event: Stripe.Event): Promise<void> {
  if (event.type === 'checkout.session.completed') {
    await processCheckoutSessionCompleted(event);
  }
}

export async function POST(req: NextRequest) {
  try {
    // =========================================================================
    // 1. Verify Stripe webhook configuration
    // =========================================================================
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[POST /api/webhooks/stripe] STRIPE_WEBHOOK_SECRET not configured');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 403 });
    }

    // =========================================================================
    // 2. Require stripe-signature header (before reading body)
    // =========================================================================
    const stripeSignature = req.headers.get('stripe-signature');
    if (!stripeSignature) {
      console.warn('[POST /api/webhooks/stripe] Missing stripe-signature header');
      return NextResponse.json(
        { error: 'Invalid request: missing stripe-signature header' },
        { status: 400 }
      );
    }

    // =========================================================================
    // 3. Read raw body and verify signature using Stripe's constructEvent
    // =========================================================================
    const rawBody = await getRawBody(req);
    // Uses static method — no API key needed; only webhook secret is used for verification.
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(rawBody, stripeSignature, webhookSecret);
    } catch (signatureErr) {
      // Signature verification failed — reject the request
      const signatureErrorMessage =
        signatureErr instanceof Error ? signatureErr.message : 'Unknown error';
      console.warn(
        `[POST /api/webhooks/stripe] Signature verification failed: ${signatureErrorMessage}`
      );
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
    }

    const eventId = getEventId(event);
    if (!eventId) {
      console.error('[POST /api/webhooks/stripe] Verified event payload is missing event.id');
      return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
    }

    console.log(`[POST /api/webhooks/stripe] Received eventId=${eventId} eventType=${event.type}`);

    const claim = await claimStripeWebhookEvent(eventId, event.type);
    if (!claim.claimed) {
      if (claim.status === 'completed') {
        console.log(`[POST /api/webhooks/stripe] Duplicate event ignored: eventId=${eventId}`);
        return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
      }

      if (claim.status === 'processing') {
        console.warn(
          `[POST /api/webhooks/stripe] In-progress event requires retry: eventId=${eventId}`
        );
        return NextResponse.json(
          { error: 'Webhook event is already processing; retry required' },
          { status: 500 }
        );
      }

      console.warn(
        `[POST /api/webhooks/stripe] Event claim conflict requires retry: eventId=${eventId} status=${claim.status ?? 'unknown'}`
      );
      return NextResponse.json({ error: 'Webhook event claim requires retry' }, { status: 500 });
    }

    try {
      await processEvent(event);
    } catch (processingErr) {
      if (processingErr instanceof NonRetryableWebhookProcessingError) {
        console.warn(
          `[POST /api/webhooks/stripe] Non-retryable processing issue for eventId=${eventId}: ${processingErr.message}`
        );

        try {
          await markStripeWebhookEventNonRetryableFailed(eventId, processingErr.message);
        } catch (markNonRetryableErr) {
          console.error(
            `[POST /api/webhooks/stripe] Failed to mark eventId=${eventId} as non-retryable failed:`,
            markNonRetryableErr
          );
        }

        return NextResponse.json(
          {
            received: true,
            ignored: true,
            nonRetryable: true,
            reason: processingErr.code,
          },
          { status: 200 }
        );
      }

      console.error(
        `[POST /api/webhooks/stripe] Failed to process eventId=${eventId} eventType=${event.type}:`,
        processingErr
      );

      try {
        await markStripeWebhookEventFailed(eventId, errorMessage(processingErr));
      } catch (markFailedErr) {
        console.error(
          `[POST /api/webhooks/stripe] Failed to mark eventId=${eventId} as failed:`,
          markFailedErr
        );
      }

      return NextResponse.json({ error: 'Failed to process webhook event' }, { status: 500 });
    }

    try {
      const completionResult = await tryMarkCompletedWithBackoff(eventId);
      if (completionResult.ok === false) {
        throw completionResult.error;
      }

      return NextResponse.json({ received: true }, { status: 200 });
    } catch (completionErr) {
      console.error(
        `[POST /api/webhooks/stripe] Business logic succeeded but failed to mark eventId=${eventId} completed:`,
        completionErr
      );

      try {
        await markStripeWebhookEventBookkeepingFailed(eventId, errorMessage(completionErr));
      } catch (bookkeepingErr) {
        console.error(
          `[POST /api/webhooks/stripe] Failed to persist bookkeeping-failure terminal status for eventId=${eventId}:`,
          bookkeepingErr
        );

        return NextResponse.json(
          { error: 'Failed to persist webhook terminal status' },
          { status: 500 }
        );
      }

      // Side effects already ran; avoid re-running by acknowledging receipt.
      return NextResponse.json({ received: true, bookkeepingWarning: true }, { status: 200 });
    }
  } catch (err) {
    console.error('[POST /api/webhooks/stripe] Unexpected error:', err);
    // Return 500 so Stripe will retry the webhook
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
