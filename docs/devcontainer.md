# Dev Container Guide

## What Is a Dev Container?

A **development container** (dev container) is a pre-configured development environment that runs inside a Docker container. It ensures every team member has the exact same tools, extensions, and settings — regardless of their local machine setup.

Think of it as a "portable development environment" that travels with your repository.

## Is It Required?

**No.** The dev container in this project is **completely optional**. The project works perfectly fine running directly on your machine with Node.js and pnpm installed. The dev container is provided as a convenience for teams who want guaranteed environment consistency.

## Prerequisites

To use the dev container, you need:

1. **Docker Desktop** — [Download here](https://www.docker.com/products/docker-desktop/)
2. **VS Code** — [Download here](https://code.visualstudio.com/)
3. **Dev Containers extension** — Install from the VS Code Extensions panel (search for "Dev Containers" by Microsoft)

## How to Use It

1. Make sure Docker Desktop is running
2. Open the project folder in VS Code
3. VS Code should detect the dev container config and prompt you:
   > "Reopen in Container?"
4. Click **"Reopen in Container"**
5. Wait for the container to build (first time may take a few minutes)
6. You're now developing inside the container with all tools pre-configured

Alternatively, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and select:

> **Dev Containers: Reopen in Container**

## What's Included

The dev container comes pre-configured with:

### VS Code Extensions

| Extension | Purpose |
|-----------|---------|
| **ESLint** | Real-time linting feedback inline as you type |
| **Prettier** | Automatic code formatting on save |
| **Error Lens** | Inline error and warning highlighting next to the offending line |
| **Tailwind CSS IntelliSense** | Autocomplete, hover previews, and linting for Tailwind classes |
| **Auto Rename Tag** | Automatically renames the matching HTML/JSX closing tag |
| **Path IntelliSense** | Autocomplete for file paths in import statements |
| **Vitest Explorer** | Run and view Vitest tests from the VS Code sidebar |
| **GitLens** | Enhanced Git history, blame annotations, and branch visualisation |
| **GitHub Pull Requests** | Create, review, and merge pull requests directly in VS Code |
| **Conventional Commits** | Guided commit message builder following conventional commit format |
| **GitHub Copilot** | AI coding assistant |
| **GitHub Copilot Chat** | Conversational AI assistance |
| **Code Spell Checker** | Catches typos in code and comments |
| **Material Icon Theme** | File type icons in the Explorer panel |

### Editor Settings

These settings are pre-applied so the entire team works consistently from day one:

- **Format on save** — Prettier runs automatically every time you save a file
- **ESLint auto-fix on save** — fixable lint issues are corrected on save
- **Ruler at column 100** — visual guide matching the Prettier `printWidth`
- **2-space indentation** — matches Prettier config
- **Unix line endings (`\n`)** — prevents noisy diffs when teammates mix Windows and macOS
- **Trim trailing whitespace** — automatically removed on save
- **Project TypeScript version** — uses the project's own `typescript` package, not VS Code's built-in one
- **Build output excluded from search** — `.next/`, `node_modules/`, and `coverage/` are hidden from search results

### Runtime

- **Node.js 20** (LTS) — matches the project's `.nvmrc` and `engines` field
- **pnpm** — enabled via Corepack; `pnpm install` runs automatically after container creation
- **Husky git hooks** — set up automatically as part of `pnpm install` (via the `prepare` script)
- **Port 3000 forwarded** — labelled "Next.js Dev Server" in the Ports panel

## Troubleshooting

### Container won't start

- Make sure Docker Desktop is running
- Try rebuilding: Command Palette → "Dev Containers: Rebuild Container"

### Extensions not loading

- Reload the window: Command Palette → "Developer: Reload Window"

### Slow performance

- Increase Docker Desktop memory allocation (Settings → Resources)
- On macOS/Windows, ensure you're using the recommended file sharing method

### Can't access localhost:3000

- Make sure the Next.js dev server is running (`pnpm dev`)
- Check that port 3000 is forwarded in the Ports panel (bottom of VS Code)

## Benefits for Teams

- **No "works on my machine" problems** — everyone runs the same environment
- **Instant onboarding** — new team members get started in minutes
- **Consistent tooling** — same extensions, same settings, same Node version
- **Codespaces compatible** — works with GitHub Codespaces for cloud development
