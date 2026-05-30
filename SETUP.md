# First-Run Setup Guide

Complete these steps after cloning the repository. This guide is MongoDB-first and self-hostable.

---

## 1. Clone and Install

```bash
git clone https://github.com/NSCC-ITC-Winter2026-PROG5016-700-MCa/project-videosphere-team.git
cd project-videosphere-team
pnpm install
```

## 2. Configure Environment Variables

```bash
cp .env.example .env.local
```

Required minimum values in `.env.local`:

- `MONGODB_URI`
- `MONGO_ROOT_PASSWORD`
- `JWT_SECRET`
- `JWT_SESSION_COOKIE_NAME`
- `TOKEN_ENCRYPTION_KEY`

When running MongoDB with Docker Compose, `MONGO_ROOT_PASSWORD` is required by `docker-compose.yml`.
Use the same password value in both `MONGO_ROOT_PASSWORD` and `MONGODB_URI`.

If you use Google login and platform connections, also set:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `VIMEO_CLIENT_ID`
- `VIMEO_CLIENT_SECRET`
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`

## 3. Start MongoDB (Docker Compose)

If you have not set it yet, add this to `.env.local` before starting Mongo:

```bash
MONGO_ROOT_PASSWORD=change_me
```

```bash
docker compose up -d mongo
```

This project ships a self-contained compose stack with `mongo:8` and persistent storage.

## 4. Start the App

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## 5. Quick Verification

Use this checklist:

- App loads at [http://localhost:3000](http://localhost:3000)
- Register works with email/password
- Login issues session cookie and redirects to dashboard
- `docker compose ps` shows `videosphere-mongo` healthy

## 6. Before Opening a PR

```bash
pnpm format
pnpm lint
pnpm test run
pnpm build
```

If all pass, push your branch and open a PR.

---

## Notes

- This repository uses MongoDB for auth/session-related data and application persistence.
- Docker deployment uses app + MongoDB from one compose file.
- For production deployment details, see [docs/deployment-guide.md](docs/deployment-guide.md).
