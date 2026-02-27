# Stretch Goals

This is a categorized checklist of stretch goals — things worth building beyond the mandatory requirements. Completing items from this list forms the **add-on component** of your final grade (approximately 20%). You are not expected to complete everything — the goal is to demonstrate breadth, depth, and deliberate decision-making.

## How This Works

- Each item is **independently assessable** — present completed items to your instructor as they are done.
- Choose stretch goals that make sense for your product. Not every item fits every project.
- Create a **GitHub Issue** for every stretch goal you attempt, assign it to a sprint, and submit it via the normal PR process.
- Quality over quantity. A well-implemented, tested, and documented stretch goal is worth more than several half-finished ones.

> Items are grouped by discipline. Attempt items across multiple categories to demonstrate well-rounded understanding.

---

## 1. UI & User Experience

- [ ] **Dark / light mode toggle** — detect `prefers-color-scheme` by default; allow manual override; persist preference in `localStorage`
- [ ] **Animated page transitions** — smooth enter/exit transitions between routes using Framer Motion or the View Transitions API
- [ ] **Skeleton loading states** — replace blank loading areas with accurately shaped content skeletons for all async data views
- [ ] **Toast / snackbar notification system** — global, accessible toast queue for success, error, warning, and info messages
- [ ] **Modal and dialog system** — reusable, accessible modal component with focus trap, `Escape` to close, and scroll lock
- [ ] **Drawer / side-panel navigation** — slide-in drawer for mobile navigation or detail panels; no JavaScript libraries beyond React
- [ ] **Onboarding flow** — step-by-step guided tour for new users that highlights key features and can be dismissed or replayed
- [ ] **Empty state designs** — purpose-built empty state UI (illustration + message + CTA) for every list or data view with no results
- [ ] **Command palette** — keyboard-activated command palette (`⌘K`) for quick navigation and actions (cmdk or custom implementation)
- [ ] **Breadcrumb navigation** — dynamic, accessible breadcrumb component reflecting the current route hierarchy on all inner pages
- [ ] **Interactive data table** — sortable columns, column visibility toggles, inline row actions, and accessible keyboard navigation
- [ ] **Infinite scroll** — cursor-based infinite scroll as an alternative to paginated lists for at least one content feed

---

## 2. Frontend Architecture & Component Design

- [ ] **Component library with Storybook** — install and configure Storybook; document every reusable UI component with stories, props table, and usage examples
- [ ] **Design token system** — define a consistent set of Tailwind CSS theme tokens (colours, spacing, typography scale, border radii) in `tailwind.config.ts` — used uniformly across all pages
- [ ] **Compound component pattern** — implement at least one feature (e.g. Tabs, Accordion, Select) using the compound component pattern for a composable API
- [ ] **Custom React hooks** — extract at least three pieces of reusable stateful logic into named custom hooks in `/hooks` with corresponding unit tests
- [ ] **Form library integration** — integrate React Hook Form (or equivalent) with Zod for schema-based validation on all user-facing forms; display per-field error messages
- [ ] **URL state management** — synchronise relevant UI state (filters, sort order, page number) with URL search params so views are shareable and bookmarkable
- [ ] **Optimistic UI updates** — implement optimistic updates for at least one mutation so the UI reflects changes instantly before server confirmation

---

## 3. Authentication — Advanced

> These build on top of the mandatory basic auth requirement.

- [ ] **Social / OAuth login** — add at least one OAuth provider (Google, GitHub, etc.) via your chosen auth library
- [ ] **Magic link / passwordless login** — email a one-time login link as an alternative sign-in method
- [ ] **Multi-factor authentication (MFA)** — TOTP-based MFA (e.g. Google Authenticator) as an opt-in account security feature
- [ ] **Password reset flow** — fully functional "Forgot password" → email link → reset form → confirmation flow
- [ ] **Session management page** — list all active sessions for the signed-in user with device/location info and a "Sign out everywhere" action
- [ ] **Email verification on sign-up** — send a verification email; restrict access to certain features until the address is confirmed
- [ ] **Account deletion** — allow a user to permanently delete their own account and all associated data (with a confirmation step)

---

## 4. Backend, API & Data

