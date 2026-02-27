# Complete Final Prompt — Next.js Starter Template Generation

> **For instructor use only.**
> This file contains the full generation prompt used to create this starter template.
> Use this with Claude Opus 4.6 (or equivalent large context model) to regenerate or update the template.

---

## SYSTEM CONTEXT

You are an expert Next.js developer, educator, and software architect. You are tasked with generating a complete, production-quality starter template for a college-level web development course. This template will be distributed to student teams via GitHub Classroom as a Group Assignment. The template must balance being a professional, industry-standard codebase while serving as an educational scaffold that teaches students about modern development practices, collaboration, and process as much as the final product itself.

**Every major technical decision in this template must be accompanied by documentation explaining what it is, why it was chosen, and how students can work with or extend it.**

---

## PROJECT OVERVIEW

Create a complete Next.js starter template repository with the following characteristics:

- A clean, professional SaaS-style web application starter
- Mobile-first, fully responsive from day one
- Opinionated enough to guide students but flexible enough to support diverse project ideas
- No backend implementation, no auth implementation, no database configuration, no payment implementation, no AI implementation — these are intentionally absent as student responsibilities
- Rich with educational documentation covering every decision made
- Configured for collaborative team development with enforced process standards

---

## TECHNOLOGY STACK

### Core Framework

- **Next.js** — latest stable version using the **App Router** (not Pages Router)
- Follow `create-next-app` conventions as closely as possible for the base structure so students can follow official Next.js tutorials without confusion
- Extend the default structure minimally with `/docs`, `/hooks`, `/lib`, `/types` directories

### Language

- **TypeScript** in **relaxed mode** (not strict)
- `tsconfig.json` should have strict mode disabled but be well commented
- Include a `/docs/typescript.md` file explaining:
  - What TypeScript is and why it is used
  - The difference between relaxed and strict mode
  - Exactly what changes students need to make to enable strict mode
  - What errors they might encounter when switching and how to address them

### Styling

- **Tailwind CSS** only — no component library pre-installed
- Include a `/docs/styling.md` explaining:
  - What Tailwind CSS is and how utility-first CSS works
  - How to customize the `tailwind.config.ts`
  - A comprehensive list of component library options students could add (shadcn/ui, DaisyUI, MUI, Chakra UI, Radix UI) with pros/cons of each
  - Step-by-step instructions for adding shadcn/ui as it is the recommended option
  - How to add other component libraries if they choose differently
  - Font configuration and how to change or add fonts
  - Dark mode implementation guidance (noted as an enhancement)

### Package Manager

- **pnpm** — include a note in README explaining why pnpm was chosen over npm/yarn
- Include `.npmrc` configured for pnpm
- All scripts and instructions must use pnpm commands

### Runtime

- **Node.js** — latest LTS version compatible with the latest stable Next.js
- Specify the required Node.js version in:
  - `.nvmrc` file
  - `package.json` engines field
  - README prerequisites section

---

## DEVELOPMENT ENVIRONMENT

### Dev Container (Optional)

- Include a fully configured `.devcontainer/devcontainer.json`
- The dev container must be **completely optional** — the project must work perfectly without it
- Dev container should include:
  - Appropriate base image compatible with Node.js LTS and pnpm
  - Port forwarding for Next.js dev server (port 3000)
  - Post-create command to install dependencies with pnpm
  - VS Code extensions pre-configured:
    - Tailwind CSS IntelliSense
    - ESLint
    - Prettier
    - TypeScript and JavaScript Language Features
    - GitLens
    - GitHub Copilot
    - GitHub Copilot Chat
    - Error Lens
    - Conventional Commits helper
- Include `/docs/devcontainer.md` explaining:
  - What a dev container is and why it is useful for team consistency
  - How to use it (requires Docker + VS Code Dev Containers extension)
  - That it is entirely optional
  - Benefits of using it for team environment consistency

---

## APPLICATION STRUCTURE

### Folder Structure

Follow `create-next-app` App Router conventions with minimal extensions:

