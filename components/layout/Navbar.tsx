// =============================================================================
// NAVBAR COMPONENT
// =============================================================================
// The main navigation bar displayed at the top of every page.
// Auth state: GET /api/auth/session (credentials: 'include') — 200 = logged in,
// 401 = logged out. Logout via POST /api/auth/logout (existing API). No external auth
// browser SDK for session; cookie is server-side only.
// =============================================================================

'use client';

import { useState, useEffect, useRef, type RefObject } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { logout } from '@/lib/auth-client';
import { useTheme } from 'next-themes';
import { SunIcon, MoonIcon, ComputerDesktopIcon, CheckIcon } from '@heroicons/react/24/outline';
import {
  getBackgroundGrainEnabled,
  setBackgroundGrainEnabled,
} from '@/lib/ui/background-preference';
import { DashboardNavMenuIcon } from '@/components/dashboard/dashboard-nav-shared';
import { useDashboardNav } from '@/components/dashboard/DashboardNavProvider';

const THEME_OPTIONS = [
  { value: 'system' as const, label: 'System', Icon: ComputerDesktopIcon },
  { value: 'light' as const, label: 'Light', Icon: SunIcon },
  { value: 'dark' as const, label: 'Dark', Icon: MoonIcon },
] as const;

type ThemeDropdownPlace = 'desktop' | 'mobile' | false;

/**
 * Returns shared primary nav link classes for desktop and mobile menu items.
 * @param active - Whether the link matches the current route.
 * @returns Tailwind class string for the nav link.
 */
function primaryNavLinkClassName(active: boolean): string {
  return [
    'rounded-md px-3 py-2 text-sm transition-colors',
    active
      ? 'bg-muted font-bold text-foreground'
      : 'font-normal text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground',
  ].join(' ');
}

/**
 * Returns shared classes for secondary nav actions such as Log in and Log out.
 * @returns Tailwind class string for nav action buttons and links.
 */
function primaryNavActionClassName(): string {
  return 'rounded-md px-3 py-2 text-sm font-normal text-muted-foreground opacity-80 transition-colors hover:bg-muted hover:text-foreground';
}

