# VideoSphere — Product Requirements Document (PRD)

> **Upload once, distribute everywhere.**

| Field               | Value                                                              |
| ------------------- | ------------------------------------------------------------------ |
| **Product Name**    | VideoSphere                                                        |
| **Document Version**| 1.0                                                                |
| **Date**            | March 2, 2026                                                      |
| **Status**          | Active                                                             |
| **Tech Stack**      | Next.js 16, React 19, TypeScript, Tailwind CSS 4, MongoDB, Cloudflare R2, Docker |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Target Audience](#3-target-audience)
4. [Product Vision & Goals](#4-product-vision--goals)
5. [User Personas](#5-user-personas)
6. [Core Workflow](#6-core-workflow)
7. [Feature Requirements](#7-feature-requirements)
   - 7.1 [Platform Management](#71-platform-management)
   - 7.2 [Video Upload & Storage](#72-video-upload--storage)
   - 7.3 [Draft & Metadata Management](#73-draft--metadata-management)
   - 7.4 [Multi-Platform Distribution](#74-multi-platform-distribution)
   - 7.5 [Scheduled Publishing (Stretch Goal)](#75-scheduled-publishing-stretch-goal)
   - 7.6 [AI-Powered Metadata Generation](#76-ai-powered-metadata-generation)
   - 7.7 [User Authentication & Account Management](#77-user-authentication--account-management)
   - 7.9 [Admin Dashboard](#79-admin-dashboard)
   - 7.10 [Upload Job Tracking](#710-upload-job-tracking)
8. [Information Architecture & Page Map](#8-information-architecture--page-map)
9. [Data Model](#9-data-model)
10. [API Design](#10-api-design)
11. [Non-Functional Requirements](#11-non-functional-requirements)
12. [Tech Stack & Architecture](#12-tech-stack--architecture)
13. [Third-Party Integrations](#13-third-party-integrations)
15. [User Stories](#15-user-stories)
17. [Risks & Mitigations](#17-risks--mitigations)
18. [Success Metrics](#18-success-metrics)
19. [Development Model](#19-development-model)
20. [Glossary](#20-glossary)
21. [Open Source & Self-Hosting](#21-open-source--self-hosting)

---

## 1. Executive Summary

**VideoSphere** is a web application that enables video creators to upload a video file once and have it automatically distributed to multiple video-hosting platforms — starting with **YouTube, Vimeo, SermonAudio, and Facebook** — from a single, centralized interface.

Users connect their platform accounts via OAuth2, create metadata drafts (title, description, tags, thumbnails), upload their video to Cloudflare R2 as temporary staging storage, and then initiate distribution to their selected platforms. VideoSphere handles the upload to each platform's API in the background, tracks job status in real time, and notifies the user upon completion or failure.

VideoSphere is fully open source and designed to be self-hosted via Docker. Organizations and individuals can run their own instance with full control over their data, connected platform credentials, and AI configuration.

---

## 2. Problem Statement

Content creators, marketing teams, small businesses, nonprofits, and enterprise media companies increasingly publish video content across multiple platforms to maximize reach. Today, this process is **manual, repetitive, and error-prone**:

- **Duplicate effort** — uploading the same video file to YouTube, Vimeo, and other platforms individually.
- **Inconsistent metadata** — re-typing titles, descriptions, and tags per platform leads to typos, missed tags, and brand inconsistency.
- **No centralized tracking** — creators have no single view of which platforms a video has been published to and whether uploads succeeded.
- **Time cost** — managing 2–4 platform dashboards per video release consumes hours that could be spent creating content.
- **Scheduling complexity** — each platform has its own scheduling interface, making coordinated launches difficult.

VideoSphere eliminates this friction by providing a **single pane of glass** for video distribution.

---

## 3. Target Audience

| Segment                        | Description                                                                                         | Key Pain Point                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Content Creators / YouTubers** | Independent video producers who publish regularly across YouTube and Vimeo.                         | Repetitive manual uploads and metadata entry across platforms.     |
| **Marketing Teams / Agencies** | Teams managing video content for one or more brands across multiple channels.                        | Coordinating multi-platform releases with consistent branding.    |
| **Small Businesses**           | Local and online businesses using video for product demos, tutorials, and marketing.                | Limited time and resources to manage multiple video platforms.     |
| **Enterprise Media Companies** | Organizations with large video libraries requiring scalable distribution workflows.                 | Need for centralized control, bulk publishing, and audit trails.  |
| **Nonprofits / Churches**      | Organizations and church communities using video for outreach, education, livestream archives, and weekly messaging across platforms. Christian organizations can publish to SermonAudio, a platform widely used by churches. | Volunteer-driven teams, including church media teams, need simple, efficient publishing workflows. |

---

## 4. Product Vision & Goals

### Vision

To become the go-to platform for anyone who publishes video content across multiple platforms — making multi-platform distribution as simple as a single upload. VideoSphere is open source — anyone can self-host, fork, and contribute.

### Goals

| # | Goal                                      | Measure of Success                                                  |
|---|-------------------------------------------|---------------------------------------------------------------------|
| 1 | Eliminate repetitive uploads               | User uploads once to reach all connected platforms.                 |
| 2 | Reduce metadata entry time by 80%         | AI generates title, description, and tags; user reviews and edits.  |
| 3 | Provide centralized upload tracking        | Dashboard shows every upload job's status across all platforms.      |
| 4 | Be fully open source and self-hostable via Docker for individuals and organizations of any size. | Project can be deployed and run consistently in self-hosted environments. |

---

## 5. User Personas

### Persona 1: "Maya the Creator"

| Attribute    | Detail                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| **Role**     | Independent YouTuber and Vimeo filmmaker                                                                  |
| **Age**      | 27                                                                                                        |
| **Goals**    | Publish a weekly video to YouTube and Vimeo simultaneously with minimal effort.                            |
| **Pains**    | Spends 30+ minutes per video duplicating uploads and re-entering metadata. Frequently forgets to update tags on one platform. |
| **Scenario** | Maya uploads her video to VideoSphere, lets the AI generate metadata, tweaks the description, picks her thumbnail, selects YouTube + Vimeo, and hits "Distribute." Done in under 5 minutes. |

### Persona 2: "Carlos the Marketing Manager"

| Attribute    | Detail                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| **Role**     | Marketing lead at a small business                                                                        |
| **Age**      | 35                                                                                                        |
| **Goals**    | Coordinate weekly product videos across YouTube and Vimeo with consistent branding.                       |
| **Pains**    | Has to log into each platform separately. Different team members sometimes upload with inconsistent titles. |
| **Scenario** | Carlos creates a draft in VideoSphere with the approved title and description, schedules it for Monday 9 AM across both platforms, and lets VideoSphere handle the rest. |

### Persona 3: "Pastor David's Church Media Team"

| Attribute    | Detail                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| **Role**     | Volunteer media coordinator at a local church                                                             |
| **Age**      | 38                                                                                                        |
| **Goals**    | Prepare all video metadata and drafts on Saturday so that Sunday morning can be spent on ministry, not managing uploads. |
| **Pains**    | Sunday mornings are busy; there is no time to sit at a computer entering titles, descriptions, and tags across multiple platforms while services are happening. Volunteers are not always tech-savvy. |
| **Scenario** | On Saturday afternoon, the media team creates a VideoSphere draft, entering the sermon title, description, scripture references as tags, and selecting YouTube and Vimeo as targets. The AI fills in an optimized description. The thumbnail is uploaded. Everything is ready. On Sunday morning, after the service, one volunteer clicks "Upload Video" to attach the recorded sermon file, then clicks "Distribute." VideoSphere handles the rest while the team focuses on people, not platforms. |

---

## 6. Core Workflow

The primary user journey follows this sequence:

```
┌──────────────┐     ┌──────────────────────────────────────────┐     ┌──────────────────┐     ┌────────────────┐
│ 1. Connect   │────▶│ 2. Create Draft                          │────▶│ 3. Upload        │────▶│ 4. Distribute  │
│    Platforms  │     │    (metadata + target platform selection) │     │    Video File    │     │    & Track     │
└──────────────┘     └──────────────────────────────────────────┘     └──────────────────┘     └────────────────┘
 OAuth2 connect       Title, description, tags, thumbnails,            Upload to Cloudflare    VideoSphere uploads
 YouTube, Vimeo,      visibility, per-platform overrides,              R2 as temporary         to each platform
 Facebook +           and which platforms to target — all on           staging storage          via API; user
 SermonAudio API key  the draft edit page (/dashboard/drafts/[id])                              tracks job status
```

### Detailed Flow

1. **Connect Platforms (one-time setup)**
   - User navigates to Settings / Connected Accounts.
   - Clicks "Connect YouTube" → redirected to Google OAuth2 consent screen → grants VideoSphere permission to upload videos on their behalf → redirected back.
   - Repeats OAuth flow for Vimeo and Facebook.
   - For SermonAudio, user enters their SermonAudio API key in Connected Accounts (no OAuth redirect).
   - Connected accounts are stored securely (OAuth tokens and API keys persisted encrypted in MongoDB).

2. **Create Draft with Metadata**
   - User clicks "New Draft" on the Dashboard and is taken to `/dashboard/drafts/[id]`.
   - User enters a default title, description, and tags that apply to all selected platforms.
   - User selects which connected platforms this video should be distributed to (e.g., YouTube + Vimeo + SermonAudio + Facebook) directly on the draft form.
   - Optionally, user clicks "Customize per platform" to override title/description/tags for a specific platform.
   - User selects or uploads a thumbnail per platform.
   - User optionally clicks "Generate with AI" to auto-fill title, description, and tags based on the video file name or a user-provided prompt.
   - User sets visibility per platform (public, unlisted, private).
   - User optionally schedules a publish date/time per platform.
   - Draft is saved to MongoDB and can be returned to later.

3. **Upload Video File**
   - From the draft edit page, user clicks "Upload Video" to navigate to `/dashboard/drafts/[id]/upload`.
   - User selects a video file (max 5 GB) via file picker or drag-and-drop.
   - File is uploaded directly to **Cloudflare R2** as temporary staging storage via a presigned PUT URL.
   - A progress bar shows upload percentage.
   - On success, an **Upload Job** is created and linked to the draft, and the R2 object key is stored.

4. **Distribute & Track**
   - User clicks "Distribute Now".
   - VideoSphere creates a **Platform Upload** record for each target platform under the Upload Job.
   - The server-side process reads the video from R2 and uploads it to each platform's API (YouTube Data API v3, Vimeo API, SermonAudio API, Facebook Graph API).
   - The Dashboard shows real-time job status: `pending → uploading → distributing → completed` (or `failed` with error details).
   - Once all platform uploads complete, the temporary file in R2 is cleaned up (or retained for a configurable period).
   - User receives a notification (in-app) when distribution is complete.

---

## 7. Feature Requirements

### 7.1 Platform Management

**Description:** Users connect and manage their video platform accounts.

| ID     | Requirement                                                                                          | Priority |
| ------ | ---------------------------------------------------------------------------------------------------- | -------- |
| PM-01  | Users can connect their YouTube account via Google OAuth2.                                            | P0       |
| PM-02  | Users can connect their Vimeo account via Vimeo OAuth2.                                               | P0       |
| PM-03  | Users can view all connected platform accounts on a "Connected Accounts" settings page.               | P0       |
| PM-04  | Users can disconnect a platform account at any time.                                                  | P0       |
| PM-05  | OAuth tokens are securely stored in MongoDB (encrypted) and refreshed automatically when expired.    | P0       |
| PM-06  | Users see a clear indicator of connection status (connected / disconnected / token expired) per platform. | P1    |
| PM-07  | Users can connect their SermonAudio account using an API key (not OAuth). The user provides their SermonAudio API key in the Connected Accounts settings page. | P0 |
| PM-08  | Users can connect their Facebook account via Facebook OAuth2 to enable publishing to a Facebook Page or Group. | P0 |
| PM-09  | Users can disconnect SermonAudio or Facebook at any time.                                             | P0       |

---

### 7.2 Video Upload & Storage

**Description:** Users upload video files which are temporarily staged in Cloudflare R2.

| ID     | Requirement                                                                                          | Priority |
| ------ | ---------------------------------------------------------------------------------------------------- | -------- |
| VU-01  | Users can upload video files up to **5 GB** in size.                                                  | P0       |
| VU-02  | Supported formats: MP4, MOV, AVI, MKV, WebM (standard web-compatible video formats).                 | P0       |
| VU-03  | Upload progress is shown as a percentage progress bar with estimated time remaining.                  | P0       |
| VU-04  | Videos are uploaded to **Cloudflare R2** as temporary staging storage.                                | P0       |
| VU-05  | Uploads can be cancelled mid-progress.                                                                | P1       |
| VU-06  | Resumable uploads are supported (if the connection drops, the user can resume).                       | P2       |
| VU-07  | Temporary files in R2 are automatically cleaned up after distribution completes or after 72 hours (whichever comes first). | P1 |
| VU-08  | Users see a file validation error if the file exceeds 5 GB or is an unsupported format before upload begins. | P0   |

---

### 7.3 Draft & Metadata Management

**Description:** Users create and manage metadata drafts before distributing a video.

| ID     | Requirement                                                                                          | Priority |
| ------ | ---------------------------------------------------------------------------------------------------- | -------- |
| DM-01  | Users can create a draft with: title, description, tags, thumbnail, visibility, and target platforms.  | P0       |
| DM-02  | A **default metadata set** (title, description, tags) applies to all selected platforms.               | P0       |
| DM-03  | Users can **override metadata per platform** — e.g., a different description for YouTube vs. Vimeo.   | P1       |
| DM-04  | Users can select or upload a **thumbnail per platform**.                                               | P1       |
| DM-05  | Users can set **visibility per platform**: public, unlisted, or private.                               | P0       |
| DM-06  | Drafts are saved to MongoDB and persist across sessions.                                              | P0       |
| DM-07  | Users can view, edit, and delete saved drafts from the Dashboard.                                     | P0       |
| DM-08  | Draft metadata is validated before distribution (e.g., title required, max character limits per platform). | P1    |
| DM-09  | Tags are stored as an array of strings; the repository layer handles JSON serialization.              | P0       |
| DM-10  | The platform selection list on the draft form shows **only the user's currently connected accounts** — platforms the user has not connected are not shown (or are shown as disabled with a "Connect" link). | P0 |
| DM-11  | Toggling a platform on/off in the draft form **dynamically shows or hides that platform's per-platform fields** (visibility, per-platform metadata overrides). Only fields for selected platforms are saved. | P0 |
| DM-12  | At least one platform must be selected before a draft can be saved or a video can be distributed.    | P0       |

---

### 7.4 Multi-Platform Distribution

**Description:** VideoSphere distributes uploaded videos to selected platforms via their APIs.

| ID     | Requirement                                                                                          | Priority |
| ------ | ---------------------------------------------------------------------------------------------------- | -------- |
| MD-01  | Videos can be distributed to **YouTube** via the YouTube Data API v3.                                 | P0       |
| MD-02  | Videos can be distributed to **Vimeo** via the Vimeo API.                                             | P0       |
| MD-03  | Distribution is initiated from the server side — the video file is read from R2 and streamed to each platform API. | P0 |
| MD-04  | Each platform upload runs as an independent **Upload Job** so that a failure on one platform does not block others. | P0 |
| MD-05  | If a platform upload fails, the user receives an error message with details and can **retry** the failed job. | P0  |
| MD-06  | Upon successful distribution, the platform-specific video URL is saved and displayed to the user.     | P0       |
| MD-07  | Users can distribute to **all connected platforms** per upload.                                | P0       |
| MD-08  | Videos can be distributed to SermonAudio via the SermonAudio API using an API key for authentication. | P0 |
| MD-09  | Videos can be distributed to Facebook (Pages or Groups) via the Facebook Graph API.                  | P0       |

---

### 7.5 Scheduled Publishing (Stretch Goal)

**Description:** Scheduled publishing is explicitly deferred beyond the MVP. The core product flow is: create draft -> upload the source file to Cloudflare R2 -> distribute immediately to the selected platforms -> remove the staged file from R2. A true scheduling feature adds meaningful architecture and product complexity because it would require either keeping staged media in R2 until a future execution time or integrating each platform's native scheduling APIs, which turns the feature into scheduled publishing rather than just delayed distribution.

| ID     | Requirement                                                                                          | Priority |
| ------ | ---------------------------------------------------------------------------------------------------- | -------- |
| SP-01  | If implemented after MVP, users can set a **publish date and time per platform** when creating a draft. | P2       |
| SP-02  | If implemented after MVP, scheduled jobs must either retain the source media in R2 until execution or delegate scheduling to platform-native publishing APIs. | P2       |
| SP-03  | If implemented after MVP, users can view all scheduled uploads in a dedicated management view.       | P2       |
| SP-04  | If implemented after MVP, users can **cancel or reschedule** a pending scheduled publish before it executes. | P2       |
| SP-05  | Timezone is auto-detected from the user's browser but can be manually overridden.                    | P2       |

---

### 7.6 AI-Powered Metadata Generation

**Description:** AI generates optimized video titles, descriptions, and tags to reduce manual effort.

| ID     | Requirement                                                                                          | Priority |
| ------ | ---------------------------------------------------------------------------------------------------- | -------- |
| AI-01  | Users can click **"Generate with AI"** on the draft creation form to auto-fill title, description, and tags. | P0 |
| AI-02  | The AI uses the video filename, any user-provided context/prompt, and selected platform(s) as input.  | P0       |
| AI-03  | Generated metadata is presented in editable fields — the user can accept, edit, or regenerate.        | P0       |
| AI-06  | AI generation respects platform-specific character limits (e.g., YouTube title max 100 chars, description max 5,000 chars). | P1 |
| AI-07  | If per-platform metadata customization is enabled, the AI generates platform-optimized variants (e.g., different tag styles for YouTube vs. Vimeo). | P2 |
| AI-08  | AI requests are routed through **OpenRouter** to access multiple models via a single API.             | P0       |

---

### 7.7 User Authentication & Account Management

**Description:** Users create accounts, sign in, and manage their profiles.

| ID     | Requirement                                                                                          | Priority |
| ------ | ---------------------------------------------------------------------------------------------------- | -------- |
| UA-01  | Users can register with **email and password** via the application's authentication layer.            | P0       |
| UA-02  | Users can sign in with **Google OAuth** via the application's authentication layer.                   | P0       |
| UA-03  | Users can log out; session is cleared.                                                                | P0       |
| UA-04  | Authenticated state persists across page loads (session cookies).                                     | P0       |
| UA-05  | Unauthenticated users are redirected to `/login` when accessing protected routes.                    | P0       |
| UA-06  | Route protection is implemented via `proxy.ts` (server-side) — client-side checks alone are insufficient. | P0 |
| UA-07  | Users can view and edit their profile (name, email) on the `/profile` page.                          | P1       |
| UA-09  | New users are assigned the `user` role by default. The `admin` role is assigned manually or via the admin dashboard. | P0 |

---

### 7.9 Admin Dashboard

**Description:** A protected admin area for application management.

| ID     | Requirement                                                                                          | Priority |
| ------ | ---------------------------------------------------------------------------------------------------- | -------- |
| AD-01  | The `/admin/dashboard` route is accessible **only** to users with `role: 'admin'`.                   | P0       |
| AD-02  | Route protection is enforced in `proxy.ts` (server-side) — not just client-side checks.          | P0       |
| AD-03  | Regular users navigating to `/admin/dashboard` receive a 403 Forbidden or are redirected.             | P0       |
| AD-04  | The admin dashboard displays a **user table** with: email, role, account status, created date.        | P0       |
| AD-05  | The admin dashboard displays **system health information**: total users, total uploads, recent errors. | P1       |
| AD-06  | The admin dashboard displays an **error log** of recent failed upload jobs with details.               | P1       |
| AD-07  | Admin can view high-level stats: total users, connected accounts, uploads this month, and active drafts. | P0     |

---

### 7.10 Upload Job Tracking

**Description:** Users track the status of their video distributions in real time.

| ID     | Requirement                                                                                          | Priority |
| ------ | ---------------------------------------------------------------------------------------------------- | -------- |
| JT-01  | Each distribution to a platform creates a separate **Upload Job** record in MongoDB.                  | P0       |
| JT-02  | Upload Job statuses: `pending`, `uploading`, `distributing`, `completed`, `failed`.                   | P0       |
| JT-03  | The Dashboard shows a list of all upload jobs for the current user, sorted by most recent.            | P0       |
| JT-04  | Each job shows: video title, target platform, status, timestamps, and error message (if failed).      | P0       |
| JT-05  | Completed jobs show the **direct link** to the video on the target platform.                          | P0       |
| JT-06  | Users can **retry** a failed upload job.                                                              | P0       |
| JT-07  | Job status updates are reflected in the UI without requiring a full page refresh (polling or real-time). | P1     |

---

## 8. Information Architecture & Page Map

```
/                           Landing page (marketing)
/pricing                    Platform overview and distribution capabilities
/login                      Sign in (email/password, Google OAuth, GitHub OAuth)
/signup                     Create account
/dashboard                  Main user dashboard (upload jobs, drafts, quick actions)
/dashboard/drafts           List of saved drafts
/dashboard/drafts/[id]      Edit a specific draft
/dashboard/drafts/[id]/upload Upload entrypoint for a draft (upload → distribute flow)
/dashboard/history          Completed and failed upload history
/profile                    User profile, account status, connected accounts
/profile/connections        Manage connected platform accounts (OAuth)
/admin/dashboard            Admin-only: user management, stats, error logs
/api/health                 Health check endpoint
/api/auth/*                 Auth-related API routes
/api/uploads/*              Upload and distribution API routes
/api/drafts/*               Draft CRUD API routes
/api/ai/generate-metadata   AI metadata generation endpoint
```

---

## 9. Data Model

### Entities

The data model builds on the types already defined in `types/index.ts`:

#### User (MongoDB `user_profiles` collection)

| Field         | Type       | Description                                |
| ------------- | ---------- | ------------------------------------------ |
| `userId`      | `string`   | Primary key; matches the application's authentication-layer user ID |
| `email`       | `string`   | User's email address                       |
| `role`        | `UserRole` | `'user'` or `'admin'`                      |
| `createdAt`   | `string`   | ISO 8601 timestamp                         |
| `updatedAt`   | `string`   | ISO 8601 timestamp                         |

#### Draft (MongoDB `drafts` collection)

| Field         | Type       | Description                                                    |
| ------------- | ---------- | -------------------------------------------------------------- |
| `id`          | `string`   | Primary key                                                    |
| `userId`      | `string`   | Foreign key → User                                             |
| `title`       | `string`   | Default video title                                            |
| `description` | `string`   | Default video description                                      |
| `tags`        | `string[]` | Tags (stored as JSON string in MongoDB; parsed in repository) |
| `createdAt`   | `string`   | ISO 8601 timestamp                                             |
| `updatedAt`   | `string`   | ISO 8601 timestamp                                             |

#### Upload Job (MongoDB `upload_jobs` collection)

| Field          | Type              | Description                                            |
| -------------- | ----------------- | ------------------------------------------------------ |
| `id`           | `string`          | Primary key                                            |
| `userId`       | `string`          | Foreign key → User                                     |
| `draftId`      | `string \| null`  | Foreign key → Draft (nullable)                         |
| `status`       | `UploadJobStatus` | `pending`, `uploading`, `distributing`, `completed`, `failed` |
| `errorMessage` | `string \| null`  | Error details if status is `failed`                    |
| `createdAt`    | `string`          | ISO 8601 timestamp                                     |
| `updatedAt`    | `string`          | ISO 8601 timestamp                                     |

#### Connected Account (new — MongoDB `connected_accounts` collection)

| Field           | Type     | Description                                             |
| --------------- | -------- | ------------------------------------------------------- |
| `id`            | `string` | Primary key                                             |
| `userId`        | `string` | Foreign key → User                                      |
| `platform`      | `string` | `'youtube'` or `'vimeo'`                                |
| `accessToken`   | `string` | Encrypted OAuth2 access token                           |
| `refreshToken`  | `string` | Encrypted OAuth2 refresh token                          |
| `tokenExpiry`   | `string` | ISO 8601 timestamp of token expiration                  |
| `platformUserId`| `string` | User's ID on the connected platform                     |
| `platformName`  | `string` | Display name from the platform (e.g., channel name)     |
| `createdAt`     | `string` | ISO 8601 timestamp                                      |
| `updatedAt`     | `string` | ISO 8601 timestamp                                      |

#### Platform Upload (new — MongoDB `platform_uploads` collection)

| Field            | Type     | Description                                          |
| ---------------- | -------- | ---------------------------------------------------- |
| `id`             | `string` | Primary key                                          |
| `uploadJobId`    | `string` | Foreign key → Upload Job                             |
| `platform`       | `string` | `'youtube'` or `'vimeo'`                             |
| `status`         | `string` | `pending`, `uploading`, `completed`, `failed`        |
| `platformVideoId`| `string` | Video ID on the target platform (set on completion)  |
| `platformUrl`    | `string` | Direct URL to the video on the platform              |
| `title`          | `string` | Title used for this platform (may differ from draft) |
| `description`    | `string` | Description used for this platform                   |
| `tags`           | `string` | Tags used for this platform (JSON string)            |
| `visibility`     | `string` | `'public'`, `'unlisted'`, or `'private'`             |
| `scheduledAt`    | `string \| null` | Reserved for a future scheduling workflow; `null` for the MVP immediate-distribution flow |
| `errorMessage`   | `string \| null` | Error details if failed                        |
| `createdAt`      | `string` | ISO 8601 timestamp                                   |
| `updatedAt`      | `string` | ISO 8601 timestamp                                   |

### Entity Relationship Diagram

```
┌──────────┐       ┌──────────────────┐
│   User   │──1:N──│  Connected       │
│          │       │  Account         │
│          │──1:N──│                  │
│          │       └──────────────────┘
│          │
│          │──1:N──┌──────────┐
│          │       │  Draft   │
│          │       └──────────┘
│          │              │
│          │        (0..1 : N)
│          │              │
│          │──1:N──┌──────────────┐──1:N──┌──────────────────┐
│          │       │  Upload Job  │       │  Platform Upload  │
└──────────┘       └──────────────┘       └──────────────────┘
```

---

## 10. API Design

All API routes follow Next.js App Router **Route Handlers** (`app/api/`).

### Authentication Routes

| Method | Endpoint                   | Description                        | Auth Required |
| ------ | -------------------------- | ---------------------------------- | ------------- |
| POST   | `/api/auth/register`       | Create new user account            | No            |
| POST   | `/api/auth/login`          | Sign in with email/password        | No            |
| POST   | `/api/auth/logout`         | Destroy session                    | Yes           |
| GET    | `/api/auth/session`        | Get current session/user           | Yes           |
| GET    | `/api/auth/oauth/google`   | Initiate Google OAuth flow         | No            |
| GET    | `/api/auth/callback`       | OAuth callback handler             | No            |

### Platform Connection Routes

| Method | Endpoint                            | Description                            | Auth Required |
| ------ | ----------------------------------- | -------------------------------------- | ------------- |
| GET    | `/api/platforms/connect/youtube`    | Initiate YouTube OAuth2 flow           | Yes           |
| GET    | `/api/platforms/connect/vimeo`      | Initiate Vimeo OAuth2 flow             | Yes           |
| POST   | `/api/platforms/connect/sermonaudio`| Save SermonAudio API key for the user  | Yes           |
| GET    | `/api/platforms/connect/facebook`   | Initiate Facebook OAuth2 flow          | Yes           |
| GET    | `/api/platforms/callback/youtube`   | YouTube OAuth2 callback                | Yes           |
| GET    | `/api/platforms/callback/drive`     | Google Drive OAuth2 callback           | Yes           |
| GET    | `/api/platforms/callback/vimeo`     | Vimeo OAuth2 callback                  | Yes           |
| GET    | `/api/platforms/callback/facebook`  | Facebook OAuth2 callback               | Yes           |
| GET    | `/api/platforms/connections`        | List user's connected accounts         | Yes           |
| DELETE | `/api/platforms/connections/[id]`   | Disconnect a platform account          | Yes           |

### Draft Routes

| Method | Endpoint                   | Description                        | Auth Required |
| ------ | -------------------------- | ---------------------------------- | ------------- |
| POST   | `/api/drafts`              | Create a new draft                 | Yes           |
| GET    | `/api/drafts`              | List user's drafts                 | Yes           |
| GET    | `/api/drafts/[id]`         | Get a specific draft               | Yes           |
| PATCH  | `/api/drafts/[id]`         | Update a draft                     | Yes           |
| DELETE | `/api/drafts/[id]`         | Delete a draft                     | Yes           |

### Upload & Distribution Routes

| Method | Endpoint                        | Description                             | Auth Required |
| ------ | ------------------------------- | --------------------------------------- | ------------- |
| POST   | `/api/uploads/presign`          | Get a presigned R2 upload URL           | Yes           |
| POST   | `/api/uploads/distribute`       | Initiate distribution to platforms      | Yes           |
| GET    | `/api/uploads/jobs`             | List user's upload jobs                 | Yes           |
| GET    | `/api/uploads/jobs/[id]`        | Get a specific upload job with platform details | Yes   |
| POST   | `/api/uploads/jobs/[id]/retry`  | Retry a failed platform upload          | Yes           |
| GET    | `/api/uploads/usage`            | Get upload usage analytics                          | Yes |

### AI Routes

| Method | Endpoint                        | Description                             | Auth Required |
| ------ | ------------------------------- | --------------------------------------- | ------------- |
| POST   | `/api/ai/generate-metadata`     | Generate title, description, and tags   | Yes           |

### Admin Routes

| Method | Endpoint                   | Description                        | Auth Required |
| ------ | -------------------------- | ---------------------------------- | ------------- |
| GET    | `/api/admin/users`         | List all users (paginated)         | Admin only    |
| GET    | `/api/admin/stats`         | Get system-wide statistics         | Admin only    |
| GET    | `/api/admin/errors`        | Get recent error logs              | Admin only    |

### Utility Routes

| Method | Endpoint            | Description          | Auth Required |
| ------ | ------------------- | -------------------- | ------------- |
| GET    | `/api/health`       | Health check         | No            |

---

## 11. Non-Functional Requirements

### Performance

| ID    | Requirement                                                                                  |
| ----- | -------------------------------------------------------------------------------------------- |
| NF-01 | Pages load in under 3 seconds on a standard broadband connection.                            |
| NF-02 | Video upload to R2 saturates the user's available bandwidth (no artificial throttling).       |
| NF-03 | AI metadata generation responds within 10 seconds.                                           |
| NF-04 | The Dashboard renders up to 100 upload jobs without pagination lag.                          |

### Security

| ID    | Requirement                                                                                  |
| ----- | -------------------------------------------------------------------------------------------- |
| NF-05 | OAuth2 tokens for connected platforms are encrypted at rest in MongoDB.                      |
| NF-07 | All API routes validate input using Zod schemas; reject malformed requests with 400 errors.  |
| NF-08 | Presigned R2 URLs expire within 15 minutes to prevent unauthorized access.                   |
| NF-09 | Rate limiting on auth endpoints and AI generation endpoint to prevent abuse.                 |
| NF-10 | Server-side route protection via `proxy.ts` for all protected routes.                   |

### Reliability

| ID    | Requirement                                                                                  |
| ----- | -------------------------------------------------------------------------------------------- |
| NF-11 | A failed distribution to one platform does not block or cancel distribution to other platforms. |
| NF-12 | Failed uploads can be retried without re-uploading the video file (R2 file retention: 72 hours). |
| NF-13 | The health check endpoint (`/api/health`) returns 200 if the app and database are reachable.  |

### Scalability

| ID    | Requirement                                                                                  |
| ----- | -------------------------------------------------------------------------------------------- |
| NF-14 | The architecture supports adding new video platforms without architectural changes (new platform = new adapter module). |
| NF-15 | Video distribution jobs run asynchronously and do not block the user's HTTP request.          |

### Accessibility

| ID    | Requirement                                                                                  |
| ----- | -------------------------------------------------------------------------------------------- |
| NF-16 | All pages meet WCAG 2.1 Level AA compliance.                                                 |
| NF-17 | All interactive elements are keyboard-navigable.                                              |
| NF-18 | Colour contrast meets 4.5:1 for normal text, 3:1 for large text.                            |

### Responsive Design

| ID    | Requirement                                                                                  |
| ----- | -------------------------------------------------------------------------------------------- |
| NF-19 | All pages are usable on mobile (≥320px), tablet (≥768px), and desktop (≥1024px).             |
| NF-20 | Navigation adapts to small screens (mobile hamburger menu or drawer).                        |

### Containerization

| ID    | Requirement                                                                                  |
| ----- | -------------------------------------------------------------------------------------------- |
| NF-21 | The application is containerized with **Docker** using the existing `Dockerfile` and `docker-compose.yml`. |
| NF-22 | `docker-compose up` brings up the full application stack (Next.js + MongoDB) for local development and self-hosted production use. |
| NF-23 | The application is configurable entirely through environment variables — no hardcoded secrets or deployment-specific values. (Priority: P0) |
| NF-24 | A public Docker image is published so that self-hosters can deploy without building from source. (Priority: P1) |

---

## 12. Tech Stack & Architecture

### Frontend

| Technology       | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| **Next.js 16**   | React framework with App Router, SSR, API routes |
| **React 19**     | UI component library                           |
| **TypeScript**   | Static type safety                             |
| **Tailwind CSS 4** | Utility-first styling                       |
| **shadcn/ui**    | Pre-built accessible UI components             |

### Backend

| Technology        | Purpose                                       |
| ----------------- | --------------------------------------------- |
| **MongoDB**       | Primary database for users, drafts, upload jobs, and connected accounts. |
| **Cloudflare R2** | Temporary video file storage (S3-compatible)  |
| **OpenRouter**    | AI model proxy (access multiple LLMs via one API) |

### Platform APIs

| Platform    | API                     | Purpose                        |
| ----------- | ----------------------- | ------------------------------ |
| **YouTube** | YouTube Data API v3     | Video upload and metadata      |
| **Vimeo**   | Vimeo API               | Video upload and metadata      |
| **SermonAudio** | SermonAudio API      | Video upload and metadata (API key auth) |
| **Facebook** | Facebook Graph API     | Video upload to Pages/Groups (OAuth2) |

### DevOps

| Technology        | Purpose                                       |
| ----------------- | --------------------------------------------- |
| **Docker**        | Containerized application; enables self-hosted deployment. |
| **Docker Compose**| Local development stack                       |
| **GitHub Actions**| CI pipeline (lint, format, type-check, build) |
| **Husky**         | Git hooks (pre-commit linting)                |
| **Commitlint**    | Conventional Commits enforcement              |

### Testing

| Technology        | Purpose                                       |
| ----------------- | --------------------------------------------- |
| **Vitest**        | Unit and integration test runner              |
| **React Testing Library** | Component testing                    |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                            │
│  Next.js App Router — React 19 — shadcn/ui — Tailwind CSS 4       │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────┐  │
│  │ Dashboard  │ │ Upload    │ │ Drafts    │ │ Profile/Settings  │  │
│  │ (jobs,     │ │ Flow      │ │ Editor    │ │ (connections,     │  │
│  │  history)  │ │           │ │           │ │  subscription)    │  │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └────────┬──────────┘  │
│        │              │             │                │              │
└────────┼──────────────┼─────────────┼────────────────┼──────────────┘
         │              │             │                │
         ▼              ▼             ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    NEXT.JS API ROUTES (Server)                      │
│  ┌──────────┐ ┌──────────────┐ ┌───────────┐ ┌──────────────────┐  │
│  │ /api/     │ │ /api/uploads │ │ /api/     │ │ /api/ai/         │  │
│  │ auth/*    │ │ /distribute  │ │ drafts/*  │ │ generate-metadata│  │
│  └────┬─────┘ └──────┬───────┘ └─────┬─────┘ └────────┬─────────┘  │
│       │              │               │                │              │
│  ┌────┴─────┐   ┌────┴────────────┐  │          ┌─────┴──────────┐  │
│  │proxy.ts  │   │ Distribution     │  │          │ OpenRouter     │  │
│  │(route    │   │ Engine           │  │          │ API Client     │  │
│  │ protect) │   │ ┌─────────────────┐ │  │          └────────────────┘  │
│  │          │   │ │ YouTube Adapter │ │  │                            │
│  └──────────┘   │ │ Vimeo Adapter   │ │  │                            │
│                 │ │ SermonAudio     │ │  │                            │
│                 │ │ Adapter         │ │  │                            │
│                 │ │ Facebook Adapter│ │  │                            │
│                 │ └─────────────────┘ │  │                            │
│                 └────────┬─────────┘  │                            │
└──────────────────────────┼────────────┼────────────────────────────┘
                           │            │
              ┌────────────┼────────────┼────────────────┐
              │            ▼            ▼                │
              │  ┌──────────────┐ ┌──────────────┐      │
              │  │ Cloudflare   │ │  MongoDB     │      │
              │  │ R2 (temp     │ │  (users,     │      │
              │  │  video       │ │   drafts,    │      │
              │  │  storage)    │ │   jobs,      │      │
              │  └──────────────┘ │   tokens)    │      │
              │                   └──────────────┘      │
              │                                         │
              │  ┌──────────────┐ ┌──────────────┐      │
              │  │ YouTube      │ │ Vimeo        │      │
              │  │ Data API v3  │ │ API          │      │
              │  └──────────────┘ └──────────────┘      │
              │  ┌──────────────┐ ┌──────────────┐      │
              │  │ SermonAudio  │ │ Facebook     │      │
              │  │ API          │ │ Graph API    │      │
              │  └──────────────┘ └──────────────┘      │
              └─────────────────────────────────────────┘
```

---

## 13. Third-Party Integrations

| Service          | Purpose                              | Integration Method           | Key Actions                                      |
| ---------------- | ------------------------------------ | ----------------------------- | ------------------------------------------------ |
| **MongoDB**      | Primary database                     | Mongoose / MongoDB Node.js driver | CRUD operations on all collections.            |
| **Cloudflare R2**| Temporary video storage              | S3-compatible SDK (`@aws-sdk/client-s3`) | Presigned upload URLs, GET, DELETE objects |
| **YouTube**      | Video distribution                   | YouTube Data API v3            | `videos.insert`, `videos.update`                  |
| **Vimeo**        | Video distribution                   | Vimeo API (`vimeo` npm)       | Upload video, set metadata                        |
| **SermonAudio**  | Video distribution for faith-based audiences | SermonAudio REST API (API key) | Upload sermon video, set metadata                 |
| **Facebook**     | Video distribution to Pages/Groups   | Facebook Graph API (OAuth2)    | Upload video, set title, description, visibility  |
| **OpenRouter**   | AI model access                      | REST API / Vercel AI SDK       | Chat completions for metadata generation          |
| **Google OAuth2**| User sign-in                         | OAuth2 provider integration    | Sign in with Google                               |


---

## 15. User Stories

### Epic 1: Platform Connection

| ID   | Story                                                                                             | Acceptance Criteria                                                |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| US-01 | As a user, I want to connect my YouTube account so that VideoSphere can upload videos on my behalf. | OAuth2 flow completes; account appears in Connected Accounts list. |
| US-02 | As a user, I want to connect my Vimeo account so that I can distribute videos to Vimeo.            | OAuth2 flow completes; account appears in Connected Accounts list. |
| US-02b | As a church media coordinator, I want to connect my SermonAudio account using my API key so that VideoSphere can upload sermons on my behalf. | API key is saved securely; SermonAudio appears in Connected Accounts. |
| US-02c | As a user, I want to connect my Facebook account so that I can distribute videos to my Facebook Page or Group. | OAuth2 flow completes; Facebook account appears in Connected Accounts list. |
| US-03 | As a user, I want to disconnect a platform account so that VideoSphere can no longer access it.     | Account is removed; tokens are deleted from MongoDB.               |
| US-04 | As a user, I want to see which accounts are connected and their status.                            | Connected Accounts page shows each account with status indicator.  |

### Epic 2: Video Upload & Distribution

| ID   | Story                                                                                             | Acceptance Criteria                                                |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| US-05 | As a user, I want to upload a video file so that I can distribute it to my connected platforms.     | File uploads to R2; progress bar shows percentage; file reference saved. |
| US-06 | As a user, I want to select which platforms to distribute my video to.                             | Platform selection UI shows only connected platforms; selection saved to draft. |
| US-07 | As a user, I want to enter metadata (title, description, tags) for my video.                       | Draft form saves metadata to MongoDB; all fields editable.          |
| US-08 | As a user, I want to distribute my video to all selected platforms with one click.                 | Upload jobs created per platform; status visible on Dashboard.       |
| US-09 | As a user, I want to see the status of each platform upload in real time.                          | Dashboard shows per-platform status: pending → uploading → completed/failed. |
| US-10 | As a user, I want to retry a failed upload without re-uploading the video file.                    | Retry button re-initiates distribution from R2 to the failed platform. |
| US-11 | As a user, I want to see the direct link to my video on each platform after successful upload.     | Completed jobs display clickable platform video URL.                |

### Epic 3: Draft Management

| ID   | Story                                                                                             | Acceptance Criteria                                                |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| US-12 | As a user, I want to save a draft so that I can come back and finish it later.                     | Draft persists in MongoDB; appears in drafts list.                  |
| US-13 | As a user, I want to customize metadata per platform so that each platform gets optimized content.  | Per-platform override fields available; overrides saved to draft.   |
| US-14 | As a user, I want to select a thumbnail per platform.                                              | Thumbnail upload/selection per platform; stored with draft.         |
| US-15 | As a user, I want to set visibility (public/unlisted/private) per platform.                        | Visibility dropdown per platform; applied during distribution.      |

### Epic 4: AI Metadata Generation

| ID   | Story                                                                                             | Acceptance Criteria                                                |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| US-16 | As a user, I want AI to generate a title, description, and tags for my video.                     | Clicking "Generate with AI" fills all metadata fields with AI-generated content. |
| US-17 | As a user, I want to edit AI-generated metadata before publishing.                                | AI output populates editable fields; user can modify freely.        |
| US-18 | As a user, I want fast AI metadata generation for quick drafting.                                  | AI requests can use a latency-optimized model profile via OpenRouter. |
| US-19 | As a user, I want higher-quality AI-generated metadata when needed.                                | AI requests can use a higher-quality model profile for improved output. |

### Epic 6: Authentication & Account

| ID   | Story                                                                                             | Acceptance Criteria                                                |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| US-23 | As a visitor, I want to create an account with my email to start using VideoSphere.                | Registration form creates user record in MongoDB; user redirected to dashboard. |
| US-24 | As a visitor, I want to sign in with Google so I don't need to remember another password.          | Google OAuth flow completes; session established; redirected to dashboard. |
| US-25 | As a visitor, I want to sign in with GitHub for a quick login.                                    | GitHub OAuth flow completes; session established; redirected to dashboard. |
| US-26 | As a user, I want to log out so that my session is secure.                                        | Session destroyed; redirected to landing page.                      |
| US-27 | As a user, I want to view my profile and account status.                                          | Profile page shows name, email, role, and account connection status. |

### Epic 8: Admin

| ID   | Story                                                                                             | Acceptance Criteria                                                |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| US-31 | As an admin, I want to view all users with their account status.                                  | Admin user table with email, role, account status, created date.    |
| US-32 | As an admin, I want to see system health stats (total users, uploads, errors).                    | Stats cards on admin dashboard with real data from MongoDB.         |
| US-33 | As an admin, I want to view recent failed upload errors with details.                             | Error log table with job ID, user, platform, error message, timestamp.|
| US-34 | As a regular user, I must not be able to access the admin dashboard.                              | Navigating to `/admin/dashboard` returns 403 or redirects to dashboard. |

---

## 17. Risks & Mitigations

| # | Risk                                                      | Impact | Probability | Mitigation                                                                                   |
|---|-----------------------------------------------------------|--------|-------------|----------------------------------------------------------------------------------------------|
| 1 | **YouTube/Vimeo API rate limits** block bulk uploads       | High   | Medium      | Implement exponential backoff and retry logic; queue jobs; respect API quotas.                |
| 2 | **OAuth token expiry** during long-running uploads         | High   | High        | Implement automatic token refresh before each API call; store refresh tokens securely.        |
| 3 | **Large file uploads (5 GB)** time out or fail mid-transfer| High   | Medium      | Use multipart/resumable uploads to R2; implement chunked upload progress tracking.            |
| 4 | **Cloudflare R2 storage costs** grow with uncleaned files  | Medium | Medium      | Enforce 72-hour TTL cleanup; delete temp files immediately after successful distribution.     |
| 5 | **YouTube API quota** (10,000 units/day default) exhausted | High   | Low         | Monitor quota usage; warn users when approaching limits; apply for higher quota if needed.    |
| 6 | **AI API downtime** prevents metadata generation           | Low    | Low         | Metadata generation is optional; users can always enter metadata manually. Show graceful error.|
| 7 | **Docker/MongoDB setup** issues slow onboarding            | Medium | Medium      | Detailed SETUP.md; Dev Container as fallback; team support during first day.                  |

---

## 18. Success Metrics

| Metric                                      | Target                                   |
| ------------------------------------------- | ---------------------------------------- |
| Core workflow implemented end-to-end        | Upload to distribution works for YouTube and Vimeo |
| AI metadata generation functional            | Returns usable results within 10 seconds |
| Admin dashboard shows real data              | User table + stats populated             |
| All CI checks passing                        | Lint, format, type-check, build          |
| Application runs in Docker                   | `docker-compose up` brings up full stack |
| Responsive on mobile, tablet, desktop        | No layout breaks at any common viewport  |

### Quality Indicators

| Metric                          | Target              |
| ------------------------------- | ------------------- |
| Zero ESLint errors              | Enforced by CI      |
| Zero TypeScript errors          | Enforced by CI      |
| Consistent code formatting      | Enforced by Prettier|
| Conventional commits on all PRs | Enforced by commitlint |
| Code review on all PRs          | Required by branch protection |

---

## 19. Development Model

Development follows an iterative, open-source contribution model. See the project's GitHub Issues and Milestones for current priorities.

---

## 20. Glossary

| Term                  | Definition                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| **Distribution**      | The process of uploading a video from VideoSphere's temporary storage to one or more external video platforms. |
| **Draft**             | A saved set of video metadata (title, description, tags, platforms, visibility) before distribution.  |
| **OAuth2**            | An authorization framework that allows third-party applications to access user resources without exposing credentials. |
| **OpenRouter**        | An API proxy that provides access to multiple AI language models through a single endpoint.           |
| **Platform Adapter**  | A module in VideoSphere's distribution engine that implements the upload logic for a specific platform (e.g., YouTube adapter, Vimeo adapter). |
| **Presigned URL**     | A time-limited URL that grants temporary permission to upload or download a specific object from cloud storage. |
| **R2**                | Cloudflare's S3-compatible object storage service used as temporary video staging.                    |
| **SermonAudio**       | A platform for hosting and distributing sermons and religious content, widely used by churches and ministries. VideoSphere connects via API key rather than OAuth. |
| **Upload Job**        | A record tracking the status of distributing a single video to a single platform.                     |

---

## 21. Open Source & Self-Hosting

VideoSphere is released as open source software. The project welcomes contributions from the community.

### Self-Hosting

VideoSphere is designed to run as a Docker container. A `docker-compose.yml` is included for both local development and production self-hosting. The full stack (Next.js application + MongoDB) can be brought up with a single command.

**Minimum self-hosting requirements:**

- Docker and Docker Compose
- A Cloudflare R2 bucket (for temporary video staging)
- API credentials for the platforms you wish to distribute to (YouTube, Vimeo, SermonAudio, Facebook)
- An OpenRouter API key (for AI metadata generation)

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines, branching strategy, and coding standards.

### License

This project is open source. See the LICENSE file for details.

---

*This PRD defines the product scope for VideoSphere. Implementation decisions beyond what is specified here are at the contributor's discretion.*