```
/
├── .devcontainer/
│   └── devcontainer.json
├── .github/
│   ├── workflows/
│   │   └── ci.yml
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   ├── feature_request.md
│   │   ├── sprint_task.md
│   │   └── documentation.md
│   └── pull_request_template.md
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx
│   │   ├── pricing/
│   │   │   └── page.tsx
│   │   ├── about/
│   │   │   └── page.tsx
│   │   └── contact/
│   │       └── page.tsx
│   ├── (dashboard)/
│   │   └── dashboard/
│   │       └── page.tsx
│   ├── (auth)/
│   │   ├── login/
│   │   │   └── page.tsx
│   │   └── signup/
│   │       └── page.tsx
│   ├── (admin)/
│   │   └── admin/
│   │       └── dashboard/
│   │           └── page.tsx
│   ├── profile/
│   │   └── page.tsx
│   ├── api/
│   │   ├── health/
│   │   │   └── route.ts
│   │   ├── example/
│   │   │   └── route.ts
│   │   └── README.md
│   ├── not-found.tsx
│   ├── error.tsx
│   ├── loading.tsx
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx
│   │   └── Footer.tsx
│   └── ui/
│       └── .gitkeep
├── hooks/
│   └── .gitkeep
├── lib/
│   └── utils.ts
├── types/
│   └── index.ts
├── public/
│   └── logo.svg
├── docs/
│   ├── typescript.md
│   ├── styling.md
│   ├── devcontainer.md
│   ├── git-workflow.md
│   ├── contributing-guide.md
│   ├── ci-cd-requirements.md
│   ├── deployment-guide.md
│   ├── testing.md
│   ├── state-management.md
│   ├── api-routes.md
│   ├── code-quality.md
│   ├── accessibility.md
│   ├── performance.md
│   ├── agile-process.md
│   ├── ai-usage-policy.md
│   ├── ai-features.md
│   ├── component-libraries.md
│   ├── payments.md
│   ├── admin-guide.md
│   └── enhancements.md
├── middleware.ts
├── .env.example
├── .eslintrc.json
├── .prettierrc
├── .prettierignore
├── .gitignore
├── .nvmrc
├── commitlint.config.js
├── vitest.config.ts
├── vitest.setup.ts
├── tailwind.config.ts
├── next.config.ts
├── tsconfig.json
├── package.json
├── pnpm-lock.yaml
├── CONTRIBUTING.md
├── SETUP.md
├── ENHANCEMENTS.md
└── README.md
```

---

## PAGES & UI

### Design Requirements

- Mobile-first, fully responsive using Tailwind CSS breakpoints
- Neutral, generic color palette using Tailwind defaults — easy for students to restyle
- Consistent navigation across all pages
- Professional SaaS aesthetic that serves as a realistic starting point
- All placeholder text must use the format `[Your App Name]`, `[Your Tagline Here]` etc. — explicitly obvious placeholders
- Every page must include a comment block at the top explaining what it is and what students should replace
- Include a simple text-based or geometric SVG placeholder logo in `/public/logo.svg`
- All pages must have placeholder metadata (title, description) using Next.js Metadata API

### Pages to Generate

**Landing Page** (`app/(marketing)/page.tsx`):

- Hero section with headline, subheadline, and CTA buttons
- Features section with 3-6 feature cards
- Testimonials section (placeholder)
- Final CTA section
- All content clearly marked as placeholder

**Pricing Page** (`app/(marketing)/pricing/page.tsx`):

- 3 pricing tier cards (Free, Pro, Enterprise as placeholders)
- Feature comparison list per tier
- CTA buttons per tier
- Comment noting students must wire up payment processing for upgrade buttons

**About Page** (`app/(marketing)/about/page.tsx`):

- Mission/vision section
- Team section (placeholder team members)
- Story section

**Contact Page** (`app/(marketing)/contact/page.tsx`):

- Contact form shell (UI only, no backend wired up)
- Form fields: name, email, message
- Submit button (non-functional, clearly commented as requiring backend implementation)
- Comment explaining students must implement form submission themselves

**Dashboard Page** (`app/(dashboard)/dashboard/page.tsx`):

- Simple dashboard shell layout
- Placeholder stat cards
- Empty content area
- Clearly commented as the authenticated area students will build out

**Login Page** (`app/(auth)/login/page.tsx`):

- Login form UI only (email + password)
- No auth logic whatsoever
- Prominent comment explaining auth must be implemented by the team
- Link to signup page

**Signup Page** (`app/(auth)/signup/page.tsx`):

- Signup form UI only (name, email, password, confirm password)
- No auth logic whatsoever
- Prominent comment explaining auth must be implemented by the team
- Link to login page

**Profile Page** (`app/profile/page.tsx`):

- Account settings shell
- Placeholder form fields for name, email, avatar
- Placeholder subscription status section showing free vs premium tier
- Clearly commented as requiring auth and database implementation

**Admin Dashboard** (`app/(admin)/admin/dashboard/page.tsx`):

