// =============================================================================
// DASHBOARD LAYOUT
// =============================================================================
// Minimal pass-through layout for app/(dashboard)/*.
//
// Full dashboard shell (Navbar, sidebar, Footer) is provided by template.tsx
// which wraps this layout. This ensures Navbar/Footer span the full page
// outside the sidebar container.
// =============================================================================

// Every route under this group reads the session via cookies()-based helpers
// (getCurrentUserIdFromCookies / getNavbarAuthStateFromCookies / etc). Those
// helpers only call cookies() *after* checking process.env.JWT_SECRET, so if
// JWT_SECRET isn't set at `next build` time (e.g. a Docker build stage that
// doesn't receive runtime secrets), Next never sees a dynamic API call and
// happily prerenders these pages as static — baking in a build-time
// "logged out" redirect/state that gets served to every user forever,
// regardless of their real session cookie. force-dynamic guarantees these
// routes are always server-rendered per-request. Mirrors (auth)/layout.tsx
// and (marketing)/layout.tsx, which already do this.
export const dynamic = 'force-dynamic';

/**
 * Renders the dashboard layout component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
