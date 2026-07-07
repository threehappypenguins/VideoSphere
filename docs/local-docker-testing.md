# Local Docker Image Testing

Use this workflow to build the production Docker image on your machine and run it against your local `.env.local` — the same image CI publishes, without pushing to a registry.

Works with **Docker** or **Podman** (commands below use `docker`; with Podman, `docker` is often an alias, or substitute `podman` directly).

## When to use this

- Before merging `Dockerfile` or production-runtime changes
- To reproduce production behavior locally (`pnpm dev` vs the standalone Next.js server)
- To smoke-test OAuth, uploads, or other features in the container

For day-to-day development, prefer `pnpm dev` — see [Daily Dev Workflow](/daily-dev-workflow).

## Prerequisites

1. `.env.local` configured (copy from `.env.example`). Required at minimum:
   - `MONGO_ROOT_PASSWORD`
   - `JWT_SECRET`
   - `TOKEN_ENCRYPTION_KEY`
   - `NEXT_PUBLIC_APP_URL` — use `http://localhost:9624` when testing on the same machine
2. Google sign-in (optional): add `http://localhost:9624/api/auth/oauth/callback` as an authorized redirect URI in Google Cloud Console

## 1. Build the image

On **amd64** (typical PC / laptop):

```bash
./scripts/docker-build-platform.sh linux/amd64 videosphere:amd64-test
```

On **arm64** (Apple Silicon, Raspberry Pi, Odroid):

```bash
./scripts/docker-build-platform.sh linux/arm64 videosphere:arm64-test
```

The script defaults to `linux/arm64` and tag `videosphere:local-test` when no arguments are given. Podman tags the result as `localhost/videosphere:amd64-test`.

Cross-arch builds (e.g. arm64 on amd64) need QEMU — see comments in `scripts/docker-build-platform.sh`.

## 2. Start MongoDB

Use Compose so Mongo gets a persistent volume and health checks:

```bash
docker compose --env-file .env.local up -d mongo
```

Compose reads `MONGO_ROOT_PASSWORD` from `.env.local` for Mongo initialization. The container name is `videosphere-mongo` on network `videosphere_default`.

## 3. Run the app container

**Important:** Two details that are easy to get wrong:

1. **`MONGODB_URI` in `.env.local` uses `localhost`** — correct for `pnpm dev`, wrong inside a container. Override it to use the Compose service hostname `videosphere-mongo`.
2. **Shell expansion for `-e MONGODB_URI=...`** — `${MONGO_ROOT_PASSWORD}` is expanded by your shell when you run `docker run`, not by Docker from `--env-file`. Source `.env.local` first so the password is in your shell.

```bash
set -a
source .env.local
set +a

docker run -d \
  --name videosphere-test \
  --network videosphere_default \
  -p 9624:9624 \
  --env-file .env.local \
  -e "MONGODB_URI=mongodb://${MONGO_ROOT_USER:-admin}:${MONGO_ROOT_PASSWORD}@videosphere-mongo:27017/videosphere?authSource=admin" \
  localhost/videosphere:amd64-test
```

Replace `amd64-test` with your tag if you built a different one.

## 4. Verify

1. Open `http://localhost:9624` (or your `NEXT_PUBLIC_APP_URL`)
2. Sign in or complete first-run setup at `/setup`
3. Check logs: `docker logs -f videosphere-test`

If auth fails with `MongoServerError: Authentication failed` in the logs, the `MONGODB_URI` override did not get the password — re-run step 3 after `source .env.local`.

## 5. Clean up

```bash
docker rm -f videosphere-test
docker compose --env-file .env.local down
```

To remove the built image: `docker rmi localhost/videosphere:amd64-test`

Intermediate `<none>` images from builds can be pruned with `docker image prune`.

## Quick reference (copy-paste)

```bash
# Build (amd64)
./scripts/docker-build-platform.sh linux/amd64 videosphere:amd64-test

# Mongo
docker compose --env-file .env.local up -d mongo

# App
set -a && source .env.local && set +a
docker run -d \
  --name videosphere-test \
  --network videosphere_default \
  -p 9624:9624 \
  --env-file .env.local \
  -e "MONGODB_URI=mongodb://${MONGO_ROOT_USER:-admin}:${MONGO_ROOT_PASSWORD}@videosphere-mongo:27017/videosphere?authSource=admin" \
  localhost/videosphere:amd64-test

# Teardown
docker rm -f videosphere-test
docker compose --env-file .env.local down
```

## Related

- [Deployment Guide](/deployment-guide) — production with pre-built registry images
- [SETUP.md](https://github.com/threehappypenguins/VideoSphere/blob/main/SETUP.md) — first-run setup and Mongo options
- [CONTRIBUTING.md](https://github.com/threehappypenguins/VideoSphere/blob/main/CONTRIBUTING.md) — multi-arch build verification before merge