- [ ] **Zod input validation on all API routes** — every POST/PUT/PATCH route validates its request body against a Zod schema and returns `400` with structured field errors on failure
- [ ] **OpenAPI / Swagger documentation** — generate or hand-author an OpenAPI 3.x spec for all API routes; serve interactive Swagger UI at `/api/docs`
- [ ] **API versioning** — structure at least one route namespace under `/api/v1/` and document the versioning strategy
- [ ] **Server Actions** — replace at least two client-side `fetch` calls with Next.js Server Actions; document the tradeoffs vs route handlers in a code comment
- [ ] **Database migrations** — manage schema changes with a versioned migration system (e.g. Supabase migrations, Drizzle, or Prisma migrate); never alter the schema by hand
- [ ] **Database seeding script** — a `pnpm db:seed` script that populates the database with realistic development data
- [ ] **Webhook endpoint** — implement at least one inbound webhook receiver (e.g. Stripe, an auth provider) with signature verification and idempotency handling
- [ ] **Response caching strategy** — apply appropriate caching to at least two routes or data-fetching functions (ISR `revalidate`, `unstable_cache`, or HTTP `Cache-Control`); document the chosen strategy and why

---

## 5. Real-Time Features

- [ ] **Live data updates** — at least one view updates in real time without a page refresh (Supabase Realtime, Pusher, Ably, or WebSockets)
- [ ] **Live notifications** — in-app notification feed that receives new notifications in real time and shows an unread count badge
- [ ] **Typing indicator or presence** — show which users are currently active or viewing the same resource (e.g. "3 people are viewing this")
- [ ] **Server-Sent Events (SSE)** — implement at least one SSE stream endpoint (e.g. for progress updates or live logs) and consume it in the UI

---

## 6. File Handling & Media

- [ ] **File upload with cloud storage** — allow users to upload files (images, documents) to a cloud storage provider (Supabase Storage, Cloudflare R2, AWS S3); display a preview after upload
- [ ] **Avatar upload and crop** — profile photo upload with in-browser crop/resize before upload; stored in cloud storage
- [ ] **Image optimisation pipeline** — all user-uploaded images are resized and converted to WebP/AVIF on upload; served via a CDN
- [ ] **File download** — allow authenticated users to download their own uploaded files; enforce access control so users cannot download other users' private files

---

## 7. Email & Notifications

- [ ] **Transactional email** — send at least two types of transactional email (e.g. welcome email, password reset) using a provider such as Resend or SendGrid; use an HTML email template
- [ ] **In-app notification centre** — a notification panel showing recent activity with read/unread state, mark-all-as-read, and pagination
- [ ] **Email digest** — a scheduled (or manually triggered) summary email of recent activity using a cron job or scheduled function
- [ ] **Web Push notifications** — implement browser push notifications using the Web Push API; users opt in via a permission prompt

---

## 8. Search

- [ ] **Full-text search** — implement full-text search over at least one primary content type using your database's native FTS capability (Postgres `tsvector`, Supabase, etc.)
- [ ] **Search with autocomplete** — as-you-type autocomplete search results with keyboard navigation and highlighted matches
- [ ] **Faceted / filtered search** — combine free-text search with category, tag, or date filters that update results instantly
- [ ] **Hosted search provider** — integrate Algolia, Meilisearch, or Typesense for a production-grade search experience; document why a dedicated search provider is preferable to database FTS at scale

---

## 9. AI — Advanced

> These build on top of the mandatory AI feature requirement.

- [ ] **Streaming AI responses** — stream LLM output token-by-token using the Vercel AI SDK `streamText`; display a typing indicator while streaming
- [ ] **AI with tool / function calling** — define at least one tool that the LLM can call (e.g. look up a database record, perform a calculation); handle the tool result in the UI
- [ ] **Retrieval-Augmented Generation (RAG)** — embed user-specific content (documents, notes) as vectors; retrieve relevant chunks at query time to ground AI responses in real data
- [ ] **AI usage metering** — track per-user token usage; enforce a limit for free-tier users and display remaining quota in the UI
- [ ] **AI moderation layer** — run user-submitted content through a moderation API (OpenAI Moderation, Perspective API) before storing or displaying it

---

## 10. Payments — Advanced

> These build on top of the mandatory Stripe integration requirement.

