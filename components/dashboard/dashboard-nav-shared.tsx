'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

/** Child link nested under a dashboard nav section. */
export interface DashboardNavChildItem {
  label: string;
  href: string;
  exact?: boolean;
}

/** Top-level dashboard sidebar / drawer link. */
export interface DashboardNavItem {
  label: string;
  href: string;
  exact?: boolean;
  tourIdDesktop?: string;
  tourIdMobile?: string;
  children?: DashboardNavChildItem[];
}

/** Primary dashboard navigation tree (admin items appended at runtime). */
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  { label: 'Dashboard', href: '/dashboard', exact: true },
  {
    label: 'Uploads',
    href: '/dashboard/uploads',
    exact: false,
    tourIdDesktop: 'uploads-nav-link-desktop',
    tourIdMobile: 'uploads-nav-link-mobile',
    children: [{ label: 'History', href: '/dashboard/uploads/history', exact: false }],
  },
  {
    label: 'Livestreams',
    href: '/dashboard/livestreams',
    exact: false,
    children: [{ label: 'History', href: '/dashboard/livestreams/history', exact: false }],
  },
];

/** Admin-only dashboard nav link. */
export const DASHBOARD_ADMIN_NAV_ITEMS: DashboardNavItem[] = [
  { label: 'Users', href: '/dashboard/users', exact: true },
];

/**
 * Two-line menu icon for the dashboard drawer trigger (long top line, short bottom line).
 * @returns SVG icon element.
 */
export function DashboardNavMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <rect x="3" y="7" width="18" height="2" rx="1" />
      <rect x="3" y="15" width="11" height="2" rx="1" />
    </svg>
  );
}

function isActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href);
}

function isChildActive(pathname: string, child: DashboardNavChildItem): boolean {
  return isActive(pathname, child.href, child.exact ?? false);
}

/**
 * Returns whether a nav parent or any of its children matches the current route.
 * @param pathname - Current app pathname.
 * @param item - Nav item to evaluate.
 * @returns True when the parent section should appear active.
 */
export function isDashboardNavParentActive(pathname: string, item: DashboardNavItem): boolean {
  if (isActive(pathname, item.href, item.exact ?? false)) {
    return true;
  }
  return item.children?.some((child) => isChildActive(pathname, child)) ?? false;
}

/**
 * Resolves the most specific active dashboard nav href for highlighting.
 * @param pathname - Current app pathname.
 * @param items - Nav items to search.
 * @returns Best-matching href, if any.
 */
export function resolveActiveDashboardNavHref(
  pathname: string,
  items: DashboardNavItem[]
): string | null {
  let bestMatch: { href: string; length: number } | null = null;

  for (const item of items) {
    for (const child of item.children ?? []) {
      if (isChildActive(pathname, child)) {
        if (!bestMatch || child.href.length > bestMatch.length) {
          bestMatch = { href: child.href, length: child.href.length };
        }
      }
    }

    if (isActive(pathname, item.href, item.exact ?? false)) {
      if (!bestMatch || item.href.length > bestMatch.length) {
        bestMatch = { href: item.href, length: item.href.length };
      }
    }
  }

  return bestMatch?.href ?? null;
}

/**
 * Returns whether a nav parent has an active child route (for auto-expanding accordions).
 * @param pathname - Current app pathname.
 * @param item - Nav item to evaluate.
 * @returns True when a nested child is active.
 */
export function dashboardNavParentHasActiveChild(
  pathname: string,
  item: DashboardNavItem
): boolean {
  return item.children?.some((child) => isChildActive(pathname, child)) ?? false;
}

/**
 * Tracks expanded dashboard nav parents, auto-expanding sections with active children.
 * Mount inside a component keyed by pathname so manual toggles reset on navigation.
 * @param pathname - Current app pathname.
 * @param navItems - Nav items to evaluate.
 * @returns Expanded parent hrefs and a toggle handler.
 */
export function useDashboardNavExpanded(pathname: string, navItems: DashboardNavItem[]) {
  const [userToggles, setUserToggles] = useState<Map<string, boolean>>(() => new Map());

  const expandedParents = useMemo(() => {
    const next = new Set<string>();
    for (const item of navItems) {
      if (!item.children?.length) {
        continue;
      }
      const userToggle = userToggles.get(item.href);
      if (userToggle !== undefined) {
        if (userToggle) {
          next.add(item.href);
        }
        continue;
      }
      if (dashboardNavParentHasActiveChild(pathname, item)) {
        next.add(item.href);
      }
    }
    return next;
  }, [pathname, navItems, userToggles]);

  const toggleExpanded = useCallback(
    (href: string) => {
      setUserToggles((prev) => {
        const next = new Map(prev);
        const item = navItems.find((navItem) => navItem.href === href);
        const userToggle = prev.get(href);
        const currentlyExpanded =
          userToggle !== undefined
            ? userToggle
            : item
              ? dashboardNavParentHasActiveChild(pathname, item)
              : false;
        next.set(href, !currentlyExpanded);
        return next;
      });
    },
    [pathname, navItems]
  );

  return { expandedParents, toggleExpanded };
}

