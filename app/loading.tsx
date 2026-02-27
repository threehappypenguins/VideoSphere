// =============================================================================
// GLOBAL LOADING STATE
// =============================================================================
// This loading component is shown automatically by Next.js while a route
// segment is loading. It uses React Suspense under the hood.
//
// How it works:
//   - Next.js wraps your page in a <Suspense> boundary with this as the fallback
//   - While the page component is loading (data fetching, etc.), this is shown
//   - Once the page is ready, Next.js swaps this out for the actual content
//
// STUDENT: You can also create route-specific loading states by adding a
// loading.tsx file in any route segment directory. For example:
//   - app/(dashboard)/dashboard/loading.tsx — loading state for the dashboard
//   - app/(admin)/admin/dashboard/loading.tsx — loading state for admin
//
// See Next.js docs: https://nextjs.org/docs/app/building-your-application/routing/loading-ui-and-streaming
// =============================================================================

export default function Loading() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
      <div className="text-center">
        {/* Simple CSS spinner — no dependencies needed */}
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
