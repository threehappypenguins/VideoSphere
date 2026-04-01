// =============================================================================
// LANDING PAGE (Home) — VideoSphere
// =============================================================================

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'VideoSphere — Upload Once, Distribute Everywhere',
  description:
    'VideoSphere lets video creators upload once and distribute to YouTube, Vimeo, and more — with AI-generated metadata and centralized performance tracking.',
};

export default function HomePage() {
  return (
    <div className="font-sans">
      {/* ===== HERO SECTION ===== */}
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Upload once. Distribute everywhere.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
            VideoSphere is the all-in-one platform for video creators. Publish to YouTube, Vimeo,
            and more from a single dashboard — with AI-powered metadata and unified analytics.
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
      <section className="border-t border-border bg-muted/30 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Everything you need to grow your audience
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Stop juggling tabs. VideoSphere streamlines every step — from upload to analytics.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {/* Feature Card 1 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl"
                aria-hidden
              >
                <svg
                  className="h-6 w-6 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground">Multi-Platform Distribution</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Publish your video to YouTube, Vimeo, and other platforms simultaneously. One
                upload, zero repetition — reach every audience without the extra effort.
              </p>
            </div>

            {/* Feature Card 2 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl"
                aria-hidden
              >
                <svg
                  className="h-6 w-6 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground">AI-Generated Metadata</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Let AI draft your titles, descriptions, and tags automatically. Override or
                fine-tune per platform so your content is always optimised for each audience.
              </p>
            </div>

            {/* Feature Card 3 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl"
                aria-hidden
              >
                <svg
                  className="h-6 w-6 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground">Centralised Tracking</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Monitor views, engagement, and distribution status across every platform from one
                dashboard. No more switching between apps to see how your content performs.
              </p>
            </div>

            {/* Feature Card 4 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl"
                aria-hidden
              >
                <svg
                  className="h-6 w-6 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground">Draft Management</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Save and iterate on metadata drafts before you go live. Set a default metadata
                template and override individual platforms whenever you need to.
              </p>
            </div>

            {/* Feature Card 5 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl"
                aria-hidden
              >
                <svg
                  className="h-6 w-6 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground">Secure by Default</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Your credentials and content are protected with Appwrite Auth. Platform connections
                use OAuth so VideoSphere never stores your passwords.
              </p>
            </div>

            {/* Feature Card 6 */}
            <div className="rounded-xl border border-border bg-background p-8">
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl"
                aria-hidden
              >
                <svg
                  className="h-6 w-6 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground">Supporter Tier</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Free accounts get started instantly. Upgrade to Supporter for unlimited uploads,
                priority processing, and early access to new distribution platforms.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== TESTIMONIALS SECTION ===== */}
      <section className="border-t border-border px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            What creators are saying
          </h2>

          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
            {/* Testimonial 1 */}
            <div className="rounded-xl border border-border p-8">
              <p className="text-sm text-muted-foreground">
                &ldquo;VideoSphere cut my upload workflow in half. I used to spend an hour copying
                descriptions between platforms — now it takes five minutes.&rdquo;
              </p>
              <div className="mt-6">
                <p className="text-sm font-semibold text-foreground">Jamie Reyes</p>
                <p className="text-sm text-muted-foreground">Independent Video Creator</p>
              </div>
            </div>

            {/* Testimonial 2 */}
            <div className="rounded-xl border border-border p-8">
              <p className="text-sm text-muted-foreground">
                &ldquo;The AI metadata suggestions are surprisingly good. They save me from staring
                at a blank description field every single upload.&rdquo;
              </p>
              <div className="mt-6">
                <p className="text-sm font-semibold text-foreground">Priya Nair</p>
                <p className="text-sm text-muted-foreground">Tech YouTuber &amp; Educator</p>
              </div>
            </div>

            {/* Testimonial 3 */}
            <div className="rounded-xl border border-border p-8">
              <p className="text-sm text-muted-foreground">
                &ldquo;Having all my platform analytics in one place finally gives me a clear
                picture of which content actually resonates with my audience.&rdquo;
              </p>
              <div className="mt-6">
                <p className="text-sm font-semibold text-foreground">Marcus Obi</p>
                <p className="text-sm text-muted-foreground">Filmmaker &amp; Content Strategist</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA SECTION ===== */}
      <section className="border-t border-border bg-muted/30 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Ready to simplify your workflow?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Join creators who have stopped wasting time on repetitive uploads. VideoSphere is free
            to start — no credit card required.
          </p>
          <div className="mt-8">
            <Link
              href="/signup"
              className="inline-block rounded-lg bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Start for Free
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
