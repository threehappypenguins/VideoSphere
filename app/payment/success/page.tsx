// =============================================================================
// PAYMENT SUCCESS — BOUNCE PAGE
// =============================================================================
// Stripe redirects here after a successful checkout. This page is intentionally
// outside the proxy's protected routes (/profile/*, /dashboard/*, /admin/*) so
// that it loads even with sameSite: 'strict' cookies (which the browser
// withholds on cross-site navigations from checkout.stripe.com).
//
// Once the page loads in the browser it performs a same-site navigation to
// /profile?upgrade=success, at which point the session cookie is sent normally.
// =============================================================================

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Payment Successful — VideoSphere',
};

export default function PaymentSuccessPage() {
  redirect('/profile?upgrade=success');
}
