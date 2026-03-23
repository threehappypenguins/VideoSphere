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

/**
 * Read the raw request body as bytes for webhook signature verification.
 * Stripe verifies signatures over the exact raw payload bytes.
 */
async function getRawBody(request: NextRequest): Promise<Buffer> {
  const arrayBuffer = await request.arrayBuffer();
  return Buffer.from(arrayBuffer);
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
      const errorMessage = signatureErr instanceof Error ? signatureErr.message : 'Unknown error';
      console.warn(`[POST /api/webhooks/stripe] Signature verification failed: ${errorMessage}`);
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
    }

    console.log(`[POST /api/webhooks/stripe] Received event type: ${event.type}`);

    // =========================================================================
    // 4. Handle checkout.session.completed events
    // =========================================================================
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      // Extract userId from `client_reference_id` first.
      // If absent, fall back to `metadata.userId` (Stripe Checkout metadata).
      const userId =
        session.client_reference_id ||
        // Stripe checkout session metadata values are always strings.
        (session.metadata?.userId ? String(session.metadata.userId) : null);

      if (!userId) {
        console.error(
          '[POST /api/webhooks/stripe] checkout.session.completed: Missing client_reference_id (userId)'
        );
        // Log the error but still return 200 so Stripe doesn't retry forever
        return NextResponse.json({ received: true }, { status: 200 });
      }

      try {
        // Set the user's isSupporter status to true using repository abstraction.
        await setSupporterStatus(userId, true);

        console.log(
          `[POST /api/webhooks/stripe] checkout.session.completed: Set isSupporter=true for userId=${userId}`
        );

        // Successfully updated user, return 200
        return NextResponse.json({ received: true }, { status: 200 });
      } catch (dbErr) {
        console.error(
          `[POST /api/webhooks/stripe] checkout.session.completed: Failed to update user tier:`,
          dbErr
        );

        // Return 500 so Stripe retries the webhook
        // Repeated setSupporterStatus(userId, true) calls are idempotent, so retries are safe
        // This ensures users don't get stuck on the Free tier due to transient database errors
        return NextResponse.json({ error: 'Failed to update user tier' }, { status: 500 });
      }
    }

    // =========================================================================
    // 5. Return success response for other recognized events
    // =========================================================================
    // Return 200 for all other event types so Stripe stops retrying.
    // We only take action on events we care about (checkout.session.completed).
    // Ignoring other events is fine — we can add handlers for them later.
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error('[POST /api/webhooks/stripe] Unexpected error:', err);
    // Return 500 so Stripe will retry the webhook
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
