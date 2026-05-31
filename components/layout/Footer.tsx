// =============================================================================
// FOOTER COMPONENT
// =============================================================================
// The footer displayed at the bottom of every page.
//
// STUDENT: Update this component with your app's information:
//   - Replace [Your App Name] with your actual app name
//   - Update navigation links to match your routes
//   - Replace social media placeholder links with real URLs
//   - Add any additional sections relevant to your product
// =============================================================================

import Link from 'next/link';

/**
 * Renders the footer component.
 * @returns The rendered UI output.
 */
export default function Footer() {
  return (
    <footer className="border-t border-border bg-muted/50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-center gap-12 text-left">
          {/* --- Brand --- */}
          <div>
            <h3 className="text-lg font-semibold text-foreground">VideoSphere</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Upload once, distribute everywhere.
            </p>
          </div>

          {/* --- Resources Links --- */}
          <div>
            <h4 className="text-sm font-semibold text-foreground">Resources</h4>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/dashboard"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  href="/login"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Log in
                </Link>
              </li>
              <li>
                <Link
                  href="/signup"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Sign up
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
