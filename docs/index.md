# VideoSphere Documentation

VideoSphere is an open-source, self-hosted video distribution platform. Upload once to Cloudflare R2, then distribute to YouTube, Vimeo, Facebook, SermonAudio, Google Drive, SFTP, and SMB — with metadata drafts, labels, thumbnails, scheduling, AI-assisted descriptions, YouTube import, and livestream scheduling.

## Start Here (deploy & operate)

For homelab or production use — no source checkout required if you use the published Docker image.

1. [Deployment Guide](/deployment-guide) — run the pre-built image with Docker Compose or Portainer
2. [R2 Storage](/setup/r2/r2-module) — create a Cloudflare R2 bucket and API credentials (required for uploads)
3. [Google OAuth](/setup/google/google-oauth) — sign-in with Google, YouTube connection, and Google Drive connection (optional per integration)
4. [Vimeo OAuth](/setup/vimeo/vimeo-oauth) — Vimeo connection and Upload Access approval (single-account limitation; see guide)
5. [Facebook OAuth](/setup/facebook/fb-oauth) — Facebook Page connection for Reels publishing
6. [Password Recovery](/password-recovery) — reset accounts when SMTP is not configured (CLI, admin links, container access)

After the stack is running, connect platforms under **Profile → Connections** in the app. Setup guides: [Google OAuth](/setup/google/google-oauth), [Vimeo OAuth](/setup/vimeo/vimeo-oauth), [Facebook OAuth](/setup/facebook/fb-oauth), [SermonAudio API](/setup/sermon-audio/sa-api). Optional: add an [OpenRouter](https://openrouter.ai/) API key for AI metadata generation (see the deployment guide env table).

Want to smoke-test the production image on your machine before going live? See [Local Docker Testing](/local-docker-testing).

## Development & contributing

Cloning the repo, changing code, or updating docs? See **[Development & Contributing](/contributing)**.

## Using the app

Full walkthrough: **[Uploads, Livestreams & Distribution](/uploads-and-distribution)** — platform connections, draft metadata modal, file upload, YouTube import, livestream scheduling, and upload history.

| Area | Route | Notes |
| ---- | ----- | ----- |
| **Uploads** | `/dashboard/uploads` | Draft list and metadata editor (`DraftMetadataModal`) |
| **Upload history** | `/dashboard/uploads/history` | Completed and failed jobs; retry and discard |
| **Livestreams** | `/dashboard/livestreams` | YouTube scheduled broadcasts (Facebook scheduling disabled for new schedules) |
| **Connections** | `/profile/connections` | OAuth and credential setup per platform |
| **Admin** | `/dashboard/users`, `/admin/dashboard` | User management and stats |

Draft data APIs remain under `/api/drafts/*`; the dashboard nav label is **Uploads**.
