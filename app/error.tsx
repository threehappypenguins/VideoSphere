// =============================================================================
// GLOBAL ERROR BOUNDARY
// =============================================================================
// This error boundary catches unhandled errors in your application.
// It follows the Next.js App Router error handling convention.
//
// Key points:
//   - This MUST be a Client Component ('use client')
//   - It receives `error` and `reset` props from Next.js
//   - The `reset` function attempts to re-render the route segment
//   - This catches errors in route segments and their children
//
// STUDENT: Style this to match your final design. You may also want to:
//   - Log errors to an error tracking service (e.g., Sentry)
//   - Show different messages based on error type
//   - Add a "Contact Support" link
//
// See Next.js docs: https://nextjs.org/docs/app/building-your-application/routing/error-handling
// =============================================================================

'use client';

import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // STUDENT: Log the error to an error reporting service
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="text-center">
        <p className="text-6xl font-bold text-red-500">!</p>
        <h1 className="mt-4 text-3xl font-bold text-foreground">Something went wrong</h1>
        <p className="mt-4 text-muted-foreground">
          An unexpected error occurred. Please try again.
        </p>
        <div className="mt-8">
          <button
            onClick={reset}
            className="inline-block rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
