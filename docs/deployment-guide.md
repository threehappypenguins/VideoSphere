# Deployment Guide

Run VideoSphere in production with pre-built Docker images. The app is stateless — uploaded media goes to Cloudflare R2 — so you only need to persist MongoDB data on disk.

## Container Images

Published images are multi-arch (`linux/amd64`, `linux/arm64`). Docker pulls the variant that matches your host. 32-bit ARM is not supported.

| Registry | Image |
| -------- | ----- |
| GitHub Container Registry | `ghcr.io/threehappypenguins/videosphere:latest` |
| Docker Hub | `threehappypenguins/videosphere:latest` |

Both registries serve the same image. Use whichever is easier to reach from your network. If you pull from GHCR and the image is private, log the Docker host into `ghcr.io` first (Portainer: **Registries**).

Pin a specific tag instead of `latest` when you want controlled rollouts.

## Requirements

- Docker (Compose v2 or Portainer)
- MongoDB 8 (included in the stack below, or external)
- [Cloudflare R2](/setup/r2/r2-module) bucket for temporary media staging
- Platform OAuth credentials — [Google OAuth](/setup/google/google-oauth) (sign-in, YouTube, Google Drive), [Vimeo OAuth](/setup/vimeo/vimeo-oauth), [Facebook OAuth](/setup/facebook/fb-oauth)
- Per-user connection credentials entered in the app — [SermonAudio API](/setup/sermon-audio/sa-api), SFTP host/auth, SMB share credentials
- Optional MediaMTX sidecar only if you want RTMP ingest for live audio translation (browser mic works without it)

## Required Environment Variables

Set these on the app container (Portainer stack variables, Compose env file, or `docker run -e`):

| Variable | Purpose |
| -------- | ------- |
| `NEXT_PUBLIC_APP_URL` | URL you use in the browser, e.g. `http://192.168.1.38:9624` or `https://videos.example.com`. Required for OAuth redirect URIs and session cookies. |
| `MONGO_ROOT_PASSWORD` | Strong password for the MongoDB root user and the app connection string |
| `JWT_SECRET` | Session signing secret — `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `TOKEN_ENCRYPTION_KEY` | Base64 32-byte key for encrypting stored OAuth tokens (same generator as `JWT_SECRET`) |
| `R2_ACCOUNT_ID` | Cloudflare R2 staging storage (uploads do not work without R2) |
| `R2_ACCESS_KEY_ID` | R2 API token |
| `R2_SECRET_ACCESS_KEY` | R2 API token |
| `R2_BUCKET_NAME` | Defaults to `videosphere-uploads` if omitted |

Email/password login works without Google OAuth. Add platform keys only when you use that integration:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Sign in with Google
- `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`
- `VIMEO_CLIENT_ID` / `VIMEO_CLIENT_SECRET`
- `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`
- `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET`
- `TRANSLATION_RTMP_PUBLIC_HOST` / `TRANSLATION_RTMP_PATH_PREFIX` only when enabling optional MediaMTX RTMP ingest

The app builds `MONGODB_URI` automatically when you use the stack templates below. If you run MongoDB separately, set `MONGODB_URI` yourself.

Never commit secrets. See [`.env.example`](https://github.com/threehappypenguins/VideoSphere/blob/main/.env.example) in the repository for the full variable list.

## Option A: Portainer Stack (Recommended)

The repository ships a ready-to-paste stack: [`portainer-stack.yml`](https://github.com/threehappypenguins/VideoSphere/blob/main/portainer-stack.yml).

1. **Portainer** → **Stacks** → **Add stack**
2. Paste the contents of `portainer-stack.yml` into the web editor
3. Under **Environment variables**, add at least the required keys from the table above
4. **Deploy the stack**

The default stack uses `ghcr.io/threehappypenguins/videosphere:latest` and `mongo:8`, publishes the app on port **9624**, and stores MongoDB in a named Docker volume.

### Optional host path for MongoDB data

To put WiredTiger data files in a known host directory (disk layout / capacity planning — not a substitute for backups), create the folder on the Portainer host and follow the bind-mount instructions in the comments at the top of `portainer-stack.yml`. For example:

```bash
mkdir -p /srv/AppData/videosphere/mongo
```

Back up with `mongodump` (next section). Do not archive the live `/data/db` directory (or a host bind mount of it) while `mongod` is running.

## MongoDB backup and restore

The app is stateless — uploaded media lives in Cloudflare R2. **MongoDB is the only local state to back up** (users, sessions, drafts, connected-account tokens, upload history, and so on).

Prefer a portable `mongodump` archive over tarballing live WiredTiger files. A dump is consistent enough for VideoSphere’s data model (standalone Mongo; no multi-document transactional / financial workloads). Point-in-time `--oplog` dumps require a replica set and are not needed here.

Default container name: `videosphere-mongo`. Confirm with:

```bash
docker ps --format '{{.Names}}' | grep -i mongo
```

### Backup (`mongodump`)

Credentials are already in the mongo container as `MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD`.

```bash
# 1. Dump a compressed archive inside the container
STAMP=$(date -u +%Y-%m-%d)
docker exec videosphere-mongo sh -c \
  'mongodump -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
    --authenticationDatabase admin --archive=/tmp/videosphere-mongo.dump.gz --gzip'

