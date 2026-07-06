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
- Platform OAuth credentials — [Google OAuth](/setup/google/google-oauth) (sign-in, YouTube, Google Drive), [Vimeo OAuth](/setup/vimeo/vimeo-oauth), plus Facebook if enabled
- Per-user connection credentials entered in the app — [SermonAudio API](/setup/sermon-audio/sa-api), SFTP host/auth, SMB share credentials
- OpenRouter API key for AI metadata generation (optional)

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
- `OPENROUTER_API_KEY` (and optional `OPENROUTER_MODEL`, timeout overrides)

The app builds `MONGODB_URI` automatically when you use the stack templates below. If you run MongoDB separately, set `MONGODB_URI` yourself.

Never commit secrets. See [`.env.example`](https://github.com/threehappypenguins/VideoSphere/blob/main/.env.example) in the repository for the full variable list.

## Option A: Portainer Stack (Recommended)

The repository ships a ready-to-paste stack: [`portainer-stack.yml`](https://github.com/threehappypenguins/VideoSphere/blob/main/portainer-stack.yml).

1. **Portainer** → **Stacks** → **Add stack**
2. Paste the contents of `portainer-stack.yml` into the web editor
3. Under **Environment variables**, add at least the required keys from the table above
4. **Deploy the stack**

The default stack uses `ghcr.io/threehappypenguins/videosphere:latest` and `mongo:8`, publishes the app on port **9624**, and stores MongoDB in a named Docker volume.

### Host path for MongoDB backups

To put database files in a known host directory (e.g. for your existing backup job), create the folder on the Portainer host (modify folder structure accordingly). For example:

```bash
mkdir -p /srv/AppData/videosphere/mongo
```

Then follow the bind-mount instructions in the comments at the top of `portainer-stack.yml`.

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
    healthcheck:
      test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"]
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

## Useful Resources

- [Portainer documentation](https://docs.portainer.io/)
- [Docker Compose reference](https://docs.docker.com/compose/)
- [MongoDB backup methods](https://www.mongodb.com/docs/manual/core/backups/)
- [Cloudflare R2 documentation](https://developers.cloudflare.com/r2/)