- Protected admin area shell — UI only, no auth protection implemented
- Placeholder stat cards: total users, active sessions, recent signups, revenue, recent activity feed
- Basic data table shell with placeholder rows
- Prominent comment block explaining:
  - This route is currently completely unprotected
  - Students must implement RBAC when they implement auth
  - Reference to `middleware.ts` and `/docs/admin-guide.md`
  - Only users with an admin role should ever reach this page

**Custom 404 Page** (`app/not-found.tsx`):

- Styled to match the overall template aesthetic
- Clear "Page Not Found" messaging
- Navigation back to home
- Comment indicating students should restyle to match their final design

**Error Page** (`app/error.tsx`):

- Global error boundary following Next.js App Router conventions
- Styled consistently with the template
- Reset button with `reset` function prop wired up correctly

**Loading Page** (`app/loading.tsx`):

- Global loading state following Next.js App Router conventions
- Simple, clean loading indicator using Tailwind CSS only
- Comment explaining the `loading.tsx` convention and how to add route-specific loading states

### Navigation & Layout

- Responsive Navbar with:
  - Placeholder SVG logo
  - Navigation links to all marketing pages
  - Login/Signup CTA buttons
  - Mobile hamburger menu functional with Tailwind only (no JS dependencies)
- Footer with:
  - Placeholder copyright `© [Year] [Your App Name]`
  - Navigation links grouped by section
  - Social media placeholder links
- Root layout wrapping all pages with Navbar and Footer
- Navbar and Footer clearly commented indicating what students should update

---

## MIDDLEWARE STUB

Generate `middleware.ts` at the root level as a commented stub only:

```typescript
// =============================================================================
// MIDDLEWARE STUB
// =============================================================================
// Next.js Middleware runs before every matched request and is the right place
// to implement route protection, authentication checks, role-based access
// control (RBAC), and redirects.
//
// Currently this file does nothing — it is intentionally left for your team
// to implement as part of your authentication and authorization work.
//
// STUDENT: When you have implemented authentication, this is where you would:
// - Check if a user is authenticated before allowing access to protected routes
// - Check if a user has the required role (e.g. 'admin') for admin-only routes
// - Redirect unauthenticated users to the login page
// - Redirect unauthorized users to an appropriate error or home page
//
// Important: Middleware alone is not sufficient for security — always validate
// permissions on the server side as well (in your API routes or Server Actions)
//
// Helpful resources:
// - Next.js Middleware: https://nextjs.org/docs/app/building-your-application/routing/middleware
// - See /docs/admin-guide.md for context on protecting the admin route
// - Your chosen auth provider will have specific middleware examples
//   in their own documentation — refer to those when implementing
//
// The matcher config below shows which routes middleware would typically apply to.
// This is commented out — do not uncomment until you have auth implemented.
//
// export const config = {
//   matcher: [
//     '/admin/:path*',
//     '/dashboard/:path*',
//     '/profile/:path*',
//   ]
// }
// =============================================================================

export {}
```

---

## API ROUTES

Include the following example API route handlers to demonstrate the App Router API pattern. Each must include detailed comments, TypeScript typing, and error handling:

1. **`/api/health` (GET)** — Returns `{ status: 'ok', timestamp: Date, environment: string }`
2. **`/api/example` (GET)** — Returns a typed list of example items demonstrating a collection response pattern
3. **`/api/example` (POST)** — Accepts a typed request body, demonstrates validation pattern, returns created item pattern with appropriate HTTP status codes

Each route must demonstrate:

- Proper Next.js App Router route handler syntax (`export async function GET/POST`)
- TypeScript request/response typing
- Try/catch error handling with appropriate HTTP status codes (200, 201, 400, 500)
- `NextResponse.json()` usage
- Clear comments explaining the pattern and how students can extend it
- A comment referencing `/docs/api-routes.md` for further reading

Include `app/api/README.md` directing students to `/docs/api-routes.md`.

---

## CODE QUALITY

### ESLint

- Next.js default ESLint config as base (`eslint-config-next`)
- `eslint-plugin-jsx-a11y` for accessibility linting
- Sensible rule overrides appropriate for student/beginner level
- `.eslintrc.json` fully configured and commented

### Prettier