- [ ] **Stripe Customer Portal** — allow users to manage their own subscription (upgrade, downgrade, cancel, update payment method) via the Stripe-hosted Customer Portal
- [ ] **Multiple subscription plans** — support at least three tiers (e.g. Free, Pro, Enterprise) with different feature sets enforced server-side
- [ ] **Per-seat / per-unit billing** — implement usage-based billing where the price varies by a measurable unit (seats, API calls, records)
- [ ] **Invoice history page** — display a list of past invoices fetched from Stripe with download links and status badges
- [ ] **Failed payment recovery** — handle `invoice.payment_failed` webhook events; notify the user, restrict access to premium features, and display a banner prompting them to update their payment method

---

## 11. Admin — Advanced

> These build on top of the mandatory admin dashboard requirement.

- [ ] **User management interface** — paginated, searchable, filterable table of all users; admin can view profile details, subscription status, and account creation date
- [ ] **Role assignment UI** — admin can promote a regular user to admin or demote an admin from within the dashboard (with confirmation)
- [ ] **Content moderation queue** — admin can review, approve, or remove user-generated content that has been flagged
- [ ] **Audit log** — immutable, append-only log of significant admin and system actions (role changes, deletions, login attempts) viewable in the admin dashboard
- [ ] **Data export** — admin can export user data or application data as CSV or JSON directly from the dashboard

---

## 12. Performance

- [ ] **`next/image` throughout** — replace every `<img>` tag across all pages with the Next.js `<Image>` component; add meaningful `alt` text to all images
- [ ] **Bundle analysis** — install `@next/bundle-analyzer`; produce a bundle report; identify and eliminate at least one unnecessary large dependency with documented before/after sizes
- [ ] **Dynamic imports for heavy components** — use `next/dynamic` with `{ ssr: false }` or loading fallbacks for components that would otherwise inflate the initial bundle
- [ ] **Edge runtime for latency-sensitive routes** — migrate at least one API route or middleware to the Edge runtime; measure and document the latency improvement
- [ ] **Core Web Vitals baseline** — measure LCP, CLS, and INP using Vercel Speed Insights or PageSpeed Insights before and after a targeted optimisation; document the improvement
- [ ] **Vercel Analytics integration** — add Vercel Analytics (or PostHog) to track real user performance metrics and page views without exposing user PII

---

## 13. SEO & Discoverability

- [ ] **Per-page metadata** — every page has a unique `title`, `description`, and `og:image` defined via the Next.js Metadata API; no pages share identical metadata
- [ ] **Dynamic Open Graph images** — generate per-page OG images dynamically using `next/og` (`ImageResponse`); used on at least three distinct page types
- [ ] **XML sitemap** — generate a dynamic `sitemap.xml` at `/sitemap.xml` listing all publicly accessible pages
- [ ] **`robots.txt`** — serve a `robots.txt` that correctly disallows crawling of authenticated and admin routes
- [ ] **Structured data (JSON-LD)** — add appropriate Schema.org JSON-LD markup to at least two page types (e.g. `Product`, `Organization`, `BreadcrumbList`)

---

## 14. Progressive Web App (PWA)

- [ ] **Web App Manifest** — add a `manifest.json` with app name, icons, theme colour, and `display: standalone`; verify "Add to Home Screen" works on Android Chrome
- [ ] **Service worker for offline support** — implement a service worker (via `next-pwa` or custom) that caches the shell and serves a custom offline page when the network is unavailable
- [ ] **Install prompt** — detect the `beforeinstallprompt` event and show a custom in-app "Install App" banner at an appropriate moment in the user journey

---

## 15. Testing

- [ ] **Unit tests for `/lib` utilities** — 100% test coverage for all functions in `/lib`; must include edge cases and error paths
- [ ] **Component tests for all UI components** — every component in `/components` has at least one render test and one interaction test
- [ ] **API route integration tests** — every route handler in `/api` is tested with mocked requests covering happy path, validation errors, and server errors
- [ ] **End-to-end tests with Playwright** — at least three critical user flows (e.g. sign up, complete a core action, upgrade to paid) covered by Playwright E2E tests running in CI
- [ ] **Accessibility testing with axe-core** — `@axe-core/playwright` or `jest-axe` integrated into the test suite; zero violations on all tested pages
- [ ] **Visual regression testing** — at least five key pages covered by screenshot comparison tests; CI fails if pixels change unexpectedly
- [ ] **Test coverage threshold** — configure Vitest to enforce a minimum of 70% line coverage; CI fails if coverage drops below the threshold

