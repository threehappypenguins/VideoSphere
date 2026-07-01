'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DASHBOARD_ADMIN_NAV_ITEMS,
  DASHBOARD_NAV_ITEMS,
  DashboardNavList,
  resolveActiveDashboardNavHref,
  useDashboardNavExpanded,
} from '@/components/dashboard/dashboard-nav-shared';

interface DashboardNavContextValue {
  /** Opens the mobile dashboard navigation drawer. */
  openMobileNav: () => void;
  /** Closes the mobile dashboard navigation drawer. */
  closeMobileNav: () => void;
  /** Whether the mobile drawer is currently open. */
  mobileNavOpen: boolean;
}

const DashboardNavContext = createContext<DashboardNavContextValue | null>(null);

/**
 * Returns dashboard nav drawer controls when rendered inside {@link DashboardNavProvider}.
 * @returns Drawer controls, or null outside the dashboard layout.
 */
export function useDashboardNav(): DashboardNavContextValue | null {
  return useContext(DashboardNavContext);
}

interface DashboardNavProviderProps {
  children: ReactNode;
  isAdmin?: boolean;
}

/**
 * Provides mobile dashboard drawer state and renders the slide-over nav on small screens.
 * @param props - Provider props.
 * @returns Provider wrapper with mobile drawer portal.
 */
export function DashboardNavProvider({ children, isAdmin = false }: DashboardNavProviderProps) {
  const pathname = usePathname();
  const navItems = useMemo(
    () => (isAdmin ? [...DASHBOARD_NAV_ITEMS, ...DASHBOARD_ADMIN_NAV_ITEMS] : DASHBOARD_NAV_ITEMS),
    [isAdmin]
  );
  const activeHref = resolveActiveDashboardNavHref(pathname, navItems);
  const { expandedParents, toggleExpanded } = useDashboardNavExpanded(pathname, navItems);
  const [prevPathname, setPrevPathname] = useState(pathname);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileNavOpen(false);
  }

  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  const contextValue = useMemo(
    () => ({
      openMobileNav,
      closeMobileNav,
      mobileNavOpen,
    }),
    [closeMobileNav, mobileNavOpen, openMobileNav]
  );

  const drawerLinkClassName =
    'flex items-center border-l-2 px-4 py-2.5 text-base transition-colors rounded-r-md';
  const activeClassName = 'border-primary bg-primary/10 font-extrabold text-primary';
  const inactiveClassName =
    'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground';

  return (
    <DashboardNavContext.Provider value={contextValue}>
      {children}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          id="dashboard-mobile-nav-drawer"
          className="w-[min(100%,20rem)] p-0 md:hidden"
        >
          <SheetHeader className="border-b border-border px-4 py-4 text-left">
            <SheetTitle>Dashboard</SheetTitle>
            <SheetDescription>Jump to a dashboard section.</SheetDescription>
          </SheetHeader>
          <nav aria-label="Dashboard navigation" className="overflow-y-auto py-2">
            <DashboardNavList
              navItems={navItems}
              pathname={pathname}
              activeHref={activeHref}
              expandedParents={expandedParents}
              toggleExpanded={toggleExpanded}
              linkClassName={drawerLinkClassName}
              activeClassName={activeClassName}
              inactiveClassName={inactiveClassName}
              onNavigate={closeMobileNav}
              videosTourId="mobile"
            />
          </nav>
        </SheetContent>
      </Sheet>
    </DashboardNavContext.Provider>
  );
}
