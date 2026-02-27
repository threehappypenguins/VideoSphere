# Contributing Guide

## Team Structure

- **1 Admin** — has full control of the repository settings (branch protection, access management)
- **Remaining members are Maintainers** — can push branches, create PRs, and review code

The Admin is decided during initial setup (see `SETUP.md`). For details on the branch protection rules the Admin configures, see [docs/branch-protection.md](branch-protection.md).

## Workflow Summary

1. Pick an issue from the project board
2. Create a branch following the naming convention (see `/docs/git-workflow.md`)
3. Make your changes with clear, conventional commits
4. Push your branch and open a PR
5. Request review from at least one teammate
6. Address feedback and get approval
7. Merge when CI passes and PR is approved
8. Delete the branch

## Conventional Commits

All commits **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) format. This is enforced by commitlint via a git hook — commits that don't follow the format will be rejected.

### Format

```
type: short description

[optional body]
[optional footer]
```

### Types with Examples

| Type       | When to Use                      | Example                               |
| ---------- | -------------------------------- | ------------------------------------- |
| `feat`     | New feature                      | `feat: add user registration form`    |
| `fix`      | Bug fix                          | `fix: resolve login redirect issue`   |
| `docs`     | Documentation only               | `docs: add API routes documentation`  |
| `style`    | Formatting, semicolons, etc.     | `style: fix inconsistent indentation` |
| `refactor` | Code change that doesn't fix/add | `refactor: extract validation logic`  |
| `test`     | Adding or updating tests         | `test: add unit tests for utils`      |
| `chore`    | Maintenance, deps, config        | `chore: update eslint configuration`  |
| `perf`     | Performance improvement          | `perf: optimize image loading`        |
| `ci`       | CI/CD changes                    | `ci: add deployment step to workflow` |
| `build`    | Build system changes             | `build: update Next.js to v15`        |
| `revert`   | Revert a previous commit         | `revert: undo login form changes`     |

## Pull Request Process

1. Fill out the PR template completely
2. Link the related issue using a **close keyword** in the PR description (e.g., `Closes #123`, `Fixes #42`, `Resolves #7`). This is **enforced by a GitHub Actions check** — PRs without a linked issue and close keyword will fail the `check-issue-and-keyword` status check and cannot be merged.
3. Ensure all CI checks pass (lint, format, type-check, build, test, linked issue check)
4. Request review from at least one teammate
5. Respond to review feedback promptly
6. Merge only after approval

### What Makes a Good PR

- **Small and focused** — one feature or fix per PR
- **Clear description** — explain what and why, not just what changed
- **Screenshots** — include before/after for UI changes
- **Tests** — add tests for new functionality when possible

## Code Review Expectations

When reviewing a teammate's PR:

- Be respectful and constructive
- Focus on correctness, readability, and maintainability
- Check that the code follows project conventions
- Verify the PR description matches the actual changes
- Test locally if the change is significant

## Definition of Done

A task is "done" when:

- [ ] Code compiles without errors
- [ ] All CI checks pass
- [ ] Code has been reviewed and approved
- [ ] Any new UI is responsive (mobile-first)
- [ ] Relevant documentation has been updated
- [ ] The feature works as described in the acceptance criteria

## AI Usage

AI tools like GitHub Copilot are encouraged for coding assistance. However, there is a critical rule:

> ⚠️ **AI agents must NEVER perform any git operations.** All commits, pushes, merges, and PR creation must be done by a human team member.

See [/docs/ai-usage-policy.md](/docs/ai-usage-policy.md) for the full policy.
