// =============================================================================
// NAVBAR COMPONENT
// =============================================================================
// The main navigation bar displayed at the top of every page.
//
// STUDENT: Update this component with your app's branding and navigation:
//   - Replace the placeholder logo with your own
//   - Update navigation links to match your routes
//   - Style to match your design system
//   - The mobile menu uses a checkbox hack — no JavaScript required!
//     (You may replace this with a React state-based menu if you prefer)
//
// This is a Client Component because it uses interactive state for the
// mobile menu. See /docs/performance.md for Server vs Client Components.
// =============================================================================

'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* --- Logo --- */}
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="[Your App Name] logo" width={120} height={40} priority />
          </Link>

          {/* --- Desktop Navigation --- */}
          <div className="hidden items-center gap-8 md:flex">
            <Link
              href="/"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Home
            </Link>
            <Link
              href="/pricing"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Pricing
            </Link>
            <Link
              href="/about"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              About
            </Link>
            <Link
              href="/contact"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Contact
            </Link>
          </div>

          {/* --- Desktop Auth Buttons --- */}
          <div className="hidden items-center gap-4 md:flex">
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Sign up
            </Link>
          </div>

          {/* --- Mobile Menu Button --- */}
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? (
              // X icon
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              // Hamburger icon
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            )}
          </button>
        </div>

        {/* --- Mobile Menu --- */}
        {mobileMenuOpen && (
          <div className="border-t border-border pb-4 md:hidden">
            <div className="flex flex-col gap-2 pt-4">
              <Link
                href="/"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                Home
              </Link>
              <Link
                href="/pricing"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                Pricing
              </Link>
              <Link
                href="/about"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                About
              </Link>
              <Link
                href="/contact"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                Contact
              </Link>
              <hr className="my-2 border-border" />
              <Link
                href="/login"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="mx-3 rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                onClick={() => setMobileMenuOpen(false)}
              >
                Sign up
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
