'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface SessionUser {
  $id: string;
  name?: string;
  email?: string;
}

interface UserProfile {
  isSupporter: boolean;
  role?: string;
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

export function PricingCards() {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [isSupporter, setIsSupporter] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    async function loadAuthState() {
      try {
        // Fetch session to know if user is logged in
        const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });
        if (!sessionRes.ok) return;

        const data: SessionUser = await sessionRes.json();
        setSessionUser(data);

        // Fetch profile to check supporter status
        try {
          const profileRes = await fetch('/api/auth/profile', { credentials: 'include' });
          if (profileRes.ok) {
            const profile: UserProfile = await profileRes.json();
            setIsSupporter(profile.isSupporter);
            setIsAdmin(profile.role === 'admin');
          }
        } catch (err) {
          console.warn('[PricingCards] Failed to fetch profile:', err);
        }
      } catch (err) {
        console.warn('[PricingCards] Failed to fetch session:', err);
        setSessionUser(null);
      }
    }

    loadAuthState();
  }, []);

  const handleCheckout = async () => {
    if (isAdmin) {
      toast.error('Admin accounts do not require Supporter upgrades.');
      return;
    }

    // If not logged in, redirect to login with a return URL
    if (!sessionUser) {
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

      const { checkoutUrl } = await res.json();
      // Redirect to Stripe Checkout
      window.location.href = checkoutUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      toast.error(message);
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="mt-16 grid grid-cols-1 gap-8 font-sans md:grid-cols-2">
      {tiers.map((tier) => {
        const isFree = tier.name === 'Free';
        const isCurrentPlan = isFree ? sessionUser && !isSupporter : isSupporter;

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
            {isCurrentPlan && (
              <span
                className={`mb-4 inline-block rounded-full px-3 py-1 text-xs font-medium ${tier.highlighted ? 'bg-green-400/10 text-green-300' : 'bg-success/15 text-success'}`}
              >
                {isSupporter && !isFree ? 'Your Plan' : 'Current Plan'}
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
              {tier.features.map((feature, index) => (
                <li
                  key={index}
                  className={`flex items-start gap-3 text-sm ${tier.highlighted ? 'text-primary-foreground/80 [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]' : 'text-muted-foreground'}`}
                >
                  <svg
                    className={`mt-0.5 h-5 w-5 shrink-0 ${tier.highlighted ? 'text-primary-foreground' : 'text-primary'}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>

            {/* --- CTA Button --- */}
            {isFree ? (
              <Link
                href={sessionUser ? '/dashboard' : '/signup'}
                className="mt-8 block w-full rounded-lg border border-border px-4 py-3 text-center text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {sessionUser ? 'Go to Dashboard' : tier.cta}
              </Link>
            ) : isAdmin ? (
              <button
                type="button"
                disabled
                aria-label="Upgrade unavailable for admin users"
                className="mt-8 block w-full rounded-lg border border-border bg-muted px-4 py-3 text-center text-sm font-medium text-muted-foreground"
              >
                You are an admin
              </button>
            ) : isSupporter ? (
              <span
                className={`mt-8 block w-full rounded-lg border px-4 py-3 text-center text-sm font-medium ${tier.highlighted ? 'border-green-400/30 bg-green-400/10 text-green-300' : 'border-success/40 bg-success/10 text-success'}`}
              >
                ✓ Supporter Active
              </span>
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
                    Processing…
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
  );
}