# 2. Copy it to your staging/backup directory on the host
mkdir -p /path/to/backup-staging
docker cp "videosphere-mongo:/tmp/videosphere-mongo.dump.gz" \
  "/path/to/backup-staging/videosphere-mongo-${STAMP}.gz"

# 3. Remove the temp file from the container
docker exec videosphere-mongo rm -f /tmp/videosphere-mongo.dump.gz
```

If you also archive VideoSphere config or other host folders, **exclude**:

- the live Mongo data directory (Docker volume or bind mount under `/data/db`)
- any `~/.mongodb/mongosh/` log trees (health probes used to spam these; they are not backup artifacts)

Keep the `.gz` dump as the database backup artifact.

### Restore (`mongorestore`)

Restore replaces data in the running instance. Stop or pause writers if you need a quiet window; then:

```bash
# Copy the archive into the container
docker cp /path/to/videosphere-mongo-2026-08-15.gz videosphere-mongo:/tmp/restore.gz

# Restore (--drop replaces existing collections that appear in the archive)
docker exec videosphere-mongo sh -c \
  'mongorestore -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
    --authenticationDatabase admin --archive=/tmp/restore.gz --gzip --drop'

docker exec videosphere-mongo rm -f /tmp/restore.gz
```

Omit `--drop` only when you intentionally want to merge into existing collections. After a full disaster-recovery restore, restart the app container if sessions or cached state look stale.

Official reference: [MongoDB backup methods](https://www.mongodb.com/docs/manual/core/backups/).

## Option B: Docker Compose

Create a `docker-compose.yml` (or copy and adapt `portainer-stack.yml`) that references a pre-built image instead of building locally:

```yaml
services:
  app:
    image: ghcr.io/threehappypenguins/videosphere:latest
    # image: threehappypenguins/videosphere:latest
    container_name: videosphere
    restart: unless-stopped
    ports:
      - '9624:9624'
    env_file:
      - .env.local
    environment:
      NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:?set NEXT_PUBLIC_APP_URL}
      MONGODB_URI: mongodb://${MONGO_ROOT_USER:-admin}:${MONGO_ROOT_PASSWORD:?set MONGO_ROOT_PASSWORD}@mongo:27017/videosphere?authSource=admin
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET}
      TOKEN_ENCRYPTION_KEY: ${TOKEN_ENCRYPTION_KEY:?set TOKEN_ENCRYPTION_KEY}
      R2_ACCOUNT_ID: ${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}
      R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID:?set R2_ACCESS_KEY_ID}
      R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY}
    depends_on:
      mongo:
        condition: service_healthy

  mongo:
    image: mongo:8
    container_name: videosphere-mongo
    restart: unless-stopped
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_ROOT_USER:-admin}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_ROOT_PASSWORD:?set MONGO_ROOT_PASSWORD}
      MONGO_INITDB_DATABASE: videosphere
    volumes:
      - mongo-data:/data/db
    # Disable mongosh persistent logs for health probes (see docker-compose.yml).
    healthcheck:
      test:
        - CMD-SHELL
        - >-
          (test -f /etc/mongosh.conf
          || printf 'mongosh:\n  disableLogging: true\n  enableTelemetry: false\n' > /etc/mongosh.conf)
          && mongosh --quiet --eval "db.adminCommand('ping')"
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mongo-data:
```

1. Copy `.env.example` to `.env.local` and fill in required values
2. Validate Compose interpolation:

```bash
docker compose --env-file .env.local config
```

3. Start the stack:

```bash
docker compose --env-file .env.local up -d
```

`MONGO_ROOT_PASSWORD` must be available to Compose itself (not only inside the app container), so always pass `--env-file .env.local` or export the variable before `docker compose up`.

## First Run and Verification

1. Open the app at `NEXT_PUBLIC_APP_URL` (for example `http://192.168.1.38:9624` on a homelab)
2. Complete **first-run setup** — create the first admin at `/setup` before exposing the instance to the public internet
3. Confirm containers are healthy: `docker ps` (or Portainer **Containers**)
4. Log in and confirm the dashboard loads with a session cookie

