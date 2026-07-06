# Uploads, livestreams & distribution

This guide describes how VideoSphere works in the dashboard: connecting platforms, preparing uploads, distributing video, scheduling livestreams, and importing from YouTube.

For deployment and R2 setup, start with the [Deployment Guide](/deployment-guide) and [R2 Storage](/setup/r2/r2-module). For draft JSON shapes and manual API testing, see [Draft Document & Upload Testing](/draft-document-and-upload-testing).

---

## Platform connections

Open **Profile → Connections** (`/profile/connections`) before your first upload or livestream. VideoSphere stores OAuth tokens and backup credentials encrypted in MongoDB (`TOKEN_ENCRYPTION_KEY` on the server).

### Connection matrix

| Platform | Type | How to connect | Server env vars (deployer) | What you configure in the app |
| -------- | ---- | -------------- | ---------------------------- | ------------------------------- |
| **YouTube** | Video publish | OAuth — **Connect YouTube** | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | OAuth consent; optional **main** and **temporary** stream keys (for livestreams) |
| **Vimeo** | Video publish | OAuth — **Connect Vimeo** | `VIMEO_CLIENT_ID`, `VIMEO_CLIENT_SECRET` | OAuth only |
| **Facebook** | Video publish (Reels) | OAuth — **Connect Facebook** | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | OAuth, then pick a **Facebook Page** on the setup screen |
| **SermonAudio** | Video publish | Form — API key | None (per-user key in DB) | Broadcaster ID, API key, optional label |
| **Google Drive** | Backup copy | OAuth — **Connect Google Drive** | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` | OAuth, then backup folder path |
| **SFTP** | Backup copy | Form — host & credentials | None | Host, port, username, remote path, SSH key or password |
| **SMB** | Backup copy | Form — share & credentials | None | Host, share name, domain, username, password, remote path |

**Video platforms** (YouTube, Vimeo, Facebook, SermonAudio) receive published metadata and the uploaded file. **Backup destinations** (Google Drive, SFTP, SMB) receive a copy of the video file with optional filename rules from the draft.

All OAuth redirect URIs depend on `NEXT_PUBLIC_APP_URL` matching the URL you use in the browser.

Detailed setup screenshots for R2 are in [R2 Storage](/setup/r2/r2-module). Google sign-in and platform OAuth (YouTube, Google Drive) are in [Google OAuth](/setup/google/google-oauth).

---

## Uploads workflow

The dashboard **Uploads** section (`/dashboard/uploads`) is where you create drafts, enter metadata, upload video, and start distribution.

### Create or open a draft

| Action | What happens |
| ------ | ------------- |
| **Dashboard → New draft** | Creates a minimal draft and opens the metadata editor on Uploads (`?createDraftId=…`) |
| **Uploads → Create draft** | Same: empty draft row + metadata modal |
| Click a draft in the list | Opens the metadata modal for editing |
| Visit `/dashboard/uploads/[id]` | Redirects to `?editDraft=[id]` and opens the modal |

Drafts are grouped into **Ready to upload** and **Used in upload** (after a successful upload job).

### Draft metadata modal

The metadata modal (`DraftMetadataModal`) is the main editor. Typical sections:

1. **Labels** — organizational tags inside VideoSphere only (not sent to platforms).
2. **Platforms** — toggle which connected targets this upload should use; link to Connections if a platform is missing.
3. **Backup naming** — when Google Drive, SFTP, or SMB is selected: date prefix, series, suffix, year folder, optional metadata atoms.
4. **AI metadata** — optional prompt to generate title, description, and tags (requires `OPENROUTER_API_KEY` on the server and AI access for the user).
5. **Title, description, tags** — shared defaults with optional per-platform overrides (YouTube, Vimeo, SermonAudio, Facebook).
6. **Platform-specific fields** — categories, playlists, scheduling, SermonAudio speaker/series, Facebook publish time, etc.
7. **Thumbnail** — default image plus optional per-platform overrides.
8. **Video** — upload a file from your computer, **import from YouTube**, or review recent upload history for this draft.

**Save draft** persists metadata without uploading. **Upload & Save** validates, saves, then starts the upload or YouTube-import distribution flow.

### Upload a video file

When you choose a local file and confirm **Upload & Save**:

1. Browser requests a multipart presign: `POST /api/uploads/presign`
2. File parts upload directly to **Cloudflare R2** (not through the VideoSphere app server)
3. Browser completes the job: `POST /api/uploads/[jobId]/complete`
4. Server verifies the object on R2 and **automatically distributes** to every target on the draft

Supported formats: MP4, MOV, AVI, MKV, WebM. Maximum size: **5 GB**.

There is also a standalone upload page at `/dashboard/uploads/[id]/upload` (same presign → R2 → complete flow). The primary UX is inside the metadata modal; the standalone page is useful for direct links or testing.

### After upload

Distribution runs asynchronously. Each platform gets a **platform upload** row with status, errors, and (when successful) a link to the published video.

- **In the modal** — recent jobs for this draft appear in the upload history card.
- **Uploads → History** (`/dashboard/uploads/history`) — all jobs across drafts, with retry and discard actions.

---

## YouTube import

Import a public or unlisted YouTube video (or a past streamed livestream) instead of uploading a file from disk. Requires a connected **YouTube** account.

### How to start

1. Open a draft in the metadata modal.
2. Click **Import from YouTube** (disabled while another import is running for this draft).
3. The import modal opens (`YouTubeImportModal`).

### Steps in the import modal

| Step | What you do |
| ---- | ----------- |
| **Source** | Paste a YouTube URL, or pick a past livestream from your VideoSphere history |
| **Editor** | Preview the video, set trim range (start/end), optionally enable smart cut |
| **Progress** | Watch download and staging; job polls until complete |

Backend flow:

1. **Resolve** — `POST /api/youtube-import/resolve` validates the URL and reads metadata via your YouTube OAuth token.
2. **Start** — `POST /api/youtube-import/start` queues a job; the server runs **yt-dlp** to download the clip (respecting trim and duration limits).
3. **Stage** — trimmed video uploads to R2 and links to an upload job on the draft.
4. **Distribute** — when you click **Upload & Save**, `POST /api/youtube-import/[jobId]/queue-distribute` starts platform distribution (same path as a normal file upload after complete).

You can cancel an in-flight import from the modal. **Discard** clears a staged import without distributing (`POST /api/drafts/[id]/youtube-import/discard`).

Server requirements: YouTube OAuth env vars, R2 credentials, and a writable `YT_IMPORT_WORKDIR` (see `.env.example`).

---

## Livestreams

Schedule YouTube (and optionally Facebook) broadcasts from **Livestreams** (`/dashboard/livestreams`).

### List sections

| Section | Meaning |
| ------- | ------- |
| **Drafts** | Created but not yet scheduled |
| **Scheduled** | Broadcast scheduled, not live |
| **Live** | Currently live |
| **Streamed** | Ended; full history on **Livestreams → History** |

**New livestream** creates a draft row; the metadata modal opens for title, description, tags, visibility, platforms, schedule, thumbnail, and YouTube-specific options.

### Scheduling

**Schedule livestream** saves metadata and calls `POST /api/livestreams/[id]/schedule` with the start time (UTC). For **YouTube**:

- A connected account with a **main stream key** configured on the Connections page is required.
- VideoSphere creates a YouTube broadcast and binds a stream key slot (**main** or **temporary**).

**Facebook livestream scheduling** for new schedules is currently disabled in code (`FACEBOOK_LIVESTREAM_SCHEDULING_ENABLED = false`). Existing Facebook-targeted rows may still show Facebook arm/end controls; new schedules are YouTube-only until that flag is enabled.

### Stream keys and conflicts

**YouTube key slot**

- Scheduled or live YouTube broadcasts use either the **main** or **temporary** stream key from Connections.
- Change slot from the livestream detail via `PATCH /api/livestreams/[id]/key-slot`.
- If another scheduled or live stream already uses the same slot, the UI warns you (**key slot conflict**).

**Facebook arm / end** (when a livestream targets Facebook)

- **Arm** — `POST /api/livestreams/[id]/facebook-arm` creates a Facebook `LiveVideo` and shows RTMPS URL + stream key for OBS or similar.
- **End** — `POST /api/livestreams/[id]/facebook-end` stops the broadcast.
- Only one Facebook stream can be **armed** at a time; arming a second shows a conflict warning.
- When another Facebook livestream is already scheduled or live, a deferred arm can run automatically shortly before start (configurable minutes before go-live).

**Automatic stream preparation** — optional checkbox to promote a temporary YouTube key to main, or create the Facebook ingest URL, a few minutes before start.

### Livestream history

**Livestreams → History** (`/dashboard/livestreams/history`) lists ended broadcasts (paginated). You can open metadata read-only or delete old rows.

---

## Upload history

**Uploads → History** (`/dashboard/uploads/history`) shows every upload job: draft title, job status, per-platform status, errors, and whether the R2 file has expired.

| Job / platform status | Typical meaning |
| --------------------- | ---------------- |
| `pending` / `uploading` | File still moving to R2 |
| `distributing` | Platforms are being called |
| `completed` | All targets finished successfully |
| `failed` | One or more platforms failed |

**Actions**

- **Retry** (per failed platform) — re-runs distribution for that platform using the same R2 object (only when the job failed but the file is still on R2).
- **Discard** (failed job) — deletes the staged video and thumbnails from R2; retry is no longer possible.

The page auto-refreshes every few seconds while jobs are active.

---

## Quick reference — routes

| Route | Purpose |
| ----- | ------- |
| `/dashboard/uploads` | Draft list + metadata modal |
| `/dashboard/uploads?editDraft=[id]` | Open draft editor |
| `/dashboard/uploads/[id]/upload` | Standalone file upload page |
| `/dashboard/uploads/history` | Global upload job history |
| `/dashboard/livestreams` | Livestream list + scheduler |
| `/dashboard/livestreams/history` | Ended livestreams |
| `/profile/connections` | Connect platforms and backup destinations |

---

## Related documentation

| Topic | Doc |
| ----- | --- |
| Draft `document` JSON and curl testing | [Draft Document & Upload Testing](/draft-document-and-upload-testing) |
| MongoDB collections | [MongoDB Data Model](/mongodb-data-model) |
| Production deploy & env vars | [Deployment Guide](/deployment-guide) |
| Locked-out password reset | [Password Recovery](/password-recovery) |
