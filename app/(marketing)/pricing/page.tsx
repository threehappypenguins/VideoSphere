// =============================================================================
// PRICING PAGE
// =============================================================================
// Displays pricing tiers for your SaaS product.
//
// STUDENT: Replace ALL placeholder content with your actual pricing:
//   - Update tier names, prices, and features
//   - Wire up the CTA buttons to your payment processing (Stripe, etc.)
//   - See /docs/payments.md for guidance on implementing payments
//
// The upgrade/purchase buttons are currently non-functional placeholders.
// You must implement payment processing as part of your project requirements.
// =============================================================================

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Pricing',
  description: '[Your App Name] pricing plans — find the right plan for your needs.',
};

// STUDENT: Update these pricing tiers with your actual plans
const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: '/month',
    description: 'Perfect for getting started and exploring the platform.',
    features: [
      '[Feature included in free tier]',
      '[Another free feature]',
      '[Basic feature]',
      '[Limited usage feature]',
    ],
    cta: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$19',
    period: '/month',
    description: 'Best for professionals who need more power and features.',
    features: [
      'Everything in Free',
      '[Pro-only feature]',
      '[Advanced feature]',
      '[Priority support]',
      '[Higher limits]',
      '[Premium feature]',
    ],
    cta: 'Upgrade to Pro',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: '$49',
    period: '/month',
    description: 'For teams and organizations that need the full platform.',
    features: [
      'Everything in Pro',
      '[Enterprise feature]',
      '[Team management]',
      '[Custom integrations]',
      '[Dedicated support]',
      '[SLA guarantee]',
      '[Advanced analytics]',
    ],
    cta: 'Contact Sales',
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <div className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* --- Header --- */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            [Choose the plan that works best for you. Upgrade or downgrade at any time.]
          </p>
        </div>

        {/* --- Pricing Cards --- */}
        <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-xl border p-8 ${
                tier.highlighted
                  ? 'border-primary bg-primary/5 shadow-lg'
                  : 'border-border bg-background'
              }`}
            >
              {tier.highlighted && (
                <span className="mb-4 inline-block rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                  Most Popular
                </span>
              )}
              <h3 className="text-xl font-semibold text-foreground">{tier.name}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{tier.description}</p>

              <div className="mt-6">
                <span className="text-4xl font-bold text-foreground">{tier.price}</span>
                <span className="text-muted-foreground">{tier.period}</span>
              </div>

              <ul className="mt-8 space-y-3">
                {tier.features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <svg
                      className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              {/* STUDENT: Wire this button to your payment processing.
                  See /docs/payments.md for Stripe integration guidance. */}
              <Link
                href="/signup"
                className={`mt-8 block w-full rounded-lg px-4 py-3 text-center text-sm font-medium transition-colors ${
                  tier.highlighted
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-border text-foreground hover:bg-muted'
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