`.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

- `.prettierignore` configured to exclude build output, node_modules, and generated files

### Husky + lint-staged

- Configure Husky for git hooks via `prepare` script
- `pre-commit` hook runs lint-staged
- lint-staged configured in `package.json` to run ESLint and Prettier on staged `.ts` and `.tsx` files
- Blocks commits that fail linting or formatting checks

### Conventional Commits (commitlint)

- Install and configure `commitlint` with `@commitlint/config-conventional`
- Husky `commit-msg` hook enforces conventional commit format
- `commitlint.config.js` configured
- Valid commit types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`

---

## TESTING

### Vitest Setup

- Install and configure Vitest with:
  - `@vitejs/plugin-react`
  - `@testing-library/react`
  - `@testing-library/jest-dom`
  - `@testing-library/user-event`
  - `jsdom` test environment
- `vitest.config.ts` fully configured
- `vitest.setup.ts` with jest-dom matchers imported
- **Zero test files written** — configuration only
- `__tests__/README.md` explaining where tests should be added, referencing `/docs/testing.md`
- `pnpm test`, `pnpm test:ui`, and `pnpm test:coverage` scripts in `package.json`

---

## ENVIRONMENT VARIABLES

`.env.example`:

```bash
# =============================================================================
# ENVIRONMENT VARIABLES
# =============================================================================
# Copy this file to .env.local and fill in your values.
# NEVER commit .env.local to git — it is already in .gitignore
#
# Variables prefixed with NEXT_PUBLIC_ are exposed to the browser.
# All other variables are server-side only.
# =============================================================================

# Application
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=[Your App Name]

# Add your project-specific environment variables below as you build
```

---

## FONTS

- Configure Next.js font optimization using `next/font/google` with Inter as the example font
- Applied in `app/layout.tsx` as a CSS variable
- Comments in `layout.tsx` explaining how to swap or add additional fonts
- Font optimization covered in `/docs/styling.md`

---

## GIT & GITHUB CONFIGURATION

### .gitignore

Comprehensive `.gitignore` covering:

- `.env.local` and all `.env*.local` files
- `node_modules`
- Next.js build output (`.next/`, `out/`)
- pnpm specific files
- OS specific files (`.DS_Store`, `Thumbs.db`)
- IDE files — exclude `.vscode/settings.json` but **include** `.vscode/extensions.json`
- Vitest coverage output

### GitHub Actions (`/.github/workflows/ci.yml`)

CI workflow triggers on every push and pull request to `main`:

- Set up Node.js with correct version
- Install pnpm
- Install dependencies with `pnpm install --frozen-lockfile`
- Run ESLint (`pnpm lint`)
- Run Prettier check (`pnpm format:check`)
- Run TypeScript type check (`pnpm type-check`)
- Run build check (`pnpm build`)
- Run tests (`pnpm test`)

### PR Template (`.github/pull_request_template.md`)

```markdown
## Description
<!-- What does this PR do? Be specific and clear -->

## Related Issue
<!-- Link the issue this PR addresses: Closes #[issue number] -->

## Type of Change
- [ ] New feature (`feat`)
- [ ] Bug fix (`fix`)
- [ ] Documentation update (`docs`)
- [ ] Refactor (`refactor`)
- [ ] Chore (`chore`)

## How Has This Been Tested?
<!-- Describe how you tested your changes -->

## Screenshots
<!-- If this is a UI change, add before/after screenshots here -->

## Checklist
- [ ] My code follows the project style guidelines (ESLint + Prettier passing)
- [ ] I have reviewed my own code before requesting review
- [ ] I have added comments where the code is not self-explanatory
- [ ] My changes do not introduce new ESLint warnings
- [ ] I have updated relevant documentation if needed
- [ ] All commits in this PR follow the Conventional Commits standard
- [ ] ⚠️ I confirm that NO AI agent performed any git operations (commits, pushes, merges,
      branch creation) in this PR. All git operations were performed by a human team member.

## Ready for Review
- [ ] This PR is ready for team and/or instructor review
```

### Issue Templates

**Bug Report** (`.github/ISSUE_TEMPLATE/bug_report.md`):

- Summary of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment info (browser, OS, Node version)
- Screenshots if applicable
- Label: `bug`

**Feature Request** (`.github/ISSUE_TEMPLATE/feature_request.md`):

- User story format: `As a [type of user], I want [goal] so that [benefit]`
- Acceptance criteria checklist
- Priority: Low / Medium / High
- T-shirt size estimate: S / M / L / XL
- Label: `enhancement`

**Sprint Task** (`.github/ISSUE_TEMPLATE/sprint_task.md`):

- Task description
- Sprint number
- Story points or t-shirt size
- Acceptance criteria checklist
- Link to related feature or epic
- Label: `sprint-task`

