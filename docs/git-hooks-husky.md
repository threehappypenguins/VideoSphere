# Git Hooks with Husky

This project uses [Husky](https://typicode.github.io/husky) to enforce code quality and commit message standards automatically via Git hooks.

---

## Overview

Husky is configured to run two hooks:

| Hook | Trigger | Tool |
|------|---------|------|
| `pre-commit` | Before every commit | `lint-staged` |
| `commit-msg` | After writing a commit message | `commitlint` |

---

## `pre-commit` Hook

Runs **lint-staged**, which only processes files that are staged for commit.

### Rules

| File Pattern | Actions |
|-------------|---------|
| `*.{ts,tsx}` | `eslint --fix` → `prettier --write` |
| `*.{json,md,css}` | `prettier --write` |

### Behaviour
- ESLint attempts to **auto-fix** any fixable issues before committing.
- Prettier **auto-formats** staged files.
- If ESLint encounters an error it **cannot auto-fix**, the commit is **blocked** and the staged files are reverted to their original state.

### Example Output (success)
```
✔ Backed up original state in git stash
✔ Running tasks for staged files...
✔ Applying modifications from tasks...
✔ Cleaning up temporary files...
```

### Example Output (failure)
```
✖ eslint --fix:

/workspaces/Project-NextJS-StarterTemplate/app/example.ts
  1:10  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

✖ 1 problem (1 error, 0 warnings)

husky - pre-commit script failed (code 1)
```

---

## `commit-msg` Hook

Runs **commitlint** to enforce the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Required Format

```
<type>(<optional scope>): <subject>
```

### Allowed Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes only |
| `style` | Code style changes (formatting, missing semicolons, etc.) |
| `refactor` | Code changes that neither fix a bug nor add a feature |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks, dependency updates, tooling |
| `perf` | Performance improvements |
| `ci` | CI/CD configuration changes |
| `build` | Build system or external dependency changes |
| `revert` | Reverts a previous commit |

### Valid Examples

```
feat: add user authentication
fix: resolve redirect loop on login
docs: update API route reference
chore: upgrade eslint to v9
feat(auth): add OAuth2 support
fix(api): handle null response from payment gateway
```

### Example Output (failure)

```
⧗   input: bad commit message
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]

✖   found 2 problems, 0 warnings
ⓘ   Get help: https://github.com/conventional-changelog/commitlint/#what-is-commitlint

──────────────────────────────────────────
 ✖  Invalid commit message format
──────────────────────────────────────────

 Required format:  <type>(<scope>): <subject>
 Example:          feat(auth): add login page

 Allowed types:
   feat      A new feature
   fix       A bug fix
   docs      Documentation changes
   style     Formatting, missing semicolons, etc.
   refactor  Code restructuring without feature/fix
   test      Adding or updating tests
   chore     Maintenance, dependencies, tooling
   perf      Performance improvements
   ci        CI/CD configuration
   build     Build system changes
   revert    Revert a previous commit

 Scope is optional but recommended, e.g.:
   feat(auth): ...
   fix(api): ...
   chore(deps): ...
──────────────────────────────────────────

husky - commit-msg script failed (code 1)
```

---

## Bypassing Hooks (Emergency Use Only)

In exceptional circumstances, hooks can be bypassed using the `--no-verify` flag:

```bash
git commit --no-verify -m "your message"
```

> ⚠️ **This should be avoided.** Bypassing hooks risks committing unformatted, unlinted, or non-compliant code. Only use in genuine emergencies and follow up with a corrective commit.

---

## Related Docs

- [Code Quality](./code-quality.md)
- [Contributing Guide](./contributing-guide.md)
- [Git Workflow](./git-workflow.md)