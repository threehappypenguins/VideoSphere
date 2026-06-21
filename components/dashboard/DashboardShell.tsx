'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', exact: true },
  {
    label: 'Drafts',
    href: '/dashboard/drafts',
    exact: false,
    tourIdDesktop: 'drafts-nav-link-desktop',
    tourIdMobile: 'drafts-nav-link-mobile',
  },
  { label: 'Livestreams', href: '/dashboard/livestreams', exact: false },
  { label: 'History', href: '/dashboard/history', exact: false },
] as const;

const ADMIN_NAV_ITEMS = [{ label: 'Users', href: '/dashboard/users', exact: true }] as const;

function isActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href);
}

// =============================================================================
// DASHBOARD SHELL
// =============================================================================
// Client component providing responsive sidebar + mobile tab navigation shell.
//
// Desktop (≥ md): sticky left sidebar (w-56) with vertical nav.
// Mobile (< md):  horizontally-scrollable tab bar above page content.
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
  const navItems = isAdmin ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS] : NAV_ITEMS;

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* ------------------------------------------------------------------ */}
      {/* Desktop sidebar — hidden on mobile                                  */}
      {/* Outer aside stretches full page height so border-r reaches footer. */}
      {/* Inner div is sticky so the nav stays in view while scrolling.      */}
      {/* ------------------------------------------------------------------ */}
      <aside className="hidden w-56 shrink-0 border-r border-border md:block bg-background/50">
        <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-4">
          <nav aria-label="Dashboard navigation">
            {navItems.map((item) => {
              const { label, href, exact } = item;
              const tourId = 'tourIdDesktop' in item ? item.tourIdDesktop : undefined;
              const active = isActive(pathname, href, exact);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  {...(tourId ? { 'data-tour': tourId } : {})}
                  className={[
                    'flex items-center border-l-2 px-4 py-2 text-lg transition-colors rounded-r-md',
                    active
                      ? 'border-primary bg-primary/10 font-extrabold text-primary'
                      : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                  ].join(' ')}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Content column (contains mobile tabs + page content)               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile tab bar — hidden on desktop */}
        <nav
          aria-label="Dashboard navigation"
          className="flex overflow-x-auto border-b border-border md:hidden shrink-0"
        >
          {navItems.map((item) => {
            const { label, href, exact } = item;
            const tourId = 'tourIdMobile' in item ? item.tourIdMobile : undefined;
            const active = isActive(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                {...(tourId ? { 'data-tour': tourId } : {})}
                className={[
                  'whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors',
                  active
                    ? 'border-primary font-medium text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Page content */}
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
