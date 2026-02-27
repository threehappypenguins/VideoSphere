# Git Workflow Guide

## Feature Branching Strategy

This project uses a **feature branching** workflow. This means:

- `main` is the **protected** production branch — see [branch-protection.md](branch-protection.md) for the full list of rules
- **No one commits directly to main** — all changes go through pull requests
- Each feature, fix, or task gets its own branch
- Branches are merged via PRs with at least two code reviews

This workflow is an industry standard and a core part of this course.

## Branch Naming Conventions

Use these prefixes to keep branches organized:

| Prefix     | Use For               | Example                     |
| ---------- | --------------------- | --------------------------- |
| `feature/` | New features          | `feature/user-login`        |
| `fix/`     | Bug fixes             | `fix/navbar-mobile-menu`    |
| `docs/`    | Documentation changes | `docs/update-readme`        |
| `chore/`   | Maintenance tasks     | `chore/update-dependencies` |

### Rules

- Use lowercase letters and hyphens only
- Keep names short but descriptive
- Include the issue number if applicable: `feature/42-user-login`

## Step-by-Step Workflow

### 1. Start from an up-to-date main

```bash
git checkout main
git pull origin main
```

### 2. Create a new branch

```bash
git checkout -b feature/your-feature-name
```

### 3. Make your changes and commit

```bash
git add .
git commit -m "feat: add user login form"
```

> Remember: all commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) format. See `/docs/code-quality.md`.

### 4. Push your branch

```bash
git push origin feature/your-feature-name
```

### 5. Open a Pull Request

- Go to your repository on GitHub
- Click "Compare & pull request"
- Fill out the PR template
- **Include a close keyword linking to the relevant issue** in the PR description (e.g., `Closes #42`, `Fixes #15`, `Resolves #7`). A GitHub Actions workflow automatically verifies this — PRs missing a linked issue or close keyword will fail the `check-issue-and-keyword` check and cannot be merged.
- Request a review from a teammate

### 6. Address review feedback

If reviewers request changes:

```bash
# Make changes on your branch
git add .
git commit -m "fix: address review feedback"
git push origin feature/your-feature-name
```

### 7. Merge (after approval)

Once approved (2 approvals required) and CI passes, merge via GitHub's UI. Delete the branch after merging. Note that all review conversations must be resolved before merging is allowed — see [branch-protection.md](branch-protection.md) for details.

## Keeping Your Branch Up to Date

If `main` has been updated while you're working on your branch:

```bash
git checkout main
git pull origin main
git checkout feature/your-feature-name
git merge main
```

If there are merge conflicts, resolve them, then:

```bash
git add .
git commit -m "chore: resolve merge conflicts with main"
```

## Resolving Merge Conflicts

Merge conflicts happen when two branches modify the same lines. Git will mark conflicts like this:

```
<<<<<<< HEAD
your changes
=======
their changes
>>>>>>> main
```

To resolve:

1. Open the conflicting file
2. Choose which version to keep (or combine both)
3. Remove the `<<<<<<<`, `=======`, and `>>>>>>>` markers
4. Stage and commit the resolved file

## Visual Workflow

```
main ─────●──────────●──────────●──────────●──── (protected)
           \                    ↑           ↑
            \                  merge       merge
             \                  |           |
feature/login ●───●───●────────●           |
                                           |
feature/dashboard ───●───●───●─────────────●
```

## Useful Resources

- [Git Branching Basics](https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging)
- [GitHub Flow](https://docs.github.com/en/get-started/using-git/github-flow)
- [Resolving Merge Conflicts](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/addressing-merge-conflicts)
