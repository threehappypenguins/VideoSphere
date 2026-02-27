# [Your App Name]

> **A Next.js SaaS Starter Template for Web Development Teams**

This repository is a starter template for your team project. It provides a fully configured development environment, project structure, and comprehensive documentation to get your team building immediately.

**👉 Start here: [SETUP.md](SETUP.md)** — Complete the first-run setup before doing anything else.

## Prerequisites

| Tool    | Version  | Check Command    |
| ------- | -------- | ---------------- |
| Node.js | ≥ 20.0.0 | `node --version` |
| pnpm    | ≥ 9.0.0  | `pnpm --version` |
| Git     | Latest   | `git --version`  |

## Getting Started

```bash
# 1. Clone the repository
git clone [your-repo-url]
cd [your-repo-name]

# 2. Install dependencies
pnpm install

# 3. Copy environment variables
cp .env.example .env.local

# 4. Start the development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see your app.

## Project Structure

```
├── app/                    # Next.js App Router pages and layouts
│   ├── (admin)/            # Admin route group (protected — you implement)
│   ├── (auth)/             # Auth pages: login, signup (you implement logic)
│   ├── (dashboard)/        # Dashboard route group
│   ├── (marketing)/        # Public pages: landing, pricing, about, contact
│   ├── api/                # API routes (Route Handlers)
│   ├── layout.tsx          # Root layout with Navbar and Footer
│   ├── globals.css         # Global styles and Tailwind configuration
│   ├── error.tsx           # Global error boundary
│   ├── loading.tsx         # Global loading state
│   └── not-found.tsx       # 404 page
├── components/             # Reusable React components
│   ├── layout/             # Navbar, Footer
│   └── ui/                 # UI components (add shadcn/ui or your own)
├── hooks/                  # Custom React hooks
├── lib/                    # Utility functions and shared logic
├── types/                  # TypeScript type definitions
├── public/                 # Static assets (images, fonts, etc.)
├── docs/                   # Project documentation (21 guides)
├── __tests__/              # Test files
├── .github/                # GitHub workflows, PR template, issue templates
├── .devcontainer/          # Dev Container configuration
└── [config files]          # TypeScript, ESLint, Prettier, Vitest, etc.
```

## Available Scripts

| Script               | Command                 | Description                     |
| -------------------- | ----------------------- | ------------------------------- |
| `pnpm dev`           | `next dev --turbopack`  | Start dev server with Turbopack |
| `pnpm build`         | `next build`            | Create production build         |
| `pnpm start`         | `next start`            | Start production server         |
| `pnpm lint`          | `next lint`             | Run ESLint                      |
| `pnpm lint:fix`      | `next lint --fix`       | Run ESLint and auto-fix issues  |
| `pnpm format`        | `prettier --write .`    | Format all files with Prettier  |
| `pnpm format:check`  | `prettier --check .`    | Check formatting (used in CI)   |
| `pnpm type-check`    | `tsc --noEmit`          | Check TypeScript types          |
| `pnpm test`          | `vitest`                | Run tests in watch mode         |
| `pnpm test:ui`       | `vitest --ui`           | Run tests with browser UI       |
| `pnpm test:coverage` | `vitest run --coverage` | Run tests with coverage report  |

## Tech Stack

| Technology      | Purpose           | Why It's Here                             |
| --------------- | ----------------- | ----------------------------------------- |
| Next.js 16      | React framework   | App Router, Server Components, API routes |
| React 19        | UI library        | Component-based UI development            |
| TypeScript      | Type safety       | Catch errors before runtime               |
| Tailwind CSS 4  | Styling           | Utility-first CSS, fast to iterate        |
| ESLint          | Code linting      | Consistent code quality                   |
| Prettier        | Code formatting   | Consistent code style                     |
| Husky           | Git hooks         | Automated checks on commit                |
| Commitlint      | Commit messages   | Enforced conventional commit format       |
| Vitest          | Testing           | Fast, modern test runner                  |
| Testing Library | Component testing | Test components like users use them       |

## Documentation Index

| Document                                                   | Description                                       |
| ---------------------------------------------------------- | ------------------------------------------------- |
| [SETUP.md](SETUP.md)                                       | First-run setup guide (start here!)               |
| [CONTRIBUTING.md](CONTRIBUTING.md)                         | Team contribution workflow                        |
| [STRETCH_GOALS.md](STRETCH_GOALS.md)                       | Stretch goals — add-on mark component (~20%)      |
| [docs/typescript.md](docs/typescript.md)                   | TypeScript overview and configuration             |
| [docs/styling.md](docs/styling.md)                         | Tailwind CSS v4 and styling approach              |
| [docs/code-quality.md](docs/code-quality.md)               | ESLint, Prettier, Husky, conventional commits     |
| [docs/git-workflow.md](docs/git-workflow.md)               | Feature branching and git workflow                |
| [docs/branch-protection.md](docs/branch-protection.md)     | Branch protection rules and configuration         |
| [docs/contributing-guide.md](docs/contributing-guide.md)   | Detailed contribution guidelines                  |
| [docs/agile-process.md](docs/agile-process.md)             | Sprint structure and Agile workflow               |
| [docs/testing.md](docs/testing.md)                         | Testing with Vitest and Testing Library           |
| [docs/api-routes.md](docs/api-routes.md)                   | API Route Handlers guide                          |
| [docs/state-management.md](docs/state-management.md)       | State management options and patterns             |
| [docs/performance.md](docs/performance.md)                 | Performance optimization guide                    |
| [docs/accessibility.md](docs/accessibility.md)             | Web accessibility (a11y) guide                    |
| [docs/deployment-guide.md](docs/deployment-guide.md)       | Deploying to Vercel and other platforms           |
| [docs/ci-cd-requirements.md](docs/ci-cd-requirements.md)   | CI/CD pipeline explanation                        |
| [docs/devcontainer.md](docs/devcontainer.md)               | Dev Container setup guide                         |
| [docs/ai-usage-policy.md](docs/ai-usage-policy.md)         | AI tool policy and team agreement                 |
| [docs/ai-features.md](docs/ai-features.md)                 | Implementing AI features (OpenRouter + Vercel AI) |
| [docs/payments.md](docs/payments.md)                       | Payment integration guide (Stripe)                |
| [docs/admin-guide.md](docs/admin-guide.md)                 | Admin dashboard and RBAC guide                    |
| [docs/component-libraries.md](docs/component-libraries.md) | UI component library comparison                   |
| [docs/enhancements.md](docs/enhancements.md)               | Stretch goals quick reference                     |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for team workflow, branching conventions, and commit message format.

## License

This project is for educational purposes as part of a college-level web development course.
