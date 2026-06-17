# VideoSphere

> **Upload once, distribute everywhere.** A Next.js app for uploading videos to Cloudflare R2 and distributing them to YouTube, Vimeo, and optional Google Drive, SFTP, or SMB backup — with metadata drafts and self-hostable Docker deployment.

**👉 Start here: [SETUP.md](SETUP.md)** — Complete the first-run setup before doing anything else.

**📋 Daily workflow:** [docs/daily-dev-workflow.md](docs/daily-dev-workflow.md) — Before you start (Docker, MongoDB, branch from main) and before you push (format, lint, test, build).

**📝 Draft JSON & manual uploads:** [docs/draft-document-and-upload-testing.md](docs/draft-document-and-upload-testing.md) — `document` on `drafts` / `platform_uploads`, field reference, presign → R2 → complete → distribute.

## Prerequisites

| Tool    | Version  | Check Command    |
| ------- | -------- | ---------------- |
| Node.js | ≥ 24.0.0 | `node --version` |
| pnpm    | ≥ 10.0.0 | `pnpm --version` |
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
│   ├── (marketing)/        # Public pages: landing
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

## Documentation Site (VitePress)

This repo includes a VitePress docs site using files in the [docs](docs) folder.

### Docs Commands

- `pnpm docs:api`
  - Generates API docs from JSDoc/TypeDoc comments using TypeDoc.
  - Writes output to `docs/public/typedoc` and is run automatically by `docs:dev` and `docs:build`.
- `pnpm docs:dev`
  - Use during documentation writing and editing.
  - Starts a local docs server with live reload.
- `pnpm docs:build`
  - Use before opening a docs PR or merging docs changes.
  - Verifies the docs compile for production.
- `pnpm docs:preview`
  - Use after `docs:build` when you want to validate the exact built output locally.

Typical docs workflow:

1. Edit docs files.
2. Run `pnpm docs:dev` while writing.
3. Run `pnpm docs:build` before commit/PR.
4. Optionally run `pnpm docs:preview` for a final check.

API docs location while previewing:

- API landing page: /api/
- Generated TypeDoc site: /typedoc/index.html

### GitHub Pages Deployment

Docs deploy automatically through GitHub Actions using [deploy-docs-pages.yml](.github/workflows/deploy-docs-pages.yml).

Required repository settings:

1. Open GitHub Settings > Pages.
2. Set Source to GitHub Actions.
3. Do not use the Next.js Configure template for docs deployment.
	 - That template is a starter workflow for app deployment.
	 - This repo already has a dedicated docs workflow for VitePress.

After pushing to main, check the Actions run named Deploy Docs To GitHub Pages.

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
| [docs/daily-dev-workflow.md](docs/daily-dev-workflow.md)   | Before/after development checklist (Docker, branch, format, lint, test, build) |
| [CONTRIBUTING.md](CONTRIBUTING.md)                         | Team contribution workflow                        |
| [docs/typescript.md](docs/typescript.md)                   | TypeScript overview and configuration             |
| [docs/code-quality.md](docs/code-quality.md)               | ESLint, Prettier, Husky, conventional commits     |
| [docs/testing.md](docs/testing.md)                         | Testing with Vitest and Testing Library           |
| [docs/api-routes.md](docs/api-routes.md)                   | API Route Handlers guide                          |
| [docs/state-management.md](docs/state-management.md)       | State management options and patterns             |
| [docs/performance.md](docs/performance.md)                 | Performance optimization guide                    |
| [docs/accessibility.md](docs/accessibility.md)             | Web accessibility (a11y) guide                    |
| [docs/deployment-guide.md](docs/deployment-guide.md)       | Deploying to Vercel and other platforms           |
| [docs/password-recovery.md](docs/password-recovery.md)     | Admin/user password recovery without email        |
| [docs/devcontainer.md](docs/devcontainer.md)               | Dev Container setup guide                         |
| [docs/ai-features.md](docs/ai-features.md)                 | Implementing AI features (OpenRouter + Vercel AI) |
| [docs/component-libraries.md](docs/component-libraries.md) | UI component library comparison                   |

## Docker

- **Run the app in a container:** `docker build -t videosphere .` then `docker run --name videosphere -p 3000:3000 --env-file .env.local videosphere`.
- **SMB backup from Docker (Linux):** add `--network host` so the container can reach NAS/Windows shares on your LAN (see [SETUP.md](SETUP.md#smb-backup-docker--lan-reachability)). Published port mappings such as `-p 3000:3000` are ignored in host networking mode—the app listens on the host’s port 3000 directly. On macOS/Windows Docker Desktop, host networking does not expose the physical LAN the same way.
- **Password recovery (no SMTP):** see [docs/password-recovery.md](docs/password-recovery.md) for CLI password reset, log-based forgot-password, and admin reset links.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for team workflow, branching conventions, and commit message format.

## License

This project is open source.
