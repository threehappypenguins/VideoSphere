# Daily Development Workflow

Use this checklist **before you start work** and **when you finish work** so your environment is ready and your changes pass CI.

For the full development hub (setup, API docs, contributor tooling), see [Development & Contributing](/contributing).

For first-run setup after cloning the repository (environment variables, MongoDB, admin account), see [SETUP.md](https://github.com/threehappypenguins/VideoSphere/blob/main/SETUP.md) in the repository root.

## Prerequisites

| Tool    | Version  | Check Command    |
| ------- | -------- | ---------------- |
| Node.js | ≥ 24.0.0 | `node --version` |
| pnpm    | ≥ 10.0.0 | `pnpm --version` |
| Git     | Latest   | `git --version`  |

```bash
git clone https://github.com/threehappypenguins/VideoSphere.git
cd VideoSphere
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:9624` (or your LAN host IP on port 9624).

---

## Before you start development

Do these at the beginning of each development session.

### Update `dev` and create a branch

Always start from the latest `dev` so you don’t base your work on outdated code.

```bash
git checkout dev
git pull origin dev
git checkout -b feature/your-feature-name
```

Use a branch name that matches your task (e.g. `feature/draft-form`, `fix/login-error`).

---

## When you finish work (before you push or open a PR)

Run these commands as recommended pre-commit and pre-PR checks. Fix any failures before pushing. (CI currently runs lint, format check, and type-check; running format, lint, test, and build locally catches more issues before you open a PR.)

```bash
pnpm format
pnpm lint
pnpm test run
pnpm build
```

| Command           | What it does                                      |
| ----------------- | -------------------------------------------------- |
| `pnpm format`     | Formats code with Prettier (fixes style).          |
| `pnpm lint`       | Runs ESLint (code quality and accessibility).      |
| `pnpm test run`   | Runs tests once (no watch mode).                   |
| `pnpm build`      | Builds the app (catches type and build errors).   |

**Order:** Run them in this order. Fix any errors before moving to the next. If everything passes, your branch is ready to push and open a PR against `dev`.

---

## Quick reference

**Start of day:**

1. `git checkout dev && git pull origin dev`
2. `git checkout -b feature/your-branch-name`
3. `pnpm dev`

**End of work / before push:**

1. `pnpm format`
2. `pnpm lint`
3. `pnpm test run`
4. `pnpm build`

Then commit (if you haven’t already), push, and open a PR against `dev`.

---

## pnpm Scripts

| Script               | Command                 | Description                     |
| -------------------- | ----------------------- | ------------------------------- |
| `pnpm dev`           | `next dev --webpack`    | Start dev server on port 9624   |
| `pnpm build`         | `next build`            | Create production build         |
| `pnpm start`         | `next start`            | Start production server         |
| `pnpm lint`          | `eslint .`              | Run ESLint                      |
| `pnpm lint:fix`      | `eslint . --fix`        | Run ESLint and auto-fix issues  |
| `pnpm format`        | `prettier --write .`    | Format all files with Prettier  |
| `pnpm format:check`  | `prettier --check .`    | Check formatting (used in CI)   |
| `pnpm type-check`    | `tsc --noEmit`          | Check TypeScript types          |
| `pnpm test`          | `vitest`                | Run tests in watch mode         |
| `pnpm test run`      | `vitest run`            | Run tests once                  |
| `pnpm test:ui`       | `vitest --ui`           | Run tests with browser UI       |
| `pnpm test:coverage` | `vitest run --coverage` | Run tests with coverage report  |

## Local Docker (build from source)

```bash
docker compose --env-file .env.local up -d --build
```

For production with a pre-built image, see the [Deployment Guide](/deployment-guide).

---

## Troubleshooting

### `tsc` errors in `.next/types/validator.ts` after deleting routes

`tsconfig.json` includes Next.js generated types under `.next/types/`. If you remove or rename App Router pages, a stale `.next` folder can still reference old paths until Next regenerates them.

```bash
rm -rf .next
pnpm build   # or `pnpm dev` for a shorter regen during active work
pnpm type-check
```

Fresh clones and CI do not hit this (no `.next` yet). It only affects local trees that had run `dev` or `build` before the route change.
