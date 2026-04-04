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
// Response: { received: true } on success
// Errors: 400 (invalid signature), 403 (missing webhook secret), 500 (internal error)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { setSupporterStatus } from '@/lib/repositories/users';
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed,
} from '@/lib/repositories/webhook-events';

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

async function processCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session | null;

  const userId =
    session?.client_reference_id ||
    (session?.metadata?.userId ? String(session.metadata.userId) : null);

  if (!userId) {
    console.error(
      `[POST /api/webhooks/stripe] checkout.session.completed: Missing userId for eventId=${event.id}`
    );
    return;
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
        console.log(
          `[POST /api/webhooks/stripe] Duplicate in-progress event acknowledged: eventId=${eventId}`
        );
        return NextResponse.json(
          { received: true, duplicate: true, inProgress: true },
          { status: 200 }
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
      await markStripeWebhookEventCompleted(eventId);
      return NextResponse.json({ received: true }, { status: 200 });
    } catch (completionErr) {
      console.error(
        `[POST /api/webhooks/stripe] Business logic succeeded but failed to mark eventId=${eventId} completed:`,
        completionErr
      );

      // Side effects already ran; avoid re-running by acknowledging receipt.
      return NextResponse.json({ received: true, bookkeepingWarning: true }, { status: 200 });
    }
  } catch (err) {
    console.error('[POST /api/webhooks/stripe] Unexpected error:', err);
    // Return 500 so Stripe will retry the webhook
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
