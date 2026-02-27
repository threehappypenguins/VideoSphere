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

export default function Footer() {
  return (
    <footer className="border-t border-border bg-muted/50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* --- Brand --- */}
          <div className="col-span-1 md:col-span-1">
            <h3 className="text-lg font-semibold text-foreground">[Your App Name]</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              [Your app tagline or short description goes here. Explain what your product does in
              one or two sentences.]
            </p>
          </div>

          {/* --- Product Links --- */}
          <div>
            <h4 className="text-sm font-semibold text-foreground">Product</h4>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/pricing"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Pricing
                </Link>
              </li>
              <li>
                <Link
                  href="/about"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  About
                </Link>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Contact
                </Link>
              </li>
            </ul>
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

          {/* --- Social / Legal --- */}
          <div>
            <h4 className="text-sm font-semibold text-foreground">Connect</h4>
            <ul className="mt-4 space-y-2">
              {/* STUDENT: Replace these placeholder URLs with your actual social media URLs */}
              <li>
                <a
                  href="https://twitter.com"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Twitter / X
                </a>
              </li>
              <li>
                <a
                  href="https://github.com"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://linkedin.com"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  LinkedIn
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* --- Bottom Bar --- */}
        <div className="mt-12 border-t border-border pt-8 text-center">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} [Your App Name]. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
