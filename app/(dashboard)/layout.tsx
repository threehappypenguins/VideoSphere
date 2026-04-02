// =============================================================================
// DASHBOARD LAYOUT
// =============================================================================
// Minimal pass-through layout for app/(dashboard)/*.
//
// Full dashboard shell (Navbar, sidebar, Footer) is provided by template.tsx
// which wraps this layout. This ensures Navbar/Footer span the full page
// outside the sidebar container.
// =============================================================================

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
