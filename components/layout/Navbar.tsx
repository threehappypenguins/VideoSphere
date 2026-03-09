// =============================================================================
// NAVBAR COMPONENT
// =============================================================================
// The main navigation bar displayed at the top of every page.
// Auth state: GET /api/auth/session (credentials: 'include') — 200 = logged in,
// 401 = logged out. Logout via POST /api/auth/logout (existing API). No Appwrite
// browser SDK for session; cookie is server-side only.
// =============================================================================

'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { logout } from '@/lib/auth-client';
import { useTheme } from 'next-themes';

const SunIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M3 12H4.75m4.227-4.773-1.591-1.591M18.75 12H21" />
    <circle cx="12" cy="12" r="4.5" />
  </svg>
);
const MoonIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
  </svg>
);
const SystemIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);
const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/** User shape returned by GET /api/auth/session (Appwrite User). */
interface SessionUser {
  name?: string;
  email?: string;
}

type ThemeDropdownPlace = 'desktop' | 'mobile' | false;

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null | 'loading'>('loading');
  const [themeDropdownOpen, setThemeDropdownOpen] = useState<ThemeDropdownPlace>(false);
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
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SessionUser | null) => {
        if (controller.signal.aborted) return;
        setSessionUser(data ?? null);
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
    router.push('/');
  };

  const isLoggedIn = sessionUser !== null && sessionUser !== 'loading';
  const userLabel = isLoggedIn ? sessionUser.name?.trim() || sessionUser.email || 'Account' : null;

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* --- Logo --- */}
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="[Your App Name] logo" width={120} height={40} priority />
          </Link>

          {/* --- Desktop Navigation --- */}
          <div className="hidden items-center gap-8 md:flex">
            <Link
              href="/"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Home
            </Link>
            <Link
              href="/pricing"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Pricing
            </Link>
            <Link
              href="/about"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              About
            </Link>
            <Link
              href="/contact"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Contact
            </Link>
          </div>

          {/* --- Desktop Auth: login/signup when logged out, user + logout when logged in --- */}
          <div className="hidden items-center gap-4 md:flex">
            <div ref={desktopThemeRef} className="relative">
              <button
                type="button"
                aria-label="Theme"
                aria-expanded={themeDropdownOpen === 'desktop' ? 'true' : 'false'}
                onClick={() =>
                  setThemeDropdownOpen(themeDropdownOpen === 'desktop' ? false : 'desktop')
                }
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {mounted && resolvedTheme === 'dark' ? (
                  <MoonIcon className="h-5 w-5" />
                ) : (
                  <SunIcon className="h-5 w-5" />
                )}
              </button>
              {themeDropdownOpen === 'desktop' && (
                <div
                  className="absolute right-0 top-full z-50 mt-1 min-w-[10rem] rounded-md border border-border bg-background py-1 shadow-lg"
                  role="menu"
                >
                  {[
                    { value: 'system' as const, label: 'System', Icon: SystemIcon },
                    { value: 'light' as const, label: 'Light', Icon: SunIcon },
                    { value: 'dark' as const, label: 'Dark', Icon: MoonIcon },
                  ].map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setTheme(value);
                        setThemeDropdownOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{label}</span>
                      {(mounted ? (theme ?? 'system') : 'system') === value && (
                        <CheckIcon className="ml-auto h-4 w-4 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {sessionUser === 'loading' ? (
              <span className="text-sm text-muted-foreground" aria-hidden>
                …
              </span>
            ) : isLoggedIn ? (
              <>
                <span className="text-sm text-muted-foreground" title={sessionUser?.email}>
                  {userLabel}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>

          {/* --- Mobile Menu Button --- */}
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen ? 'true' : 'false'}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? (
              // X icon
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
              // Hamburger icon
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
        </div>

        {/* --- Mobile Menu --- */}
        {mobileMenuOpen && (
          <div className="border-t border-border pb-4 md:hidden">
            <div className="flex flex-col gap-2 pt-4">
              <div ref={mobileThemeRef} className="relative px-3">
                <button
                  type="button"
                  aria-label="Theme"
                  aria-expanded={themeDropdownOpen === 'mobile' ? 'true' : 'false'}
                  onClick={() =>
                    setThemeDropdownOpen(themeDropdownOpen === 'mobile' ? false : 'mobile')
                  }
                  className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {mounted && resolvedTheme === 'dark' ? (
                    <MoonIcon className="h-5 w-5" />
                  ) : (
                    <SunIcon className="h-5 w-5" />
                  )}
                </button>
                {themeDropdownOpen === 'mobile' && (
                  <div
                    className="absolute left-3 right-3 top-full z-50 mt-1 min-w-[10rem] rounded-md border border-border bg-background py-1 shadow-lg"
                    role="menu"
                  >
                    {[
                      { value: 'system' as const, label: 'System', Icon: SystemIcon },
                      { value: 'light' as const, label: 'Light', Icon: SunIcon },
                      { value: 'dark' as const, label: 'Dark', Icon: MoonIcon },
                    ].map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setTheme(value);
                          setThemeDropdownOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{label}</span>
                        {(mounted ? (theme ?? 'system') : 'system') === value && (
                          <CheckIcon className="ml-auto h-4 w-4 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Link
                href="/"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                Home
              </Link>
              <Link
                href="/pricing"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                Pricing
              </Link>
              <Link
                href="/about"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                About
              </Link>
              <Link
                href="/contact"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                Contact
              </Link>
              <hr className="my-2 border-border" />
              {sessionUser === 'loading' ? (
                <span className="px-3 py-2 text-sm text-muted-foreground">…</span>
              ) : isLoggedIn ? (
                <>
                  <span className="px-3 py-2 text-sm text-muted-foreground">{userLabel}</span>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="rounded-md px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Log out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Log in
                  </Link>
                  <Link
                    href="/signup"
                    className="mx-3 rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