**Documentation** (`.github/ISSUE_TEMPLATE/documentation.md`):

- What needs documenting
- Why it is needed
- Where it should live in the project
- Label: `documentation`

---

## DOCUMENTATION FILES

All documentation lives in `/docs/` and must be linked from the main `README.md`. Every document must be well-formatted, written directly to students in an encouraging but professional tone, and include commands, examples, and links to official docs.

### `/docs/typescript.md`

- What TypeScript is and why it was chosen
- Relaxed vs strict mode — what is off and why
- Step-by-step instructions to enable strict mode (exact `tsconfig.json` changes)
- Common TypeScript errors students will encounter and how to fix them
- Links to official TypeScript and Next.js TypeScript docs

### `/docs/styling.md`

- Tailwind CSS philosophy and how utility-first CSS works
- How to read and customize `tailwind.config.ts`
- How `next/font` works and how to change or add fonts
- Component library options with pros/cons:
  - shadcn/ui (recommended — step-by-step install guide included)
  - DaisyUI
  - MUI (Material UI)
  - Chakra UI
  - Radix UI
- Dark mode implementation overview (referenced as enhancement)
- Links to Tailwind and component library docs

### `/docs/devcontainer.md`

- What a dev container is and the problem it solves
- How to use the dev container in this project
- Prerequisites (Docker Desktop, VS Code Dev Containers extension)
- That it is completely optional
- What VS Code extensions are pre-installed and why
- Troubleshooting common dev container issues

### `/docs/git-workflow.md`

- Feature branching strategy — why it is mandated
- Branch naming conventions:
  - `feature/short-description`
  - `fix/short-description`
  - `docs/short-description`
  - `chore/short-description`
- Step-by-step workflow with exact git commands
- How to keep a branch up to date with main
- How to resolve merge conflicts
- Visual ASCII diagram of the branching workflow

### `/docs/contributing-guide.md`

- Team structure: 1 Admin, remaining Maintainers
- Feature branch workflow summary
- Conventional Commits with examples of every type
- PR process and what good PR descriptions look like
- Code review expectations
- Definition of Done checklist
- AI usage policy summary with link to `/docs/ai-usage-policy.md`

### `/docs/ci-cd-requirements.md`

Written as a requirements document:

- What CI/CD is and why it matters
- What the existing GitHub Actions workflow does
- **Student Requirements:**
  - ✅ Required: All CI checks must pass before merging any PR
  - ✅ Required: Never merge a PR with failing checks
  - 🎯 Enhancement: Automated deployment to Vercel/Netlify on merge to main
  - 🎯 Enhancement: PR preview deployments
  - 🎯 Enhancement: Dependabot for automated dependency updates
  - 🎯 Enhancement: Automated security scanning
- How to read GitHub Actions logs
- How to extend the existing workflow

### `/docs/deployment-guide.md`

- Deployment options overview:
  - **Vercel** (recommended)
  - Netlify
  - Railway
  - Render
- Step-by-step guide for deploying to Vercel
- Environment variables in deployment context
- Preview deployments on PRs
- Custom domain setup overview

### `/docs/testing.md`

- Why testing matters
- What Vitest is and why it was chosen over Jest
- Types of tests: unit, component, integration, end-to-end
- How to write your first component test — step-by-step example
- How to run tests: `pnpm test`, `pnpm test:ui`, `pnpm test:coverage`
- How to interpret test results and coverage reports
- Where to put test files
- How to add Playwright for end-to-end testing
- Note: comprehensive test coverage is a path to a higher grade

### `/docs/state-management.md`

- What state management is and when you need it
- Built-in React state — `useState`, `useReducer`, Context API
- When to reach for an external library
- Options with pros/cons:
  - **Zustand** (recommended)
  - Redux Toolkit
  - Jotai
  - Recoil
- Getting started with Zustand — step-by-step
- Server state vs client state — mention TanStack Query

### `/docs/api-routes.md`

- How Next.js App Router API routes work
- GET, POST, PUT, PATCH, DELETE handlers
- Request and response typing with TypeScript
- Error handling patterns and HTTP status codes
- How to add new routes step-by-step
- Server Actions as an alternative pattern
- Reference to example routes in `app/api/`

### `/docs/code-quality.md`

- What ESLint does and why it is configured this way
- What `eslint-plugin-jsx-a11y` adds
- What Prettier does and the value of consistent formatting
- The configured Prettier rules and what each does
- What Husky and lint-staged do
- Conventional Commits — every type with examples
- What to do when a commit is blocked
- How to extend ESLint and Prettier configurations

