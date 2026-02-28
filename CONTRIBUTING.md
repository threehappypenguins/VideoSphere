# Contributing Guide

## Branching Strategy

**Feature branching is mandated.** No direct commits to `main` are allowed.

Every change must go through a pull request that is reviewed and approved before merging.

### Branch Naming Convention

```
type/short-description
```

| Type        | Example                     | Use Case                 |
| ----------- | --------------------------- | ------------------------ |
| `feat/`     | `feat/user-login`           | New feature              |
| `fix/`      | `fix/navbar-mobile-menu`    | Bug fix                  |
| `docs/`     | `docs/update-readme`        | Documentation changes    |
| `refactor/` | `refactor/simplify-auth`    | Code refactoring         |
| `test/`     | `test/add-button-tests`     | Adding or updating tests |
| `chore/`    | `chore/update-dependencies` | Maintenance tasks        |
| `style/`    | `style/fix-indentation`     | Formatting only          |

### Workflow

```bash
# 1. Start from an up-to-date main branch
git checkout main
git pull origin main

# 2. Create your feature branch
git checkout -b feat/your-feature-name

# 3. Make changes and commit (see commit format below)
git add .
git commit -m "feat: add user login form"

# 4. Push your branch
git push origin feat/your-feature-name

# 5. Open a Pull Request on GitHub

# 6. After PR is approved and merged, clean up
git checkout main
git pull origin main
git branch -d feat/your-feature-name
```

## Commit Message Format

All commit messages are **enforced via commitlint**. Messages that don't follow this format will be rejected.

```
type: description
```

### Valid Types

| Type       | Description                          | Example                            |
| ---------- | ------------------------------------ | ---------------------------------- |
| `feat`     | New feature                          | `feat: add search functionality`   |
| `fix`      | Bug fix                              | `fix: correct date formatting`     |
| `docs`     | Documentation changes                | `docs: update deployment guide`    |
| `style`    | Formatting only (no logic change)    | `style: fix indentation in utils`  |
| `refactor` | Code reorganization (no feature/fix) | `refactor: simplify auth logic`    |
| `test`     | Adding or updating tests             | `test: add button component tests` |
| `chore`    | Maintenance tasks                    | `chore: update dependencies`       |
| `perf`     | Performance improvement              | `perf: lazy load dashboard charts` |
| `ci`       | CI/CD changes                        | `ci: add preview deployment step`  |
| `build`    | Build system changes                 | `build: upgrade Tailwind to v4`    |
| `revert`   | Revert a previous commit             | `revert: undo auth flow changes`   |

### Rules

- Type must be lowercase
- Description must start with lowercase
- No period at the end
- Keep the description concise but meaningful

## Pull Request Process

1. **Fill out the PR template** — it's provided automatically when you open a PR
2. **Link related issues with a close keyword** — use `Closes #12`, `Fixes #12`, or `Resolves #12` in the PR description. A GitHub Actions check (`check-issue-and-keyword`) **automatically enforces** that every PR references an issue and includes a close keyword. PRs that fail this check cannot be merged.
3. **Keep PRs focused** — one feature or fix per PR
4. **Ensure CI passes** — all checks must be green before merge (including the linked issue check)
5. **Request review** from at least 1 team member
6. **Address review feedback** — make requested changes and push updates
7. **Merge** after approval — prefer "Squash and merge" for clean history

## Code Review Expectations

When reviewing a teammate's PR:

- **Test the changes** — pull the branch and verify it works
- **Check for edge cases** — what happens with empty data? Invalid input?
- **Review the code** — is it readable? Does it follow project conventions?
- **Be constructive** — explain why you're requesting changes
- **Approve quickly** — don't block teammates unnecessarily

Minimum requirement: **1 approving review** before merge.

---

## ⚠️ AI Git Operations — ABSOLUTE RULE

> **AI agents must NEVER perform any git operations of any kind.**
>
> This includes: commits, pushes, pulls, merges, branch creation, PR creation, or any other GitHub activity.
>
> Every commit must be performed by a **human team member** using standard git commands.
>
> **Any evidence that an AI agent performed git or GitHub operations will result in a team grade penalty. There are no exceptions.**

AI writes code → **You** review it → **You** commit it → **You** push it.

See [docs/ai-usage-policy.md](docs/ai-usage-policy.md) for the complete policy.

---

## Quick Reference

```bash
# Check if your code passes all checks before committing
pnpm lint && pnpm format:check && pnpm type-check

# Fix lint and formatting issues
pnpm lint:fix && pnpm format

# Run tests
pnpm test
```

## Additional Resources

- [docs/git-workflow.md](docs/git-workflow.md) — detailed git workflow guide
- [docs/contributing-guide.md](docs/contributing-guide.md) — extended contribution guidelines
- [docs/code-quality.md](docs/code-quality.md) — code quality tools reference
- [docs/agile-process.md](docs/agile-process.md) — sprint and Agile process
