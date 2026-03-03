# Daily Development Workflow

Use this checklist **before you start work** and **when you finish work** so your environment is ready and your changes pass CI.

---

## Before you start development

Do these at the beginning of each development session.

### Update `main` and create a branch

Always start from the latest `main` so you don’t base your work on outdated code.

```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

Use a branch name that matches your task (e.g. `feature/draft-form`, `fix/login-error`). See [git-workflow.md](git-workflow.md) for naming conventions.

---

## When you finish work (before you push or open a PR)

Run these commands as recommended pre-push checks. Fix any failures before pushing. (CI currently runs lint, format check, and type-check; running format, lint, test, and build locally catches more issues before you open a PR.)

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

**Order:** Run them in this order. Fix any errors before moving to the next. If everything passes, your branch is ready to push and open a PR.

---

## Quick reference

**Start of day:**

1. `git checkout main && git pull origin main`
2. `git checkout -b feature/your-branch-name`
3. `pnpm dev`

**End of work / before push:**

1. `pnpm format`
2. `pnpm lint`
3. `pnpm test run`
4. `pnpm build`

Then commit (if you haven’t already), push, and open a PR. See [git-workflow.md](git-workflow.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) for the full workflow.