### `/docs/accessibility.md`

- What web accessibility is and why it matters
- WCAG 2.1 guidelines overview
- How `eslint-plugin-jsx-a11y` catches issues automatically
- Common accessibility mistakes in React/Next.js
- Semantic HTML, ARIA labels, keyboard navigation, color contrast
- Tools for testing: axe DevTools, Lighthouse, screen readers
- Resources for learning more
- Note: full accessibility audit is in `ENHANCEMENTS.md`

### `/docs/performance.md`

- Server Components vs Client Components — when to use each
- Static vs Dynamic rendering
- `next/image` — how to use it and why
- `next/font` — how it works and performance benefits
- Metadata and SEO with Next.js Metadata API
- Lazy loading and dynamic imports
- How to measure performance: Lighthouse, Web Vitals (LCP, FID, CLS)
- Note: performance optimization is in `ENHANCEMENTS.md`

### `/docs/agile-process.md`

- Agile overview in the context of a 6-week student project
- **Sprint length recommendation: 2-3 days**
  - Rationale: short timeline, AI-accelerated development, maximizes process repetition
  - ~13-14 sprints available across the project
- Project timeline: **March 2 — April 13**
- **Continuous assessment**: present completed features to instructor as they are done
- **Final presentation**: live demo on April 13
- Sprint structure:
  - Sprint Planning
  - Daily async standup
  - Sprint Review — demo to instructor for assessment
  - Sprint Retrospective
- How to use GitHub Projects as a Kanban board step-by-step
- Writing issues as user stories with acceptance criteria
- Definition of Done checklist
- How AI tools fit into the sprint workflow responsibly

### `/docs/ai-usage-policy.md`

**This document must be prominent, unambiguous, and clearly highlight the hard rule.**

- GitHub Copilot is **strongly encouraged** as the primary AI coding assistant
- Teams may use other AI tools but must **agree as a team and document their choice**
- Team consistency in AI tool usage is expected
- Suggested team AI agreement template:

```
Our team agrees to use: [tool/model name]
We will use it for: [specific use cases]
We will not use it for: [git operations, etc.]
Agreed by: [team member names and date]
```

> ⚠️ **HARD RULE:**
> Every single commit to every branch in your repository MUST be performed by a human team
> member using standard git operations. AI agents must NEVER perform any git operations of
> any kind — this includes commits, pushes, pulls, merges, branch creation, PR creation, or
> any other GitHub activity. Any evidence that an AI agent performed git or GitHub operations
> will result in a team grade penalty. There are no exceptions to this rule.

- AI is a coding assistant — developers must read, understand, and own every line before committing
- Code ownership: students will be asked about their code during presentations
- AI-generated code still requires human PR review
- Responsible prompting guidance:
  - Be specific in prompts
  - Verify AI output — it can be wrong
  - Use AI to learn, not just to copy
  - Document when AI helped with a non-trivial solution

### `/docs/ai-features.md`

- Why AI features in SaaS are increasingly expected
- AI feature ideas:
  - Chatbot / AI assistant
  - Content generation
  - Smart search
  - Personalized recommendations
  - Data summarization
  - Image analysis
  - Automated categorization
- **OpenRouter** as the primary recommended API provider:
  - Single API routing to many models
  - Free tier models available — good for student projects
  - How to get an API key at openrouter.ai
  - Compatible with OpenAI SDK format
  - Example models: GPT-4o, Claude, Llama, Mixtral
- **Vercel AI SDK** as the recommended Next.js integration layer:
  - Pairs perfectly with Next.js App Router
  - Streaming responses
  - `useChat` and `useCompletion` hooks
  - How to connect to OpenRouter
- Basic implementation pattern overview (conceptual — students implement)
- Cost, rate limiting, and responsible AI feature design

### `/docs/payments.md`

- The freemium model concept and why SaaS products use it
- How to think about free vs premium feature gating
- The concept of a `subscriptionStatus` or `isPremium` field on a user record
- **Stripe** as the primary recommended provider:
  - **Test mode** — build and test without real money
  - Test card numbers (`4242 4242 4242 4242`)
  - Stripe Checkout — simplest integration path
  - Stripe webhooks — subscription status updates
  - Stripe Customer Portal
- **Lemon Squeezy** as a simpler alternative
- **Paddle** as another option for international payments
- How to structure the upgrade flow in the UI
- Always verify subscription status server-side — never trust client-side only

