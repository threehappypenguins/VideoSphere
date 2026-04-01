'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', exact: true },
  { label: 'Drafts', href: '/dashboard/drafts', exact: false, tourId: 'drafts-nav-link' },
] as const;

function isActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href);
}

export default function ProfileLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border md:flex sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-4">
        <nav aria-label="Navigation">
          {NAV_ITEMS.map((item) => {
            const { label, href, exact } = item;
            const tourId = 'tourId' in item ? item.tourId : undefined;
            const active = isActive(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                {...(tourId ? { 'data-tour': tourId } : {})}
                className={[
                  'flex items-center border-l-2 px-4 py-2 text-sm transition-colors rounded-r-md',
                  active
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile tab bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <nav
          aria-label="Navigation"
          className="flex overflow-x-auto border-b border-border md:hidden shrink-0"
        >
          {NAV_ITEMS.map((item) => {
            const { label, href, exact } = item;
            const tourId = 'tourId' in item ? item.tourId : undefined;
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

        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
