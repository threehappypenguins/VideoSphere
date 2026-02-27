# Payments Guide

## The Freemium Model

Your SaaS product must implement a **freemium model** — a business model where the core product is free, but premium features require a paid subscription.

### How It Works

| Tier        | Access                                  | Goal                           |
| ----------- | --------------------------------------- | ------------------------------ |
| **Free**    | Core features, limited usage            | Attract users, build user base |
| **Premium** | All features, unlimited usage, priority | Generate revenue               |

### Examples in Real Products

- **Spotify**: Free with ads → Premium without ads + downloads
- **GitHub**: Free repos → Pro with advanced features
- **Notion**: Free tier → Team/Business plans

## Feature Gating

Feature gating means showing or hiding features based on a user's subscription status.

### The Concept

You'll need a field on each user record that tracks their plan:

```typescript
// Example user type with subscription info
interface User {
  id: string;
  email: string;
  name: string;
  subscriptionStatus: 'free' | 'premium' | 'cancelled';
  // or simply:
  isPremium: boolean;
}
```

### Gating in the UI

```tsx
// Example: Show upgrade prompt or premium content
export default function FeatureSection({ user }: { user: User }) {
  if (!user.isPremium) {
    return (
      <div>
        <h2>Premium Feature</h2>
        <p>Upgrade to access this feature.</p>
        <a href="/pricing">Upgrade Now</a>
      </div>
    );
  }

  return (
    <div>
      <h2>Premium Feature</h2>
      {/* STUDENT: Render the premium feature content */}
    </div>
  );
}
```

### Server-Side Verification

> **Always verify subscription status on the server.** Never trust client-side checks alone.

A user can modify client-side JavaScript to bypass UI-only checks. Your API routes and Server Components must independently verify the user's subscription before returning premium data.

```typescript
// app/api/premium-data/route.ts
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user || !user.isPremium) {
    return Response.json({ error: 'Premium subscription required' }, { status: 403 });
  }

  // Only premium users reach this point
  const data = await getPremiumData();
  return Response.json(data);
}
```

## Stripe (Recommended)

[Stripe](https://stripe.com/) is the **recommended payment provider** for this project.

### Why Stripe?

- Industry standard for SaaS payments
- Excellent developer experience and documentation
- **Test mode** — build and test without processing real payments
- Generous free tier for development
- Handles all payment compliance (PCI DSS)

### Test Mode

Stripe's test mode lets you simulate the entire payment flow without real money.

**Test Card Numbers:**

| Card Number           | Scenario                 |
| --------------------- | ------------------------ |
| `4242 4242 4242 4242` | Successful payment       |
| `4000 0000 0000 3220` | 3D Secure authentication |
| `4000 0000 0000 0002` | Card declined            |

Use any future expiration date and any 3-digit CVC.

### Stripe Checkout (Simplest Path)

Stripe Checkout is a **hosted payment page** — Stripe handles the entire UI. This is the fastest way to integrate payments.

**Flow:**

1. User clicks "Upgrade" on your pricing page
2. Your API creates a Stripe Checkout Session
3. User is redirected to Stripe's hosted checkout page
4. User enters payment details on Stripe's secure page
5. After payment, user is redirected back to your app
6. Stripe sends a webhook to confirm the payment

### Stripe Webhooks

Webhooks let Stripe notify your app when events happen (subscription created, payment failed, etc.).

```typescript
// app/api/webhooks/stripe/route.ts
// STUDENT: Implement webhook handler
// Key events to handle:
// - checkout.session.completed — user just subscribed
// - customer.subscription.updated — plan changed
// - customer.subscription.deleted — subscription cancelled
// - invoice.payment_failed — payment failed
```

### Stripe Customer Portal

Stripe provides a hosted page where users can manage their subscription (cancel, change plan, update payment method). Less code for you to write.

### Getting Started with Stripe

1. Create a [Stripe account](https://dashboard.stripe.com/register)
2. Ensure you're in **Test mode** (toggle in the dashboard)
3. Get your test API keys from the Developers section
4. Add keys to `.env.local`:

```bash
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
```

5. Install the Stripe SDK:

```bash
pnpm add stripe
```

## Lemon Squeezy (Simpler Alternative)

[Lemon Squeezy](https://www.lemonsqueezy.com/) is a simpler alternative that handles more for you.

**Pros:**

- Handles tax compliance automatically
- Simpler API than Stripe
- Built-in affiliate system
- Good documentation

**Cons:**

- Less flexible than Stripe
- Smaller community
- Higher transaction fees

**Best for:** Teams who want payments working quickly with minimal code.

## Paddle (International Payments)

[Paddle](https://www.paddle.com/) is a merchant of record — they handle everything including taxes, invoicing, and compliance globally.

**Pros:**

- Handles international tax compliance
- Simpler than Stripe for global products
- Invoice generation built in

**Cons:**

- Less developer flexibility
- Approval process required

## Structuring the Upgrade Flow

Here's a typical upgrade flow in your UI:

```
1. User sees premium feature → "Upgrade to access"
2. User clicks "Upgrade" → redirected to Pricing page
3. User selects plan → redirected to Stripe Checkout
4. User completes payment → redirected to success page
5. Webhook updates user's subscription status
6. Premium features are now accessible
```

### Key Pages in the Upgrade Flow

- `/pricing` — shows plan comparison (already in the template)
- `/api/checkout` — creates a Stripe Checkout session (you implement)
- `/api/webhooks/stripe` — handles Stripe events (you implement)
- `/success` — confirmation page after payment (you create)
- `/profile` — shows current subscription status (already in the template)

## Implementation Checklist

- [ ] Choose a payment provider (Stripe recommended)
- [ ] Set up provider account in test mode
- [ ] Add API keys to `.env.local`
- [ ] Create checkout API route
- [ ] Create webhook handler
- [ ] Add subscription status field to user data
- [ ] Implement feature gating in UI and API
- [ ] Test with test card numbers
- [ ] Add upgrade/downgrade flows to profile page

## Useful Resources

- [Stripe Documentation](https://stripe.com/docs)
- [Stripe Next.js Examples](https://github.com/vercel/next.js/tree/canary/examples/with-stripe-typescript)
- [Lemon Squeezy Documentation](https://docs.lemonsqueezy.com/)
- [Paddle Documentation](https://developer.paddle.com/)
