# VideoSphere Documentation

VideoSphere is an open-source, self-hosted video distribution platform. Upload once to Cloudflare R2, then distribute to YouTube, Vimeo, Google Drive, SFTP, SMB backup, and more — with metadata drafts and AI-assisted descriptions.

Use these docs to run a production deployment, configure platform integrations, develop locally, and contribute safely.

## Start Here

- [Deployment Guide](/deployment-guide) — run the pre-built Docker image (Portainer or Compose)
- [Local Docker Testing](/local-docker-testing) — build and run the image on your machine
- [Daily Dev Workflow](/daily-dev-workflow) — local development checklist and pnpm scripts
- [MongoDB Data Model](/mongodb-data-model)
- [Code Quality](/code-quality)
- [Testing](/testing)

## Tech Stack

| Technology      | Purpose           |
| --------------- | ----------------- |
| Next.js 16      | React framework (App Router, API routes) |
| React 19        | UI components     |
| TypeScript      | Type safety       |
| Tailwind CSS 4  | Styling           |
| MongoDB 8       | Application data  |
| Cloudflare R2   | Temporary upload staging |
| Vitest          | Unit and component tests |
| ESLint + Prettier | Linting and formatting |

## Repository Layout

```
├── app/                    # Next.js App Router pages and API routes
├── components/             # Reusable React components
├── hooks/                  # Custom React hooks
├── lib/                    # Server utilities and shared logic
├── types/                  # TypeScript type definitions
├── docs/                   # This documentation site (VitePress)
├── __tests__/              # Test files
├── portainer-stack.yml     # Production stack template (pre-built image)
├── docker-compose.yml      # Local development stack (build from source)
└── Dockerfile              # Production container image
```

## Editing This Documentation

The docs site is built with [VitePress](https://vitepress.dev/) from files in the `docs/` folder.

| Command            | Purpose |
| ------------------ | ------- |
| `pnpm docs:dev`    | Local preview with live reload (regenerates API docs first) |
| `pnpm docs:build`  | Production build — run before merging docs changes |
| `pnpm docs:preview`| Preview the built output locally |
| `pnpm docs:api`    | Regenerate TypeDoc output at `docs/public/typedoc` |

Typical workflow: edit markdown → `pnpm docs:dev` while writing → `pnpm docs:build` before opening a PR.

API reference while previewing locally: `/api/` and `/typedoc/index.html`.

Docs deploy automatically to [videosphere.sarahpoulin.ca](https://videosphere.sarahpoulin.ca/) via [deploy-docs-pages.yml](https://github.com/threehappypenguins/VideoSphere/blob/main/.github/workflows/deploy-docs-pages.yml) on pushes to `main`.
