// PRICING PAGE — VideoSphere
// Two tiers: Free and Supporter
// Stripe / checkout not yet implemented — CTAs link to /signup.

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Pricing — VideoSphere',
  description:
    'VideoSphere pricing — start free or upgrade to Supporter for unlimited uploads and premium features.',
};

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: '/month',
    description: 'Everything you need to get started distributing your videos.',
    features: [
      '10 uploads per month',
      'Distribute to 2 platforms',
      'Basic AI-generated metadata',
      'Draft & metadata management',
      'Centralised distribution tracking',
    ],
    cta: 'Get Started Free',
    ctaHref: '/signup',
    highlighted: false,
  },
  {
    name: 'Supporter',
    price: '$9',
    period: '/one-time',
    description: 'For creators who are serious about reaching every audience.',
    features: [
      'Everything in Free',
      'Unlimited uploads',
      'Distribute to all platforms',
      'Premium AI-generated metadata',
      'Scheduled publishing',
      'Priority processing',
      'Early access to new platforms',
    ],
    cta: 'Become a Supporter',
    ctaHref: '/signup',
    highlighted: true,
  },
];

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

        {/* --- Pricing Cards --- */}
        <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2">
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

              <Link
                href={tier.ctaHref}
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
