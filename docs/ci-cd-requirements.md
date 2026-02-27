# CI/CD Requirements

## What Is CI/CD?

**Continuous Integration (CI)** is the practice of automatically running checks (linting, tests, builds) on every code change. **Continuous Deployment (CD)** extends this by automatically deploying code that passes all checks.

CI/CD catches problems early, ensures code quality, and reduces the risk of deploying broken code.

## What's Already Configured

This project includes a GitHub Actions CI workflow (`.github/workflows/ci.yml`) that runs on every push and pull request to `main`. It performs:

| Step       | Command             | What It Checks                       |
| ---------- | ------------------- | ------------------------------------ |
| ESLint     | `pnpm lint`         | Code quality and accessibility rules |
| Prettier   | `pnpm format:check` | Consistent code formatting           |
| TypeScript | `pnpm type-check`   | Type errors                          |
| Build      | `pnpm build`        | Project compiles successfully        |
| Tests      | `pnpm test run`     | All tests pass                       |

## Student Requirements

### ✅ Required

- **All CI checks must pass** before merging any PR to `main`
- **Never merge a PR with failing checks** — fix the issues first
- **Branch protection rules must be configured** (see `SETUP.md` and [branch-protection.md](branch-protection.md))

### 🎯 Enhancement Opportunities

These are optional improvements that demonstrate DevOps knowledge:

- **Automated deployment** — deploy to Vercel or Netlify on merge to `main`
- **PR preview deployments** — each PR gets its own preview URL
- **Dependabot** — automated dependency update PRs
- **Security scanning** — automated vulnerability detection
- **Automated changelog** — generate changelogs from conventional commits

See `STRETCH_GOALS.md` for the full list.

## Reading GitHub Actions Logs

When a CI check fails:

1. Go to the **Pull Request** on GitHub
2. Scroll down to the **Checks** section
3. Click on the failing check
4. Click **"Details"** to see the full log
5. Look for the red ❌ in the output — it will show the exact error

### Common CI Failures

| Error                 | Cause                   | Fix                              |
| --------------------- | ----------------------- | -------------------------------- |
| ESLint errors         | Code quality issues     | Run `pnpm lint:fix`              |
| Prettier check failed | Formatting issues       | Run `pnpm format`                |
| Type check failed     | TypeScript errors       | Fix the type errors in your code |
| Build failed          | Compilation error       | Check imports and syntax         |
| Tests failed          | Failing test assertions | Fix the test or the code         |

## Extending the Workflow

To add new steps to the CI workflow, edit `.github/workflows/ci.yml`:

```yaml
# Add a new step
- name: Run my custom check
  run: pnpm my-custom-script
```

## Useful Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Vercel Deployment Guide](https://vercel.com/docs/deployments/git)
- [GitHub Dependabot](https://docs.github.com/en/code-security/dependabot)