### `/docs/admin-guide.md`

- What the admin dashboard is and its purpose
- What RBAC is — roles, how they are stored, how they are checked
- The admin dashboard route in this project is currently completely unprotected
- Why client-side protection alone is insufficient
- Where protection should be implemented:
  - `middleware.ts` — redirect before the page loads
  - Server Components — check session/role server-side
  - API routes — verify role before returning sensitive data
- Reference to `middleware.ts` stub
- How different BaaS providers handle roles:
  - Supabase — Row Level Security and user metadata
  - Firebase — Custom Claims
  - Clerk — Roles and permissions built in
- Suggested admin features to implement (all student work)

### `/docs/component-libraries.md`

- Overview of the component library landscape
- **shadcn/ui** — detailed recommended guide with step-by-step installation
- **DaisyUI** — overview and getting started
- **MUI** — overview and when it makes sense
- **Chakra UI** — overview
- **Radix UI** — overview (note: shadcn/ui is built on Radix)
- How to evaluate which library is right for your project

---

## ROOT LEVEL DOCUMENTS

### `README.md` (Central Hub)

Must include:

- Project header with placeholder logo reference
- **Direct note to students** explaining the purpose of this template
- Prerequisites with exact versions (Node.js, pnpm, Git)
- Getting started step-by-step:

```bash
git clone [your-repo-url]
cd [your-repo-name]
pnpm install
cp .env.example .env.local
pnpm dev
```

- Project structure overview with explanation of each top-level directory
- All available pnpm scripts with descriptions
- Tech stack summary table with rationale
- **Documentation index** — table linking to every `/docs/*.md` file with one-line descriptions
- Contributing section linking to `CONTRIBUTING.md`
- Prominent link to `SETUP.md` as the very first thing to do

### `SETUP.md` (First Steps Guide)

Step-by-step guide for immediately after receiving the GitHub Classroom assignment:

1. Clone and install — clone repo, install dependencies, copy `.env.example`
2. Verify it runs — `pnpm dev` and confirm the app loads at `localhost:3000`
3. Team decides on Admin — who takes the admin GitHub role (document this decision)
4. **Admin configures branch protection on `main`**:
   - Go to repo Settings → Branches → Add rule for `main`
   - ✅ Require a pull request before merging
   - ✅ Require at least 1 approving review
   - ✅ Require status checks to pass before merging (select the CI workflow)
   - ✅ Do not allow bypassing the above settings
   - Detailed step-by-step with GitHub UI navigation described
5. Admin sets team members as Maintainers — Settings → Manage Access
6. Team agrees on AI tools — complete the AI team agreement in `/docs/ai-usage-policy.md`
7. Set up GitHub Projects board — follow `/docs/agile-process.md`
8. Create Sprint 1 issues — first sprint planning session
9. Replace placeholder branding — checklist of every file containing `[Your App Name]`
10. Practice run — make a small change on a feature branch, open a PR, review, merge — get comfortable with the workflow before real work begins

### `CONTRIBUTING.md`

- Feature branching is **mandated** — no direct commits to main
- Conventional Commits are **enforced** via commitlint
- Branch naming conventions with examples
- Step-by-step PR process
- Code review expectations — minimum 1 review required
- **AI git operations rule — displayed with maximum prominence**
- Link to full AI policy in `/docs/ai-usage-policy.md`

### `ENHANCEMENTS.md`

Exhaustive categorized list of enhancements for higher grades and stretch goals:

**UI/UX Enhancements:**

- Dark/light mode toggle with system preference detection (`prefers-color-scheme`)
- Smooth animations and page transitions (Framer Motion)
- Skeleton loading states for async content
- Toast notification system
- Modal and dialog system
- Advanced responsive design patterns (drawer navigation, bottom sheet)
- Custom illustration or icon set integration (Lucide, Heroicons, custom SVG)
- Micro-interactions and hover effects
- Onboarding flow / product tour for new users
- Empty state designs for all data views

**Core Functionality:**

- Full authentication implementation
- Complete CRUD operations for core data entities
- Real-time features (WebSockets, Supabase Realtime, Pusher)
- Full-text search functionality
- Advanced filtering, sorting, and pagination
- Infinite scroll or cursor-based pagination
- File upload with preview
- Email notification system (Resend, SendGrid)
- Push notifications (Web Push API / PWA)
- Internationalization / localization (i18n) with `next-intl`
- Multi-tenancy support

**AI Features:**

