// =============================================================================
// LANDING PAGE (Home)
// =============================================================================
// This is the main marketing landing page for your SaaS application.
//
// STUDENT: Replace ALL placeholder content with your actual product information:
//   - Hero section: your headline, tagline, and call-to-action
//   - Features section: your product's actual features
//   - Testimonials: real or realistic testimonials
//   - CTA section: your actual conversion messaging
//
// This page uses Server Components by default (no 'use client' directive).
// See /docs/performance.md for when to use Server vs Client Components.
// =============================================================================

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '[Your App Name] — [Your Tagline Here]',
  description: '[Describe what your SaaS product does in 1-2 sentences for SEO]',
};

export default function HomePage() {
  return (
    <div>
      {/* ===== HERO SECTION ===== */}
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            [Your Headline Here]
          </h1>
          <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
            [Your subheadline — explain the key value proposition of your product in one or two
            compelling sentences that make visitors want to learn more.]
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/signup"
              className="w-full rounded-lg bg-primary px-8 py-3 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
            >
              Get Started Free
            </Link>
            <Link
              href="/pricing"
              className="w-full rounded-lg border border-border px-8 py-3 text-center text-sm font-medium text-foreground transition-colors hover:bg-muted sm:w-auto"
            >
              View Pricing
            </Link>
          </div>
        </div>
      </section>

      {/* ===== FEATURES SECTION ===== */}
      {/* STUDENT: Replace these placeholder features with your actual product features */}
      <section className="border-t border-border bg-muted/30 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Everything you need to [achieve goal]
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              [Brief description of your feature set and how it helps users]
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {/* Feature Card 1 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl">
                ⚡
              </div>
              <h3 className="text-lg font-semibold text-foreground">[Feature One]</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                [Describe this feature and the benefit it provides to users. Keep it concise and
                focused on value.]
              </p>
            </div>

            {/* Feature Card 2 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl">
                🔒
              </div>
              <h3 className="text-lg font-semibold text-foreground">[Feature Two]</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                [Describe this feature and the benefit it provides to users. Keep it concise and
                focused on value.]
              </p>
            </div>

            {/* Feature Card 3 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl">
                📊
              </div>
              <h3 className="text-lg font-semibold text-foreground">[Feature Three]</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                [Describe this feature and the benefit it provides to users. Keep it concise and
                focused on value.]
              </p>
            </div>

            {/* Feature Card 4 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl">
                🤖
              </div>
              <h3 className="text-lg font-semibold text-foreground">[Feature Four]</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                [Describe this feature and the benefit it provides to users. Keep it concise and
                focused on value.]
              </p>
            </div>

            {/* Feature Card 5 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl">
                🚀
              </div>
              <h3 className="text-lg font-semibold text-foreground">[Feature Five]</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                [Describe this feature and the benefit it provides to users. Keep it concise and
                focused on value.]
              </p>
            </div>

            {/* Feature Card 6 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl">
                💬
              </div>
              <h3 className="text-lg font-semibold text-foreground">[Feature Six]</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                [Describe this feature and the benefit it provides to users. Keep it concise and
                focused on value.]
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== TESTIMONIALS SECTION ===== */}
      {/* STUDENT: Replace with real or realistic testimonials */}
      <section className="border-t border-border px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            What our users are saying
          </h2>

          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
            {/* Testimonial 1 */}
            <div className="rounded-xl border border-border p-8">
              <p className="text-sm text-muted-foreground">
                &ldquo;[Testimonial text — a short, positive quote about how the product helped this
                user achieve their goals.]&rdquo;
              </p>
              <div className="mt-6">
                <p className="text-sm font-semibold text-foreground">[Person Name]</p>
                <p className="text-sm text-muted-foreground">[Job Title], [Company]</p>
              </div>
            </div>

            {/* Testimonial 2 */}
            <div className="rounded-xl border border-border p-8">
              <p className="text-sm text-muted-foreground">
                &ldquo;[Testimonial text — a short, positive quote about how the product helped this
                user achieve their goals.]&rdquo;
              </p>
              <div className="mt-6">
                <p className="text-sm font-semibold text-foreground">[Person Name]</p>
                <p className="text-sm text-muted-foreground">[Job Title], [Company]</p>
              </div>
            </div>

            {/* Testimonial 3 */}
            <div className="rounded-xl border border-border p-8">
              <p className="text-sm text-muted-foreground">
                &ldquo;[Testimonial text — a short, positive quote about how the product helped this
                user achieve their goals.]&rdquo;
              </p>
              <div className="mt-6">
                <p className="text-sm font-semibold text-foreground">[Person Name]</p>
                <p className="text-sm text-muted-foreground">[Job Title], [Company]</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA SECTION ===== */}
      <section className="border-t border-border bg-muted/30 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Ready to get started?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            [Final call-to-action message — give visitors one last compelling reason to sign up.]
          </p>
          <div className="mt-8">
            <Link
              href="/signup"
              className="inline-block rounded-lg bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Start Your Free Trial
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