---

## 16. Accessibility (a11y)

- [ ] **WCAG 2.1 AA audit** — run a full audit using axe DevTools or Lighthouse; document every identified violation and resolve all Level A and AA issues
- [ ] **Keyboard navigation throughout** — every interactive element is reachable and operable using the keyboard alone; focus order is logical; no focus traps outside intentional modals
- [ ] **Skip navigation link** — a "Skip to main content" link is the first focusable element on every page; visible on focus
- [ ] **Focus management in modals** — focus moves to the first focusable element when a modal opens; focus is restored to the trigger element on close; Tab key cycles within the modal
- [ ] **Colour contrast compliance** — all text and interactive element foreground/background combinations meet WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text)
- [ ] **`prefers-reduced-motion` support** — all animations and transitions are disabled or reduced when the user has `prefers-reduced-motion: reduce` set in their OS
- [ ] **Meaningful image alt text** — every `<Image>` or `<img>` has descriptive alt text; purely decorative images use `alt=""`
- [ ] **Live region announcements** — asynchronous status changes (form submission success, toast messages, loading complete) are announced to screen readers via `aria-live`

---

## 17. Security

- [ ] **Security response headers** — configure `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` in `next.config.ts`
- [ ] **Content Security Policy (CSP)** — implement a strict CSP header via middleware or `next.config.ts`; document every directive and why it is needed
- [ ] **Rate limiting on API routes** — apply rate limiting (Upstash Redis, custom in-memory, or a Next.js middleware solution) to auth endpoints and any AI or payment-related routes
- [ ] **Input sanitisation** — strip or encode HTML from all user-supplied string inputs before storing in the database; demonstrate with a test that a stored XSS payload is neutralised
- [ ] **Dependency vulnerability scanning** — add `pnpm audit --prod` to the CI pipeline; fail the build if any high or critical severity vulnerabilities are found
- [ ] **Environment variable audit** — document every environment variable in `.env.example`; verify no `NEXT_PUBLIC_` variable exposes a secret; use a library like `@t3-oss/env-nextjs` for runtime validation

---

## 18. DevOps & CI/CD

- [ ] **Automated deployment to Vercel** — the `main` branch deploys automatically to production on every merge; staging/preview deployments are created for every open PR
- [ ] **Expanded CI pipeline** — add E2E tests (Playwright) and a coverage threshold check to the existing GitHub Actions workflow
- [ ] **Automated dependency updates** — configure Dependabot (or Renovate) to open PRs for outdated dependencies on a weekly schedule
- [ ] **Error tracking with Sentry** — integrate Sentry for both client-side and server-side error capture; configure source maps so stack traces reference original TypeScript
- [ ] **Uptime monitoring** — configure a free uptime monitor (Better Uptime, UptimeRobot) for the production URL; provide evidence of the monitor and alert configuration
- [ ] **Automated changelog** — configure `standard-version` or `release-it` to generate `CHANGELOG.md` automatically from conventional commit history on each release tag

---

## 19. Internationalisation (i18n)

- [ ] **Multi-language support** — integrate `next-intl` (or equivalent); support at least two languages; all user-visible strings are externalised into message files — zero hard-coded English strings remain in components
- [ ] **Language switcher** — a UI control that lets users switch language at runtime; preference is persisted and reflected in the URL locale prefix
- [ ] **RTL layout support** — the application layout renders correctly in a right-to-left language (Arabic or Hebrew); tested using browser dev tools direction toggle

---

## 20. Developer Experience

- [ ] **Path aliases** — configure `@/` path aliases in `tsconfig.json` for all internal import paths; zero relative `../../` imports exist anywhere in the codebase
- [ ] **JSDoc comments on all exports** — every exported function, component, hook, and type has a JSDoc comment describing its purpose, parameters, and return value
- [ ] **VS Code workspace settings** — add a `.vscode/settings.json` with recommended formatter, linter, and TypeScript settings pre-configured for this project; document in `SETUP.md`
- [ ] **Husky pre-push hook** — add a `pre-push` hook that runs `pnpm type-check` and `pnpm test -- --run` before allowing a push; document in `CONTRIBUTING.md`
- [ ] **Architectural Decision Records (ADRs)** — document at least five significant technical decisions your team made in `/docs/decisions/` using the lightweight ADR format (context → decision → consequences)
