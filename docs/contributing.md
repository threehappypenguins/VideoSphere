# Development & Contributing

This guide is for developers who clone the repository, run VideoSphere locally, change code, or update documentation.

If you only want to **run VideoSphere in production** (Docker, Portainer, homelab), start with the [Deployment Guide](/deployment-guide) on the [home page](/) instead.

## First-time local setup

1. Clone the repo and install dependencies — see [SETUP.md](https://github.com/threehappypenguins/VideoSphere/blob/main/SETUP.md) in the repository root (environment variables, MongoDB, first admin account).
2. Follow the [Daily Dev Workflow](/daily-dev-workflow) checklist before and after each coding session.

## Before you open a pull request

| Step | Doc |
| ---- | --- |
| Format, lint, test, build | [Daily Dev Workflow](/daily-dev-workflow) |
| ESLint, Prettier, export doc comments | [Code Quality](/code-quality) |
| Vitest and accessibility tests | [Testing](/testing) |

## Codebase reference

| Topic | Doc |
| ----- | --- |
| Uploads UI, livestreams, YouTube import, connections | [Uploads, Livestreams & Distribution](/uploads-and-distribution) |
| MongoDB collections and platforms | [MongoDB Data Model](/mongodb-data-model) |
| Draft `document` JSON and manual upload testing | [Draft Document & Upload Testing](/draft-document-and-upload-testing) |
| Next.js route handlers | [API Routes Guide](/api-routes) |
| Generated symbol reference | [API Reference](/api/) and [TypeDoc](/typedoc/index.html) |
| TypeScript conventions | [TypeScript](/typescript) |
| Accessibility expectations | [Accessibility](/accessibility) |
| Next.js performance patterns | [Performance](/performance) |

## Docker and production parity

- [Local Docker Testing](/local-docker-testing) — build the production image from source and smoke-test with your `.env.local` before merging Dockerfile changes.

## Contributor tooling (optional)

| Tool | Doc |
| ---- | --- |
| VS Code Dev Container | [Dev Container](/devcontainer) |
| Context7 MCP (library docs in the IDE) | [Context7 MCP Setup](/context7-setup) |
| Figma MCP (design tokens in Copilot) | [Figma MCP Setup](/figma-mcp-setup) |

## Editing this documentation site

The docs are built with [VitePress](https://vitepress.dev/) from the `docs/` folder.

| Command | Purpose |
| ------- | ------- |
| `pnpm docs:dev` | Local preview with live reload (regenerates API docs first) |
| `pnpm docs:build` | Production build — run before merging docs changes |
| `pnpm docs:preview` | Preview the built output locally |
| `pnpm docs:api` | Regenerate TypeDoc output at `docs/public/typedoc` |

Typical workflow: edit markdown → `pnpm docs:dev` while writing → `pnpm docs:build` before opening a PR against `dev`.

Docs deploy automatically to [videosphere.sarahpoulin.ca](https://videosphere.sarahpoulin.ca/) on pushes to `main`.