- AI chatbot / assistant for end users
- AI-powered content generation
- Smart search with semantic understanding
- Personalized recommendations engine
- Data summarization and insights
- Image analysis integration
- Automated content categorization

**Payments & Monetization:**

- Full Stripe payment processing integration
- Subscription tier management (free vs premium)
- Premium feature gating based on subscription status
- Stripe Customer Portal for self-service billing
- Webhook handling for subscription lifecycle events
- Usage-based billing tracking

**Admin & Analytics:**

- Admin dashboard with real data from the database
- User management interface
- Role management (promote/demote users)
- Content moderation tools
- Revenue and subscription analytics
- User activity and engagement metrics
- System health monitoring dashboard

**Performance:**

- Comprehensive `next/image` implementation throughout
- Bundle size analysis and optimization (`@next/bundle-analyzer`)
- Code splitting audit and improvements
- Edge runtime for performance-critical routes
- Caching strategies
- Performance monitoring integration (Vercel Analytics, PostHog)

**Testing:**

- Unit tests for all utility functions in `/lib`
- Component tests for all UI components
- Integration tests for all API routes
- End-to-end tests with Playwright
- Accessibility testing automation with axe
- Visual regression testing
- Test coverage above 80%

**DevOps & Process:**

- Full CI/CD pipeline with automated deployment to Vercel
- PR preview deployments
- Automated dependency updates with Dependabot
- Docker containerization
- Error tracking and monitoring (Sentry)
- Uptime monitoring
- Automated changelog generation from conventional commits

**Accessibility:**

- Full WCAG 2.1 AA compliance audit and remediation
- Screen reader testing with VoiceOver and NVDA
- Comprehensive keyboard navigation
- Focus trap management in modals and drawers
- Color contrast audit and fixes
- Reduced motion support (`prefers-reduced-motion`)
- Skip navigation links

**Security:**

- Security headers configuration (`next.config.ts`)
- Rate limiting on API routes (Upstash, custom middleware)
- Input validation and sanitization (Zod)
- CSRF protection
- Content Security Policy (CSP)
- Dependency vulnerability scanning

**Developer Experience:**

- Storybook component documentation
- API documentation with Swagger/OpenAPI
- Comprehensive JSDoc comments throughout
- Custom VS Code code snippets
- Husky pre-push hook for additional checks
- Automated PR size labeling

---

## PACKAGE.JSON SCRIPTS

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "lint:fix": "next lint --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "type-check": "tsc --noEmit",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "prepare": "husky"
  }
}
```

---

## QUALITY STANDARDS FOR ALL GENERATED FILES

Every file generated must meet these standards:

1. **No unaddressed TODOs** — use `// STUDENT: implement this` comment pattern consistently
2. **All TypeScript props typed** — all component props must have interfaces
3. **No `any` types** — use `unknown` if type is truly unknown
4. **All pages render without errors** — every page must work out of the box
5. **Mobile-first CSS** — Tailwind classes start from mobile, use `md:` and `lg:` for larger screens
6. **Semantic HTML throughout** — correct elements for correct purposes
7. **Consistent code style** — as if written by a single developer
8. **Educational comments** — explain patterns and point to relevant documentation
9. **No hardcoded secrets** of any kind anywhere
10. **All imports resolve** — no broken import paths
11. **Placeholder text is obvious** — always use `[Your App Name]` format
12. **Comment blocks on every page** — explaining what the page is and what students need to replace

---

## PROJECT CONTEXT

- Student teams of **3-4 people**
- Distributed via **GitHub Classroom Group Assignment**
- **1 team member is Admin, remaining are Maintainers**
- Project runs **March 2 to April 13** (approximately 6 weeks)
- **2-3 day sprints** recommended (~13-14 sprints total)
- Students **present individual features to the instructor** as they complete them
- **Final live presentation on April 13**
- Students have access to **GitHub Copilot** (strongly encouraged, not strictly mandated)
- **Hard rule**: No AI agent may perform any git operation — all commits must be human
- All student teams will implement: **user auth**, **freemium payment model**, **AI feature for end users**, **admin-only dashboard with RBAC**
- These four requirements are **absent from the template** — students implement them entirely
- The template should feel **welcoming and professional** — not overwhelming
- Documentation tone: **encouraging, clear, direct** — treat students as capable developers

---

*Generate every file in the folder structure completely and fully. Do not stub, summarize, or truncate any file. Every file listed must contain its full, real, working content. The template must be immediately usable by cloning and running `pnpm install && pnpm dev`.*
