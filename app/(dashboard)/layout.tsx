// =============================================================================
// DASHBOARD LAYOUT
// =============================================================================
// Wraps all routes under app/(dashboard)/ with a responsive navigation shell.
//
// Desktop (≥ md): sticky left sidebar (w-56).
// Mobile (< md):  horizontally-scrollable tab bar above page content.
//
// Active route is highlighted via usePathname().
// Route protection is handled by middleware/proxy.ts — no auth checks here.
// =============================================================================

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Toaster } from '@/components/ui/sonner';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', exact: true },
  { label: 'Drafts', href: '/dashboard/drafts', exact: false },
  { label: 'Upload', href: '/dashboard/upload', exact: false },
  { label: 'Scheduled', href: '/dashboard/scheduled', exact: false },
  { label: 'History', href: '/dashboard/history', exact: false },
] as const;

// checks for which link to highlight based on comparing the href with the pathname. Needs ternary operator to check for the base /dashboard as it otherwise would highlight in all cases.
function isActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href);
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* ------------------------------------------------------------------ */}
      {/* Desktop sidebar — hidden on mobile                                  */}
      {/* ------------------------------------------------------------------ */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border md:flex sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-4 bg-background/50">
        <nav aria-label="Dashboard navigation">
          {NAV_ITEMS.map(({ label, href, exact }) => {
            const active = isActive(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                {...(label === 'Drafts' ? { 'data-tour': 'drafts-nav-link' } : {})}
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
          {NAV_ITEMS.map(({ label, href, exact }) => {
            const active = isActive(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                {...(label === 'Drafts' ? { 'data-tour': 'drafts-nav-link' } : {})}
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
      {/* Toaster allows for displaying toast notifications */}
      <Toaster />
    </div>
  );
}
