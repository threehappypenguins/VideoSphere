// PRICING PAGE — VideoSphere
// Two tiers: Free and Supporter
// Supporter CTA calls POST /api/payments/checkout and redirects to Stripe.

import type { Metadata } from 'next';
import { PricingCards } from './PricingCards';

export const metadata: Metadata = {
  title: 'Pricing — VideoSphere',
  description:
    'VideoSphere pricing — start free or upgrade to Supporter for unlimited uploads and premium features.',
};

export default function PricingPage() {
  return (
    <div className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        {/* --- Header --- */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            VideoSphere is free to start. Upgrade to Supporter whenever you&apos;re ready to unlock
            unlimited uploads and premium features — no subscription required.
          </p>
        </div>

        {/* --- Pricing Cards (client component for checkout interaction) --- */}
        <PricingCards />

        {/* --- FAQ note --- */}
        <p className="mt-12 text-center text-sm text-muted-foreground">
          Questions?{' '}
          <a href="mailto:support@videosphere.app" className="text-primary hover:text-primary/90">
            Contact us
          </a>{' '}
          and we&apos;ll be happy to help.
        </p>
      </div>
    </div>
  );
}
