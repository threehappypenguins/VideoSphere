# Code Quality Guide

## ESLint

[ESLint](https://eslint.org/) is a static analysis tool that finds and fixes problems in your code. It catches bugs, enforces coding standards, and improves consistency across your team.

### What's Configured

This project uses:

- **`eslint-config-next`** — Next.js recommended rules including Core Web Vitals
- **`eslint-plugin-jsx-a11y`** — accessibility rules that catch common a11y issues in JSX

### Running ESLint

```bash
pnpm lint        # Check for issues
pnpm lint:fix    # Automatically fix issues where possible
```

### What `eslint-plugin-jsx-a11y` Adds

This plugin catches accessibility mistakes like:

- Missing `alt` text on images
- Non-interactive elements with click handlers (should be buttons)
- Missing `aria-label` on icon-only buttons
- Form inputs without associated labels

## Prettier

[Prettier](https://prettier.io/) is an opinionated code formatter. It enforces a consistent style across all files — no more debating tabs vs spaces or where to put semicolons.

### Configured Rules

| Rule            | Value  | What It Does                       |
| --------------- | ------ | ---------------------------------- |
| `semi`          | `true` | Always use semicolons              |
| `singleQuote`   | `true` | Use single quotes for strings      |
| `tabWidth`      | `2`    | 2 spaces for indentation           |
| `trailingComma` | `es5`  | Trailing commas where valid in ES5 |
| `printWidth`    | `100`  | Wrap lines at 100 characters       |

### Running Prettier

```bash
pnpm format        # Format all files
pnpm format:check  # Check if files are formatted (used in CI)
```

## Husky & lint-staged

[Husky](https://typicode.github.io/husky/) manages git hooks — scripts that run automatically at certain points in the git workflow.

[lint-staged](https://github.com/lint-staged/lint-staged) runs linters only on staged files (files you're about to commit), making pre-commit checks fast.

### What Happens on Commit

When you run `git commit`:

1. **`pre-commit` hook** runs lint-staged:
   - ESLint checks and fixes `.ts` and `.tsx` files
   - Prettier formats all staged files
2. **`commit-msg` hook** runs commitlint:
   - Validates your commit message follows Conventional Commits format

If either check fails, the commit is **blocked**. Fix the issues and try again.

## Conventional Commits

All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
type: description
```

### All Valid Types

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

### When a Commit Is Blocked

If your commit is rejected:

1. **Linting failure**: Run `pnpm lint:fix` and `pnpm format`, then re-stage and commit
2. **Commit message failure**: Rewrite your message following the format above
3. **Tip**: Use `git commit -m "feat: your description"` to ensure the format is correct

## Extending the Configuration

### Adding ESLint Rules

Edit `eslint.config.mjs` to add or override rules:

```javascript
{
  rules: {
    'no-console': 'warn', // Warn on console.log usage
  },
}
```

### Changing Prettier Rules

Edit `.prettierrc` to adjust formatting preferences. See [Prettier Options](https://prettier.io/docs/en/options) for all available options.

## Useful Resources

- [ESLint Documentation](https://eslint.org/docs/latest/)
- [Prettier Documentation](https://prettier.io/docs/en/)
- [Conventional Commits Specification](https://www.conventionalcommits.org/)
- [Husky Documentation](https://typicode.github.io/husky/)
