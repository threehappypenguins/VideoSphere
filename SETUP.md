# First-Run Setup Guide

Complete these steps after cloning the repository. This guide is MongoDB-first and self-hostable.

---

## 1. Clone and Install

```bash
git clone [your-repo-url]
cd [your-repo-name]
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
- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`

SermonAudio uses API-key authentication and is entered by each user in the app UI (Connected Accounts), not in `.env.local`.

SFTP and SMB backup destinations are configured per user in Connected Accounts (SFTP: host, port, credentials, and remote path; SMB: host, share, credentials, and remote path). No SFTP- or SMB-related environment variables are required on the server.

For SMB, use the share name exactly as listed by `smbclient -L` (case-sensitive, e.g. `Storage`). If smbclient shows `WORKGROUP\youruser`, leave the domain field blank — VideoSphere defaults to `WORKGROUP` for NTLMv2 auth on Samba.

For Facebook OAuth credentials:

1. Create an app in Facebook Developer Console.
2. Enable "Manage Everything on your Page" as a use case and configure OAuth redirect URI:
   - `http://localhost:3000/api/platforms/callback/facebook` (local)
3. Copy the app credentials into:
   - `FACEBOOK_APP_ID`
   - `FACEBOOK_APP_SECRET`
4. **Reel place search (optional):** Tagging a location on a Reel uses the Graph API
   [`GET /pages/search`](https://developers.facebook.com/docs/pages-api/search-pages/). Without
   [Page Public Metadata Access](https://developers.facebook.com/docs/features-reference/page-public-metadata-access/)
   (Meta App Review + business verification), place search is limited to Facebook Pages you manage.
   Request that feature in App Review when you need to search all public places.

## 3. Start MongoDB

Ensure MongoDB is running using one of the local Docker workflows below.

### Option A: Docker Compose (recommended)

If you have not set it yet, add this to `.env.local` before starting Mongo:

```bash
MONGO_ROOT_PASSWORD=change_me
```

```bash
docker compose --env-file .env.local up -d mongo
```

This project ships a self-contained compose stack with `mongo:8` and persistent storage.
Mongo runs as a **standalone** instance (not a replica set), so multi-document transactions are
unavailable; password reset completion is documented in
[docs/password-recovery.md](docs/password-recovery.md#reset-completion-why-not-mongodb-transactions).
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

Open the app in your browser using the address you will actually use to reach the server:

- **Same machine as the app:** [http://localhost:3000](http://localhost:3000)
- **Homelab / LAN (Odroid, NAS, Pi, etc.):** `http://<host-ip>:3000` — for example `http://192.168.1.38:3000`

Use whichever address matches how you browse to the box. Many self-hosted setups never use `localhost` because the app runs on another device on your network.

## 5. Create the First Admin Account

VideoSphere uses invite-only registration after the first admin exists. Until then, the instance is in **first-run setup** mode.

1. Open the app at the address you use to reach the host (for example `http://192.168.1.38:3000` on a homelab, or your cloud VM IP while your firewall allows only your address).
2. Click **Set up VideoSphere** on the home page, or go to `/setup` — both take you to the admin creation form.
3. Create the first admin account (email/password or Google OAuth).

The setup URL is also printed in server logs on startup if you prefer the terminal (`docker compose logs app` or `pnpm dev` output).

### Keep first-run off the public internet

VideoSphere assumes first-run happens on a network you control — a homelab LAN, a VPN, or a cloud VM whose firewall only allows your IP on the app port. Do not forward the port or publish a public domain until the admin account exists. After setup, normal login and invite-only registration apply.

## 6. Quick Verification

Use this checklist:

- App loads at the address you use to reach the host (LAN IP, hostname, or `localhost`)
- First admin setup completes from the home page or `/setup`
- Login issues a session cookie and redirects to dashboard
- If using Compose: `docker compose ps` shows `videosphere-mongo` healthy
- If using docker run: `docker ps --filter name=videosphere-mongo` shows the container running

## 7. Before Opening a PR

```bash
pnpm format
pnpm lint
pnpm test run
pnpm build
```

If all pass, push your branch and open a PR.

---

## SMB backup (Docker / LAN reachability)

SMB uses TCP port 445 to reach a NAS or Windows share on your LAN. The app container does not need a volume mount; backups stream over SMB2 directly.

On **Linux**, run the app container with host networking so it can reach LAN hosts:

```bash
docker run --name videosphere --network host --env-file .env.local videosphere
```

The app listens on port 3000 on the host directly; do not add `-p`—published ports are ignored in host networking mode.

With Docker Compose, uncomment `network_mode: host` on the `app` service (see `docker-compose.yml`). Compose ignores `ports:` in host mode—the app listens on port 3000 on the host directly; leave or remove the `ports` block, but do not expect publish mappings to work.

`--network host` is **Linux-only**. On macOS and Windows, Docker Desktop’s “host” network is a VM, so LAN reachability to a NAS depends on your Docker and network setup.

`pnpm dev` on the host (without Docker) can reach the LAN directly; host networking is only required when the app runs inside a container.

## Notes

- This repository uses MongoDB for auth/session-related data and application persistence.
- Docker deployment uses app + MongoDB from one compose file.
- For production deployment details, see [docs/deployment-guide.md](docs/deployment-guide.md).