Password reset and admin recovery: [Password Recovery](/password-recovery).

## SMB Backup (Linux)

SMB backups use TCP port 445 to reach a NAS or Windows share on your LAN. On **Linux**, uncomment `network_mode: host` on the app service so the container can reach LAN hosts. With host networking, published `ports:` are ignored — the app listens on **9624** on the host directly.

`network_mode: host` is Linux-only. Docker Desktop on macOS and Windows does not provide true host LAN access.

## Updates

Pull the new image and recreate the app container:

```bash
docker compose --env-file .env.local pull app
docker compose --env-file .env.local up -d
```

In Portainer: **Stacks** → your stack → **Pull and redeploy**, or update the image tag and redeploy.

MongoDB data survives app updates as long as the Mongo volume or bind mount is unchanged.

## Custom Domain and TLS

VideoSphere listens on HTTP inside the container (port 9624). For HTTPS and a public domain, put a reverse proxy in front — for example [Nginx Proxy Manager](https://nginxproxymanager.com/), Traefik, or Caddy.

1. Point DNS at your server
2. Proxy `https://your-domain.com` → `http://<host-ip>:9624`
3. Set `NEXT_PUBLIC_APP_URL=https://your-domain.com` and redeploy
4. Update OAuth redirect URIs in each provider console to use the new URL

## Reverse Proxy Checklist

- `NEXT_PUBLIC_APP_URL` matches the URL users type in the browser (scheme and host)
- OAuth callback URLs use the same host
- WebSocket/long uploads: ensure the proxy allows large request bodies and sufficient timeouts for video uploads
- **SSE (live translation `/listen`):** public captions and “live” status use Server-Sent Events at `/api/translation/public/{slug}/events`. Default nginx buffering can hold that stream until a large chunk accumulates (long silence, then a huge caption dump; “not connected” stuck until refresh). VideoSphere sends `X-Accel-Buffering: no` on that response so nginx/NPM flush events without custom Advanced config. Redeploy the app image after upgrading; no proxy changes required for a normal NPM setup.

### If SSE is still buffered after upgrade

Rare cases (proxy ignores `X-Accel-Buffering`, non-nginx frontends, Cloudflare orange-cloud quirks): confirm in DevTools that `/events` dumps many `data:` lines at once instead of a steady trickle (heartbeats every ~15s). Then either DNS-only Cloudflare for a test, or add a **scoped** Advanced location for the SSE path only — not sibling JSON/TTS routes under `/api/translation/public/` (`/audio/...` is short-lived TTS downloads; source listen PCM rides the SSE stream):

```nginx
location ~ ^/api/translation/public/[^/]+/events {
  proxy_pass http://<videosphere-host>:9624;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Connection '';
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
  chunked_transfer_encoding on;
}
```

Replace `<videosphere-host>` with whatever the proxy already uses for the rest of the site. Remove this block once the app header alone is enough.

## Useful Resources

- [Portainer documentation](https://docs.portainer.io/)
- [Docker Compose reference](https://docs.docker.com/compose/)
- [MongoDB backup methods](https://www.mongodb.com/docs/manual/core/backups/)
- [Cloudflare R2 documentation](https://developers.cloudflare.com/r2/)
