'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  DASHBOARD_ADMIN_NAV_ITEMS,
  DASHBOARD_NAV_ITEMS,
  DashboardNavList,
  resolveActiveDashboardNavHref,
  useDashboardNavExpanded,
} from '@/components/dashboard/dashboard-nav-shared';

// =============================================================================
// DASHBOARD SHELL
// =============================================================================
// Client component providing responsive dashboard navigation shell.
//
// Desktop (≥ md): sticky left sidebar (w-56) with vertical nav.
// Mobile (< md):  drawer opened from the navbar menu button (see DashboardNavProvider).
//
// Active route is highlighted via usePathname().
// Rendered inside template.tsx so Navbar/Footer wrap the entire dashboard.
// =============================================================================
/**
 * Renders the dashboard shell component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export default function DashboardShell({
  children,
  isAdmin = false,
}: {
  children: React.ReactNode;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const navItems = useMemo(
    () => (isAdmin ? [...DASHBOARD_NAV_ITEMS, ...DASHBOARD_ADMIN_NAV_ITEMS] : DASHBOARD_NAV_ITEMS),
    [isAdmin]
  );
  const activeHref = resolveActiveDashboardNavHref(pathname, navItems);
  const { expandedParents, toggleExpanded } = useDashboardNavExpanded(pathname, navItems);

  const desktopLinkClassName =
    'flex items-center border-l-2 px-4 py-2 text-lg transition-colors rounded-r-md';
  const desktopActiveClassName = 'border-primary bg-primary/10 font-extrabold text-primary';
  const desktopInactiveClassName =
    'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground';

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      <aside className="hidden w-56 shrink-0 border-r border-border md:block bg-background/50">
        <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-4">
          <nav aria-label="Dashboard navigation">
            <DashboardNavList
              navItems={navItems}
              pathname={pathname}
              activeHref={activeHref}
              expandedParents={expandedParents}
              toggleExpanded={toggleExpanded}
              linkClassName={desktopLinkClassName}
              activeClassName={desktopActiveClassName}
              inactiveClassName={desktopInactiveClassName}
              videosTourId="desktop"
            />
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
