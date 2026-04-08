// =============================================================================
// PAYMENT SUCCESS — BOUNCE PAGE
// =============================================================================
// Stripe redirects here after a successful checkout. This page is intentionally
// outside the proxy's protected routes (/dashboard/*, /profile/*, /admin/*) so
// that it loads even with sameSite: 'strict' cookies (which the browser
// withholds on cross-site navigations from checkout.stripe.com).
//
// From here we immediately issue a server-side redirect to /profile?upgrade=success.
// That follow-up request is same-site, so the session cookie is sent normally.
// =============================================================================

import type { Metadata } from 'next';
import Stripe from 'stripe';
import { redirect } from 'next/navigation';
import { getUserByEmail, setSupporterStatus } from '@/lib/repositories/users';

/**
 * Provides static page metadata for this route segment.
 */
export const metadata: Metadata = {
  title: 'Payment Successful — VideoSphere',
};

interface PaymentSuccessPageProps {
  searchParams?: Promise<{
    session_id?: string;
  }>;
}

const STRIPE_CHECKOUT_SESSION_ID_REGEX = /^cs_(test|live)_[A-Za-z0-9]+$/;

/**
 * Renders the payment success page component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export default async function PaymentSuccessPage({ searchParams }: PaymentSuccessPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const checkoutSessionId = resolvedSearchParams?.session_id;
  const shouldReconcileSupporterStatus =
    process.env.STRIPE_SUCCESS_RECONCILE === 'true' || process.env.NODE_ENV !== 'production';
  const hasPlausibleCheckoutSessionId = Boolean(
    checkoutSessionId && STRIPE_CHECKOUT_SESSION_ID_REGEX.test(checkoutSessionId)
  );

  // Best-effort reconciliation: if webhook delivery is delayed or not running locally,
  // confirm the checkout session and update supporter status before redirecting.
  if (shouldReconcileSupporterStatus && hasPlausibleCheckoutSessionId && checkoutSessionId) {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (stripeSecretKey) {
      try {
        const stripe = new Stripe(stripeSecretKey, {});
        const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
        let userId =
          session.client_reference_id ||
          (session.metadata?.userId ? String(session.metadata.userId) : null);
        const customerEmail = session.customer_details?.email?.trim().toLowerCase();
        const isCompleted = session.status === 'complete' || session.payment_status === 'paid';

        if (!userId && customerEmail) {
          const user = await getUserByEmail(customerEmail);
          userId = user?.userId ?? null;
        }

        if (userId && isCompleted) {
          await setSupporterStatus(userId, true);
        }
      } catch (err) {
        console.error('[PaymentSuccessPage] Failed to reconcile supporter status:', err);
      }
    }
  }

  redirect('/profile?upgrade=success');
}