function ThemeDropdown({
  containerRef,
  isOpen,
  onToggle,
  onClose,
  theme,
  setTheme,
  grainEnabled,
  onToggleGrain,
  resolvedTheme,
  mounted,
  dropdownClassName,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  theme: string | undefined;
  setTheme: (theme: 'system' | 'light' | 'dark') => void;
  grainEnabled: boolean;
  onToggleGrain: () => void;
  resolvedTheme: string | undefined;
  mounted: boolean;
  dropdownClassName: string;
}) {
  const selectedTheme = mounted ? (theme ?? 'system') : 'system';
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Change color theme"
        aria-expanded={isOpen ? 'true' : 'false'}
        onClick={onToggle}
        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {mounted && resolvedTheme === 'dark' ? (
          <MoonIcon className="h-5 w-5" />
        ) : (
          <SunIcon className="h-5 w-5" />
        )}
      </button>
      {isOpen && (
        <div
          className={`absolute top-full z-50 mt-1 min-w-40 rounded-md border border-border bg-background py-1 shadow-lg ${dropdownClassName}`}
          role="menu"
        >
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitem"
              onClick={() => {
                setTheme(value);
                onClose();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
              {selectedTheme === value && <CheckIcon className="ml-auto h-4 w-4 text-primary" />}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={grainEnabled ? 'true' : 'false'}
            onClick={onToggleGrain}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            <span>Film texture</span>
            <span
              className={`ml-auto inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
                grainEnabled ? 'border-primary bg-primary/20' : 'border-border bg-muted'
              }`}
              aria-hidden
            >
              <span
                className={`h-3.5 w-3.5 rounded-full bg-foreground transition-transform ${
                  grainEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** User shape returned by GET /api/auth/session. */
interface SessionUser {
  $id?: string;
  name?: string;
  email?: string;
}

interface NavbarProps {
  initialSessionUser?: SessionUser | null;
  /** When true, hide sign-in links until first-run admin setup is complete. */
  initialFirstRunPending?: boolean;
}

/**
 * Renders the navbar component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export default function Navbar({
  initialSessionUser,
  initialFirstRunPending = false,
}: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null | 'loading'>(
    initialSessionUser === undefined ? 'loading' : initialSessionUser
  );
  const [themeDropdownOpen, setThemeDropdownOpen] = useState<ThemeDropdownPlace>(false);
  const [grainEnabled, setGrainEnabled] = useState(() => getBackgroundGrainEnabled());
  const [mounted, setMounted] = useState(false);
  const desktopThemeRef = useRef<HTMLDivElement>(null);
  const mobileThemeRef = useRef<HTMLDivElement>(null);
  const { theme, setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Re-fetch session when route changes so client-side redirects (e.g. after email/password login) pick up the new session.
  // AbortController ensures a slower response from a previous route cannot overwrite state (e.g. pre-login 401 after post-login 200).
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/session', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as SessionUser;
      })
      .then((user) => {
        if (controller.signal.aborted) return;
        setSessionUser(user);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSessionUser(null);
      });
    return () => controller.abort();
  }, [pathname]);

  useEffect(() => {
    if (!themeDropdownOpen) return;
    const ref = themeDropdownOpen === 'desktop' ? desktopThemeRef : mobileThemeRef;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setThemeDropdownOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setThemeDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [themeDropdownOpen]);

  const handleLogout = async () => {
    await logout();
    setSessionUser(null);
    setMobileMenuOpen(false);
    // Hard navigation on purpose: router.push('/') can be served from the
    // client Router/prefetch cache (populated while still authenticated, since
    // proxy.ts redirects "/" -> "/dashboard" for logged-in users and that
    // result gets cached by Link prefetching). Only a real network request
    // guarantees proxy.ts re-checks the now-cleared session cookie. This bug
    // is invisible in `next dev` because Link prefetching — and therefore the
    // stale cache entry — only exists in production builds.
    window.location.href = '/';
  };

  const isLoggedIn = sessionUser !== null && sessionUser !== 'loading';
  const showSignInLinks = !initialFirstRunPending;
  const dashboardNav = useDashboardNav();
  const showDashboardNavTrigger = dashboardNav !== null;

  const handleToggleGrain = () => {
    const next = !grainEnabled;
    setGrainEnabled(next);
    setBackgroundGrainEnabled(next);
  };

  return (
    <nav
      className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur"
      aria-label="Primary navigation"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            {showDashboardNavTrigger ? (
              <button
                type="button"
                onClick={dashboardNav.openMobileNav}
                aria-expanded={dashboardNav.mobileNavOpen ? 'true' : 'false'}
                aria-controls="dashboard-mobile-nav-drawer"
                aria-label="Open dashboard sections"
                data-tour="dashboard-sections-trigger-mobile"
                className="inline-flex shrink-0 items-center justify-center rounded-md p-2 text-foreground transition-colors hover:bg-muted md:hidden"
              >
                <DashboardNavMenuIcon />
              </button>
            ) : null}
            <Link
              href="/"
              aria-current={pathname === '/' ? 'page' : undefined}
              className="flex min-w-0 items-center gap-2"
            >
              <Image
                src="/rawFaviconVideoSphere.png"
                alt="VideoSphere logo"
                width={40}
                height={40}
                priority
              />
              <span className="truncate text-xl font-black sm:text-2xl">VideoSphere</span>
            </Link>
          </div>

          {/* --- Desktop nav --- */}
          <div className="hidden items-center gap-4 md:flex">
            {sessionUser === 'loading' ? (
              <span className="text-sm text-muted-foreground" aria-hidden>
                …
              </span>
            ) : isLoggedIn ? (
              <>
                <Link
                  href="/dashboard"
                  aria-current={pathname.startsWith('/dashboard') ? 'page' : undefined}
                  className={primaryNavLinkClassName(pathname.startsWith('/dashboard'))}
                >
                  Dashboard
                </Link>
                <Link
                  href="/profile"
                  aria-current={pathname.startsWith('/profile') ? 'page' : undefined}
                  className={primaryNavLinkClassName(pathname.startsWith('/profile'))}
                >
                  Profile
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className={primaryNavActionClassName()}
                >
                  Log out
                </button>
              </>
            ) : showSignInLinks ? (
              <Link href="/login" className={primaryNavActionClassName()}>
                Log in
              </Link>
            ) : null}

            <ThemeDropdown
              containerRef={desktopThemeRef}
              isOpen={themeDropdownOpen === 'desktop'}
              onToggle={() =>
                setThemeDropdownOpen(themeDropdownOpen === 'desktop' ? false : 'desktop')
              }
              onClose={() => setThemeDropdownOpen(false)}
              theme={theme}
              setTheme={setTheme}
              grainEnabled={grainEnabled}
              onToggleGrain={handleToggleGrain}
              resolvedTheme={resolvedTheme}
              mounted={mounted}
              dropdownClassName="right-0"
            />
          </div>

          {/* --- Mobile controls (theme rightmost) --- */}
          <div className="flex items-center gap-1 md:hidden">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen ? 'true' : 'false'}
              aria-label="Toggle navigation menu"
              aria-controls="site-navigation-mobile-menu"
            >
              {mobileMenuOpen ? (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                  />
                </svg>
              )}
            </button>
            <ThemeDropdown
              containerRef={mobileThemeRef}
              isOpen={themeDropdownOpen === 'mobile'}
              onToggle={() =>
                setThemeDropdownOpen(themeDropdownOpen === 'mobile' ? false : 'mobile')
              }
              onClose={() => setThemeDropdownOpen(false)}
              theme={theme}
              setTheme={setTheme}
              grainEnabled={grainEnabled}
              onToggleGrain={handleToggleGrain}
              resolvedTheme={resolvedTheme}
              mounted={mounted}
              dropdownClassName="right-0"
            />
          </div>
        </div>

        {/* --- Mobile Menu --- */}
        {mobileMenuOpen && (
          <div id="site-navigation-mobile-menu" className="border-t border-border pb-4 md:hidden">
            <div className="flex flex-col gap-2 pt-4">
              {sessionUser === null && showSignInLinks && <hr className="my-2 border-border" />}
              {sessionUser === 'loading' ? (
                <span className="px-3 py-2 text-sm text-muted-foreground">…</span>
              ) : isLoggedIn ? (
                <>
                  <Link
                    href="/dashboard"
                    aria-current={pathname.startsWith('/dashboard') ? 'page' : undefined}
                    className={primaryNavLinkClassName(pathname.startsWith('/dashboard'))}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Dashboard
                  </Link>
                  <Link
                    href="/profile"
                    aria-current={pathname.startsWith('/profile') ? 'page' : undefined}
                    className={primaryNavLinkClassName(pathname.startsWith('/profile'))}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Profile
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className={`${primaryNavActionClassName()} text-left`}
                  >
                    Log out
                  </button>
                </>
              ) : showSignInLinks ? (
                <Link
                  href="/login"
                  className={primaryNavActionClassName()}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Log in
                </Link>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
