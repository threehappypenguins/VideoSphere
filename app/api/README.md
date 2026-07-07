# API Routes

This directory contains Next.js App Router route handlers (`route.ts` files).

## Route Domains

| Path prefix | Purpose |
| ----------- | ------- |
| `/api/health` | Health check (`GET`) |
| `/api/auth/*` | Login, session, profile, OAuth, TOTP, invites |
| `/api/drafts/*` | Draft CRUD, labels, thumbnails, YouTube import per draft |
| `/api/uploads/*` | Presign, complete, distribute, upload jobs |
| `/api/youtube-import/*` | Resolve URL, preview, start/run import jobs |
| `/api/platforms/*` | Connect/callback flows and platform metadata helpers |
| `/api/livestreams/*` | Livestream CRUD, schedule, thumbnails |
| `/api/ai/generate-metadata` | AI metadata generation (OpenRouter) |
| `/api/admin/*` | Users, invites, stats |

For handler patterns and HTTP conventions, see [docs/api-routes.md](/docs/api-routes.md).

Generated TypeDoc output for exported symbols: run `pnpm docs:api`, then open `/typedoc/index.html` in the docs site.
