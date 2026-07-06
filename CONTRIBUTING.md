# Contributing Guide

## Pre-commit Checks

Commits run a Husky `pre-commit` hook that executes these commands:

```bash
pnpm type-check
pnpm test -- --run
```

If either command fails, the commit is blocked. Run the same commands manually before committing if you want to check the result first.

Emergency bypass (use sparingly):

```bash
git commit --no-verify -m "your message"
```

## Branching Strategy

Use feature branches when a change is large or you want a pull request for CI. Direct commits to `main` are fine for solo maintenance when you have run the checks locally.

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

# 6. After the PR is merged, clean up
git checkout main
git pull origin main
git branch -d feat/your-feature-name
```

## Commit messages

Write clear, descriptive commit messages. Prefixes like `feat:`, `fix:`, and `docs:` are fine when they help, but no specific format is enforced.

### Skipping container image publish

Every push to `main` runs [publish.yml](.github/workflows/publish.yml) and rebuilds the multi-arch Docker image on GHCR (and Docker Hub when configured). To push changes **without** triggering that build, include `[skip publish]` anywhere in the commit message:

```bash
git commit -m "docs: update portainer notes [skip publish]"
```

Omit `[skip publish]` when `Dockerfile`, app code, or anything that should ship a new image has changed.

### Verifying multi-arch image builds

Before pushing Dockerfile changes to `main`, confirm both platforms build successfully (same as CI):

```bash
docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile .
```

Omit `--load` and `--push` to discard images after a successful build. Cross-arch builds on amd64 require QEMU (`qemu-user-static` and binfmt).

To **build and run** the image locally (amd64 smoke test, OAuth, production server), see [docs/local-docker-testing.md](docs/local-docker-testing.md).

## Pull Request Process

1. **Open a PR** against `main` with a clear title and description
2. **Keep PRs focused** — one feature or fix per PR when possible
3. **Ensure CI passes** — lint, type-check, build, and tests must all be green
4. **Merge when ready** — squash or merge commit, whichever you prefer

## Quick Reference

```bash
# Check if your code passes all checks before committing
pnpm lint && pnpm format:check && pnpm type-check

# Run the same checks enforced before commit
pnpm type-check
pnpm test -- --run

# Fix lint and formatting issues
pnpm lint:fix && pnpm format

# Run tests
pnpm test
```

## Additional Resources

- [docs/code-quality.md](docs/code-quality.md) — code quality tools reference
