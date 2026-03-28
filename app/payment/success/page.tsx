// =============================================================================
// PAYMENT SUCCESS — BOUNCE PAGE
// =============================================================================
// Stripe redirects here after a successful checkout. This page is intentionally
// outside the proxy's protected routes (/profile/*, /dashboard/*, /admin/*) so
// that it loads even with sameSite: 'strict' cookies (which the browser
// withholds on cross-site navigations from checkout.stripe.com).
//
// From here we immediately issue a server-side redirect to /profile?upgrade=success.
// That follow-up request is same-site, so the session cookie is sent normally.
// =============================================================================

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Payment Successful — VideoSphere',
};

export default function PaymentSuccessPage() {
  redirect('/profile?upgrade=success');
}
