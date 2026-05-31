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

## 3. Start MongoDB

Choose one local workflow:

### Option A: Docker Compose (recommended)

If you have not set it yet, add this to `.env.local` before starting Mongo:

```bash
MONGO_ROOT_PASSWORD=change_me
```

```bash
docker compose --env-file .env.local up -d mongo
```

This project ships a self-contained compose stack with `mongo:8` and persistent storage.
Compose interpolation for `${MONGO_ROOT_PASSWORD}` reads from the shell environment or
an explicit Compose env file, so this command must include `--env-file .env.local`.

### Option B: Docker run (also valid for local development)

If you prefer running Mongo directly, this is supported:

```bash
docker pull docker.io/mongo:8

docker run -d \
	--name videosphere-mongo \
	-p 27017:27017 \
	-e MONGO_INITDB_ROOT_USERNAME=admin \
	-e MONGO_INITDB_ROOT_PASSWORD=localdevpassword \
	-v videosphere-mongo-data:/data/db \
	mongo:8
```

When using this option, ensure your `.env.local` uses matching credentials, for example:

```bash
MONGO_ROOT_PASSWORD=localdevpassword
MONGODB_URI=mongodb://admin:localdevpassword@localhost:27017/videosphere?authSource=admin
```

If the container already exists and is stopped, use `docker start videosphere-mongo` instead of creating it again.

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
- If using Compose: `docker compose ps` shows `videosphere-mongo` healthy
- If using docker run: `docker ps --filter name=videosphere-mongo` shows the container running

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
