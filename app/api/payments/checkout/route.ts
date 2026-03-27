// =============================================================================
// POST /api/payments/checkout
// =============================================================================
// Creates a Stripe Checkout Session for upgrading from Free to Supporter tier.
// Requires authentication. Returns the Stripe checkout session URL for redirect.
//
// Request: POST with no body (auth from session cookie)
// Response: { checkoutUrl: string }
// Errors: 401 (not authenticated), 500 (payment service not configured / Stripe error)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAuthenticatedUserId } from '@/lib/api/auth';

export async function POST(req: NextRequest) {
  try {
    // =========================================================================
    // 0. CSRF: verify the request originates from our own site
    // =========================================================================
    const origin = req.headers.get('origin');
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    if (!origin || new URL(origin).origin !== new URL(appUrl).origin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // =========================================================================
    // 1. Authenticate via shared helper (session cookie → Appwrite)
    // =========================================================================
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // =========================================================================
    // 2. Validate Stripe environment variables
    // =========================================================================
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      console.error('[POST /api/payments/checkout] STRIPE_SECRET_KEY not configured');
      return NextResponse.json({ error: 'Payment service not configured' }, { status: 500 });
    }

    // Instantiate Stripe after validating env to avoid capturing bad/empty configuration.
    const stripe = new Stripe(stripeSecretKey, {});

    // =========================================================================
    // 3. Create a Stripe Checkout Session
    // =========================================================================
    // Price: $9 one-time payment for Supporter tier
    // client_reference_id: userId so the webhook can identify which user paid
    const stripePriceId = process.env.STRIPE_PRICE_ID?.trim();

    // Stripe Checkout sessions require each line item to specify either:
    // - `price` (existing Price ID), or
    // - `price_data` (ad-hoc inline price definition).
    const lineItems = stripePriceId
      ? [{ price: stripePriceId, quantity: 1 }]
      : [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'VideoSphere Supporter Upgrade',
                description: 'Unlock unlimited uploads, all platforms, and premium AI',
              },
              unit_amount: 900, // $9.00 in cents
            },
            quantity: 1,
          },
        ];

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      client_reference_id: userId, // Store userId for webhook verification
      success_url: `${appUrl}/payment/success`,
      cancel_url: `${appUrl}/pricing`,
    });

    // =========================================================================
    // 4. Return the checkout session URL for client redirect
    // =========================================================================
    if (!checkoutSession.url) {
      console.error('[POST /api/payments/checkout] No URL returned from Stripe');
      return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
    }

    return NextResponse.json({ checkoutUrl: checkoutSession.url }, { status: 200 });
  } catch (err) {
    console.error('[POST /api/payments/checkout]', err);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
