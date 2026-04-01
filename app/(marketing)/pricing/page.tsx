// PRICING PAGE — VideoSphere
// Two tiers: Free and Supporter
// Supporter CTA calls POST /api/payments/checkout and redirects to Stripe.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface SessionUser {
  $id: string;
  name?: string;
  email?: string;
  prefs?: {
    isSupporter?: boolean;
  };
}

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
    highlighted: true,
  },
] as const;

export default function PricingPage() {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadSession() {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'include' });
        if (!res.ok) return;

        const user = (await res.json()) as SessionUser;
        if (!isCancelled) setSessionUser(user);
      } catch (err) {
        console.warn('[PricingPage] Failed to fetch session:', err);
        if (!isCancelled) setSessionUser(null);
      }
    }

    loadSession();
    return () => {
      isCancelled = true;
    };
  }, []);

  const isLoggedIn = sessionUser !== null;
  const isSupporter = sessionUser?.prefs?.isSupporter === true;

  const handleCheckout = async () => {
    if (!isLoggedIn) {
      router.push('/login?redirect=/pricing');
      return;
    }

    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error || 'Failed to create checkout session');
      }

      const { checkoutUrl } = (await res.json()) as { checkoutUrl?: string };
      if (!checkoutUrl) throw new Error('Failed to create checkout session');

      window.location.href = checkoutUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      toast.error(message);
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="px-4 py-20 font-sans sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        {/* --- Header --- */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="text-shadow-bg mt-4 text-lg font-medium text-foreground">
            VideoSphere is free to start. Upgrade to Supporter whenever you&apos;re ready to unlock
            unlimited uploads and premium features — no subscription required.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-8 font-sans md:grid-cols-2">
          {tiers.map((tier) => {
            const isFreeTier = tier.name === 'Free';
            const showCurrentPlanBadge = isLoggedIn && isFreeTier && !isSupporter;
            const showSupporterPlanBadge = isLoggedIn && !isFreeTier && isSupporter;

            return (
              <div
                key={tier.name}
                className={`rounded-xl border p-8 ${
                  tier.highlighted
                    ? 'border-primary bg-primary/70 shadow-lg'
                    : 'border-border bg-background'
                }`}
              >
                {tier.highlighted && !isSupporter && (
                  <span className="mb-4 inline-block rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                    Most Popular
                  </span>
                )}

                {showCurrentPlanBadge && (
                  <span className="mb-4 inline-block rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">
                    Current Plan
                  </span>
                )}

                {showSupporterPlanBadge && (
                  <span className="mb-4 inline-block rounded-full bg-green-400/10 px-3 py-1 text-xs font-medium text-green-300">
                    Your Plan
                  </span>
                )}

                <h3
                  className={`text-xl font-semibold ${tier.highlighted ? 'text-primary-foreground' : 'text-foreground'}`}
                >
                  {tier.name}
                </h3>
                <p
                  className={`mt-2 text-sm ${tier.highlighted ? 'text-primary-foreground/80 [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]' : 'text-muted-foreground'}`}
                >
                  {tier.description}
                </p>

                <div className="mt-6">
                  <span
                    className={`text-4xl font-bold ${tier.highlighted ? 'text-primary-foreground' : 'text-foreground'}`}
                  >
                    {tier.price}
                  </span>
                  <span
                    className={
                      tier.highlighted
                        ? 'text-primary-foreground/70 [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]'
                        : 'text-muted-foreground'
                    }
                  >
                    {tier.period}
                  </span>
                </div>

                <ul className="mt-8 space-y-3">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className={`flex items-start gap-3 text-sm ${tier.highlighted ? 'text-primary-foreground/80 [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]' : 'text-muted-foreground'}`}
                    >
                      <svg
                        className={`mt-0.5 h-5 w-5 shrink-0 ${tier.highlighted ? 'text-primary-foreground' : 'text-primary'}`}
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

                {isFreeTier ? (
                  <Link
                    href={isLoggedIn ? '/dashboard' : '/signup'}
                    className="mt-8 block w-full rounded-lg border border-border px-4 py-3 text-center text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    {isLoggedIn ? 'Go to Dashboard' : tier.cta}
                  </Link>
                ) : isSupporter ? (
                  <span className="mt-8 block w-full rounded-lg border border-green-400/30 bg-green-400/10 px-4 py-3 text-center text-sm font-medium text-green-300">
                    Supporter Active
                  </span>
                ) : !isLoggedIn ? (
                  <Link
                    href="/signup"
                    className="mt-8 block w-full rounded-lg bg-primary px-4 py-3 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {tier.cta}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={handleCheckout}
                    disabled={checkoutLoading}
                    aria-label="Upgrade to Supporter tier"
                    className="mt-8 block w-full rounded-lg bg-primary px-4 py-3 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {checkoutLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <svg
                          className="h-4 w-4 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Processing...
                      </span>
                    ) : (
                      tier.cta
                    )}
                  </button>
                )}
              </div>
            );
          })}
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