interface NavLinkProps {
  label: string;
  href: string;
  active: boolean;
  tourId?: string;
  nested?: boolean;
  className: string;
  onNavigate?: () => void;
}

function NavLink({
  label,
  href,
  active,
  tourId,
  nested = false,
  className,
  onNavigate,
}: NavLinkProps) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      {...(tourId ? { 'data-tour': tourId } : {})}
      onClick={onNavigate}
      className={[className, nested ? 'pl-8 text-base' : ''].filter(Boolean).join(' ')}
    >
      {label}
    </Link>
  );
}

interface DashboardNavListProps {
  navItems: DashboardNavItem[];
  pathname: string;
  activeHref: string | null;
  expandedParents: Set<string>;
  toggleExpanded: (href: string) => void;
  linkClassName: string;
  activeClassName: string;
  inactiveClassName: string;
  onNavigate?: () => void;
  uploadsTourId?: 'desktop' | 'mobile';
}

type DashboardNavListContainerProps = Omit<
  DashboardNavListProps,
  'expandedParents' | 'toggleExpanded'
>;

/**
 * Renders {@link DashboardNavList} with expansion state scoped to the current route.
 * Remount with `key={pathname}` so chevron toggles reset when navigating.
 * @param props - Nav list props excluding expansion state.
 * @returns Navigation list UI.
 */
export function DashboardNavListContainer(props: DashboardNavListContainerProps) {
  const { pathname, navItems } = props;
  const { expandedParents, toggleExpanded } = useDashboardNavExpanded(pathname, navItems);

  return (
    <DashboardNavList
      {...props}
      expandedParents={expandedParents}
      toggleExpanded={toggleExpanded}
    />
  );
}

/**
 * Renders the dashboard navigation tree for the sidebar or mobile drawer.
 * @param props - Nav list props.
 * @returns Navigation list UI.
 */
export function DashboardNavList({
  navItems,
  pathname,
  activeHref,
  expandedParents,
  toggleExpanded,
  linkClassName,
  activeClassName,
  inactiveClassName,
  onNavigate,
  uploadsTourId,
}: DashboardNavListProps) {
  return (
    <>
      {navItems.map((item) => {
        const { label, href, children } = item;
        const tourId =
          uploadsTourId === 'desktop'
            ? item.tourIdDesktop
            : uploadsTourId === 'mobile'
              ? item.tourIdMobile
              : undefined;
        const parentActive = isDashboardNavParentActive(pathname, item);
        const parentCurrent = activeHref === href;
        const hasChildren = (children?.length ?? 0) > 0;
        const isExpanded = expandedParents.has(href);
        const submenuId = `${href.replace(/\//g, '-')}-submenu`;

        if (!hasChildren) {
          return (
            <NavLink
              key={href}
              label={label}
              href={href}
              active={parentCurrent}
              tourId={tourId}
              onNavigate={onNavigate}
              className={[linkClassName, parentActive ? activeClassName : inactiveClassName].join(
                ' '
              )}
            />
          );
        }

        return (
          <div key={href}>
            <div
              className={[
                'flex items-stretch border-l-2 rounded-r-md transition-colors',
                parentActive ? activeClassName : inactiveClassName,
              ].join(' ')}
            >
              <NavLink
                label={label}
                href={href}
                active={parentCurrent}
                tourId={tourId}
                onNavigate={onNavigate}
                className="min-w-0 flex-1 border-l-0 px-4 py-2 text-lg"
              />
              <button
                type="button"
                onClick={() => toggleExpanded(href)}
                aria-expanded={isExpanded ? 'true' : 'false'}
                aria-controls={submenuId}
                aria-label={`${isExpanded ? 'Hide' : 'Show'} ${label} submenu`}
                className="inline-flex shrink-0 items-center justify-center px-2 py-2 transition-colors hover:bg-muted/60"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                  aria-hidden
                />
              </button>
            </div>
            {isExpanded ? (
              <div id={submenuId}>
                {children?.map((child) => (
                  <NavLink
                    key={child.href}
                    label={child.label}
                    href={child.href}
                    active={activeHref === child.href}
                    nested
                    onNavigate={onNavigate}
                    className={[
                      linkClassName,
                      activeHref === child.href ? activeClassName : inactiveClassName,
                    ].join(' ')}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
