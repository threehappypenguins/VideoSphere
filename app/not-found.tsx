// =============================================================================
// CUSTOM 404 PAGE
// =============================================================================
// This page is displayed when a user navigates to a route that doesn't exist.
//
// =============================================================================

import Link from 'next/link';

/**
 * Renders the not found component.
 * @returns The rendered UI output.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="text-center">
        <p className="text-6xl font-bold text-primary">404</p>
        <h1 className="mt-4 text-3xl font-bold text-foreground">Page Not Found</h1>
        <p className="mt-4 text-muted-foreground">
          Sorry, we couldn&apos;t find the page you&apos;re looking for. It might have been moved or
          doesn&apos;t exist.
        </p>
        <div className="mt-8">
          <Link
            href="/"
            className="inline-block rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go back home
          </Link>
        </div>
      </div>
    </div>
  );
}
