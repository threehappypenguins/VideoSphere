# VideoSphere — Development Roadmap

> A sprint-by-sprint breakdown of every task needed to build VideoSphere.
> Each section maps to a GitHub issue — copy them directly into your repo using the **Feature Request** or **Sprint Task** issue templates.

---

## How to Use This Document

1. **Create GitHub Issues**: Each numbered item below is a standalone issue. Use the template type indicated (`[FEATURE]` or `[TASK]`).
2. **Assign to sprints**: Sprints follow the PRD timeline. Set the `Sprint #` field when creating the issue.
3. **Track on the project board**: Move issues through `To Do → In Progress → In Review → Done`.
4. **Dependencies**: Issues marked with ⚠️ depend on earlier issues — check the "Depends on" note before starting.
5. **Priority key**: P0 = must have for MVP · P1 = important · P2 = nice-to-have / stretch

---

## Sprint 0 — Project Setup & Team Alignment (Mar 2)

### Issue #1 · `[TASK]` Complete First-Run Setup for All Team Members

**Task Description:** Every team member follows the `SETUP.md` guide end-to-end: clone, `pnpm install`, set up Appwrite via Docker, copy `.env.example`, run `pnpm run setup:appwrite`, and verify the dev server starts.

**Sprint:** 0

**Size Estimate:** S (small — a few hours)

**Acceptance Criteria:**

- [ ] Every team member can run `pnpm dev` and see the app at `localhost:3000`
- [ ] Appwrite console is accessible at the configured endpoint
- [ ] `.env.local` contains valid `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, and `APPWRITE_API_KEY`
- [ ] `pnpm run setup:appwrite` completes without errors (collections created)

**Related Feature / Epic:** Project Setup

---

### ✅ Issue #2 · `[TASK]` Set Up GitHub Projects Board & Labels

**Task Description:** Create a GitHub Projects board (Kanban) with columns: `Backlog`, `To Do`, `In Progress`, `In Review`, `Done`. Add labels matching priorities (`P0`, `P1`, `P2`), feature areas (`auth`, `upload`, `distribution`, `ai`, `payments`, `admin`, `ui`), and issue types (`bug`, `enhancement`, `sprint-task`).

**Sprint:** 0

**Size Estimate:** S (small — a few hours)

**Acceptance Criteria:**

- [x] GitHub Projects board exists with all columns
- [x] Labels created for priority, feature area, and type
- [x] All team members have access to the board

**Related Feature / Epic:** Project Setup

---

### ✅ Issue #3 · `[TASK]` Review PRD & Assign Sprint 1 Issues

**Task Description:** Team reviews the PRD together, discusses architecture decisions, and assigns Sprint 1 issues to team members.

**Sprint:** 0

**Size Estimate:** S (small — a few hours)

**Acceptance Criteria:**

- [x] All team members have read the PRD
- [x] Sprint 1 issues are created on the board
- [x] Each Sprint 1 issue has an assignee

**Related Feature / Epic:** Project Setup

---

## Sprint 1 — Authentication & Appwrite (Mar 2–4)

### ✅ Issue #4 · `[FEATURE]` Email/Password Registration

**User Story:** As a visitor, I want to create an account with my email and password so that I can start using VideoSphere.

**Acceptance Criteria:**

- [x] `/signup` page renders a registration form with email, password, and confirm password fields
- [x] Form validates input client-side (valid email, password min length, passwords match)
- [x] Submitting the form calls `POST /api/auth/register` which creates an Appwrite Auth user
- [x] A `user_profiles` document is created with `role: 'user'` and `isSupporter: false`
- [x] On success, user is redirected to `/dashboard`
- [x] On failure, an error message is displayed (e.g., "Email already registered")

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: UA-01, US-23. Uses Appwrite Auth SDK. The `user_profiles` collection should already exist from `setup:appwrite`.

---

### ✅ Issue #5 · `[FEATURE]` Email/Password Login

**User Story:** As a registered user, I want to sign in with my email and password so that I can access my dashboard.

**Acceptance Criteria:**

- [x] `/login` page renders a login form with email and password fields
- [x] Submitting the form calls `POST /api/auth/login` which creates an Appwrite session
- [x] On success, user is redirected to `/dashboard`
- [x] On failure, an error message is displayed (e.g., "Invalid credentials")
- [x] A "Don't have an account? Sign up" link navigates to `/signup`

**Priority:** P0 (High)

**T-Shirt Size Estimate:** S (small — a few hours)

**Additional Context:** PRD ref: UA-01. Pair with Issue #4.

---

### ✅ Issue #6 · `[FEATURE]` Google OAuth Login

**User Story:** As a visitor, I want to sign in with Google so I don't need to remember another password.

**Acceptance Criteria:**

- [x] `/login` page has a "Sign in with Google" button
- [x] Clicking the button initiates the Google OAuth flow via Appwrite
- [x] On successful consent, user is redirected back and a session is created
- [x] If the user is new, a `user_profiles` document is created automatically
- [x] On failure, user sees an error message

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD ref: UA-02, US-24. Requires Google OAuth provider configured in Appwrite Console.

---

<!--
WAS SUGGESTED BY CLAUDE BUT COMMENTED OUT BECAUSE ESTIMATED USERS ARE NON TECHNICAL
### Issue #7 · `[FEATURE]` GitHub OAuth Login

**User Story:** As a visitor, I want to sign in with GitHub for a quick login.

**Acceptance Criteria:**

- [ ] `/login` page has a "Sign in with GitHub" button
- [ ] Clicking the button initiates the GitHub OAuth flow via Appwrite
- [ ] On successful consent, user is redirected back and a session is created
- [ ] If the user is new, a `user_profiles` document is created automatically
- [ ] On failure, user sees an error message

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD ref: UA-03, US-25. Requires GitHub OAuth provider configured in Appwrite Console. -->

---

### ✅ Issue #8 · `[FEATURE]` Logout Functionality

**User Story:** As a user, I want to log out so that my session is secure on shared devices.

**Acceptance Criteria:**

- [x] A "Log out" button is visible in the Navbar when the user is authenticated
- [x] Clicking "Log out" calls `POST /api/auth/logout` which destroys the Appwrite session
- [x] User is redirected to `/` (landing page)
- [x] Attempting to visit `/dashboard` after logout redirects to `/login`

**Priority:** P0 (High)

**T-Shirt Size Estimate:** S (small — a few hours)

**Additional Context:** PRD ref: UA-04, US-26.

---

### ✅ Issue #9 · `[FEATURE]` Session Persistence & Auth State

**User Story:** As a user, I want to stay logged in when I refresh the page so I don't have to sign in every time.

**Acceptance Criteria:**

- [x] `GET /api/auth/session` returns the current user's session data if authenticated
- [x] The Navbar displays the user's name/email when logged in
- [x] The Navbar shows "Login / Sign up" buttons when not logged in
- [x] Session persists across page refreshes (Appwrite session cookie)

**Priority:** P0 (High)

**T-Shirt Size Estimate:** S (small — a few hours)

**Additional Context:** PRD ref: UA-05.

---

### ✅ Issue #10 · `[TASK]` Server-Side Route Protection (proxy.ts)

**Task Description:** Implement `proxy.ts` at the project root to protect authenticated and admin routes server-side. Unauthenticated users hitting `/dashboard/*`, `/profile/*`, or `/admin/*` must be redirected to `/login`. Non-admin users hitting `/admin/*` must receive a 403 or be redirected to `/dashboard`.

**Sprint:** 1

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [x] `proxy.ts` intercepts requests to protected route groups
- [x] Unauthenticated requests to `/dashboard`, `/profile`, `/admin` redirect to `/login`
- [x] Non-admin requests to `/admin/*` return 403 or redirect to `/dashboard`
- [x] Public routes (`/`, `/about`, `/contact`, `/pricing`, `/login`, `/signup`, `/api/health`) remain accessible
- [x] Proxy reads session from Appwrite (server-side check, not client-only)

**Related Feature / Epic:** Authentication (UA-06, UA-07, AD-02)

**Additional Notes:** This is a critical security task — client-side checks alone are insufficient per the PRD.

---

### ✅ Issue #11 · `[TASK]` Create Auth API Route Handlers

**Task Description:** Implement the following Next.js API route handlers under `app/api/auth/`:

- `POST /api/auth/register` — create Appwrite user + user_profiles doc
- `POST /api/auth/login` — create Appwrite session
- `POST /api/auth/logout` — destroy session
- `GET /api/auth/session` — return current session/user data
- `GET /api/auth/oauth/google` — initiate Google OAuth
- `GET /api/auth/callback/google` — OAuth callback handler

- Authorized redirect URI (for dev) is determined on the Auth page in AppWrite

**Sprint:** 1

**Size Estimate:** L (large — several days)

**Acceptance Criteria:**

- [x] All endpoints exist and return correct HTTP status codes
- [x] Register endpoint creates both an Auth user and a `user_profiles` document
- [x] Login endpoint returns a session cookie
- [x] Logout endpoint clears the session
- [x] OAuth endpoints correctly redirect through the Appwrite OAuth flow
- [x] Error responses follow the `ApiError` type format

**Related Feature / Epic:** Authentication (UA-01 through UA-07)

---

## Sprint 2 — Core Data Model & Repository Layer (Mar 5–7)

### ✅ Issue #12 · `[TASK]` Implement User Repository

**Task Description:** Create `lib/repositories/users.ts` with CRUD functions for the `user_profiles` collection: `createUser`, `getUserById`, `getUserByEmail`, `updateUser`, `listUsers` (for admin). All functions use the Appwrite Server SDK.

**Sprint:** 2

**Size Estimate:** M (medium — a day or two)
**Acceptance Criteria:**

- [x] `createUser(data)` creates a `user_profiles` document
- [x] `getUserById(userId)` returns a typed `User` object or null
- [x] `getUserByEmail(email)` returns a typed `User` object or null
- [x] `updateUser(userId, data)` updates fields like `isSupporter`, `role`
- [x] `listUsers(options)` returns paginated users (for admin dashboard)
- [x] All functions return typed results matching the `User` interface in `types/index.ts`

**Related Feature / Epic:** Core Data Model

**Additional Notes:** The `users.ts` stub already exists in `lib/repositories/`. ⚠️ Depends on Issue #4 (user_profiles collection).

---

### ✅ Issue #13 · `[TASK]` Implement Draft Repository

**Task Description:** Create `lib/repositories/drafts.ts` with CRUD functions for the `drafts` collection: `createDraft`, `getDraftById`, `listDraftsByUser`, `updateDraft`, `deleteDraft`. Tags must be JSON-serialized on write and parsed on read.

**Sprint:** 2

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [x] `createDraft(data)` creates a draft document; `tags` is JSON-stringified before write
- [x] `getDraftById(id)` returns a typed `Draft` object with `tags` parsed as `string[]`
- [x] `listDraftsByUser(userId)` returns all drafts for a user, sorted by most recent
- [x] `updateDraft(id, data)` updates any draft fields
- [x] `deleteDraft(id)` removes the draft document
- [x] All functions return typed results matching the `Draft` interface

**Related Feature / Epic:** Draft Management (DM-06, DM-09)

**Additional Notes:** The `drafts.ts` stub already exists in `lib/repositories/`.

---

### ✅ Issue #14 · `[TASK]` Implement Upload Job Repository

**Task Description:** Create `lib/repositories/upload-jobs.ts` with CRUD functions for the `upload_jobs` collection: `createUploadJob`, `getUploadJobById`, `listUploadJobsByUser`, `updateUploadJobStatus`, `getUploadJobsWithPlatformUploads`.

**Sprint:** 2

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [x] `createUploadJob(data)` creates an upload job with `status: 'pending'`
- [x] `getUploadJobById(id)` returns a typed `UploadJob` object
- [x] `listUploadJobsByUser(userId)` returns jobs sorted by most recent
- [x] `updateUploadJobStatus(id, status, errorMessage?)` updates status and optional error
- [x] All functions return typed results matching the `UploadJob` interface

**Related Feature / Epic:** Upload Job Tracking (JT-01, JT-02)

**Additional Notes:** The `upload-jobs.ts` stub already exists in `lib/repositories/`.

---

### ✅ Issue #15 · `[TASK]` Create Connected Accounts Collection & Repository

**Task Description:** Add the `connected_accounts` collection to the Appwrite setup script. Create `lib/repositories/connected-accounts.ts` with functions: `createConnectedAccount`, `getConnectedAccountsByUser`, `getConnectedAccount`, `deleteConnectedAccount`, `updateTokens`.

**Sprint:** 2

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [x] `connected_accounts` collection is defined in the setup script with all fields from the PRD data model
- [x] `createConnectedAccount(data)` stores OAuth tokens, platform user ID, and platform name
- [x] `getConnectedAccountsByUser(userId)` returns all connected accounts for a user
- [x] `getConnectedAccount(userId, platform)` returns a specific platform connection
- [x] `deleteConnectedAccount(id)` removes the connection and its tokens
- [x] `updateTokens(id, accessToken, refreshToken, tokenExpiry)` refreshes stored tokens

**Related Feature / Epic:** Platform Management (PM-05)

---

### ✅ Issue #16 · `[TASK]` Create Platform Uploads Collection & Repository

**Task Description:** Add the `platform_uploads` collection to the Appwrite setup script. Create `lib/repositories/platform-uploads.ts` with functions: `createPlatformUpload`, `getPlatformUploadsByJob`, `updatePlatformUploadStatus`.

**Sprint:** 2

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [x] `platform_uploads` collection is defined in the setup script with all fields from the PRD data model
- [x] `createPlatformUpload(data)` creates a record linked to an upload job
- [x] `getPlatformUploadsByJob(uploadJobId)` returns all platform uploads for a job
- [x] `updatePlatformUploadStatus(id, status, platformVideoId?, platformUrl?, errorMessage?)` updates status and result fields
- [x] All functions return typed results

**Related Feature / Epic:** Upload Job Tracking (JT-01)

---

### ✅ Issue #17 · `[TASK]` Create Upload Usage Collection & Repository

**Task Description:** Add the `upload_usage` collection to the Appwrite setup script. Create `lib/repositories/upload-usage.ts` with functions: `getMonthlyUsage`, `incrementUsage`, `canUpload` (checks free tier limit).

**Sprint:** 2

**Size Estimate:** S (small — a few hours)

**Acceptance Criteria:**

- [x] `upload_usage` collection is defined with `userId`, `month`, `uploadCount` fields
- [x] `getMonthlyUsage(userId)` returns the current month's upload count (or 0 if no record)
- [x] `incrementUsage(userId)` increments the current month's counter (creates record if none exists)
- [x] `canUpload(userId, isSupporter)` returns `true` for supporters, or checks `count < 10` for free users
- [x] Month format follows `"YYYY-MM"` pattern

**Related Feature / Epic:** Video Upload (VU-09, VU-10)

---

### ✅ Issue #18 · `[TASK]` Set Up Cloudflare R2 Client & Presigned URL Utility

**Task Description:** Create `lib/r2.ts` (or `lib/storage/r2.ts`) that configures the S3-compatible client for Cloudflare R2. Provide utility functions: `getPresignedUploadUrl(key, contentType)`, `deleteObject(key)`, `getObjectUrl(key)`.

**Sprint:** 2

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [x] R2 client is configured using `@aws-sdk/client-s3` with env variables (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`)
- [x] `getPresignedUploadUrl(key, contentType)` returns a presigned PUT URL expiring in 15 minutes
- [x] `deleteObject(key)` removes an object from the R2 bucket
- [x] `getObjectUrl(key)` returns a presigned GET URL for the distribution engine to read the file
- [x] Environment variables are documented in `.env.example`

**Related Feature / Epic:** Video Upload & Storage (VU-04, NF-08)

---

### ✅ Issue #19 · `[TASK]` Update Appwrite Setup Script with New Collections

**Task Description:** Update `scripts/setup-appwrite.ts` to create all collections needed by the app: `user_profiles`, `drafts`, `upload_jobs`, `connected_accounts`, `platform_uploads`, `upload_usage`. Each collection should have properly typed attributes and indexes.

**Sprint:** 2

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [x] Running `pnpm run setup:appwrite` creates all 6 collections
- [x] Each collection has all attributes matching the PRD data model
- [x] Appropriate indexes are created (e.g., `userId` index on all user-scoped collections, `month + userId` on `upload_usage`)
- [x] Script is idempotent — running it twice doesn't cause errors
- [x] Script outputs success/skip messages for each collection

**Related Feature / Epic:** Core Data Model

---

## Sprint 3 — Draft Management & Video Upload (Mar 8–11)

### Issue #20 · `[FEATURE]` Draft CRUD API Routes

**User Story:** As a user, I want to create, read, update, and delete video metadata drafts so that I can prepare my videos for distribution.

**Acceptance Criteria:**

- [ ] `POST /api/drafts` creates a new draft (title, description, tags, userId)
- [ ] `GET /api/drafts` lists all drafts for the authenticated user
- [ ] `GET /api/drafts/[id]` returns a specific draft (only if owned by the user)
- [ ] `PATCH /api/drafts/[id]` updates a draft's fields (partial update)
- [ ] `DELETE /api/drafts/[id]` deletes a draft
- [ ] All routes require authentication (return 401 if not logged in)
- [ ] All routes validate input (return 400 on malformed data)
- [ ] Responses follow the `ApiResponse<T>` type format

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: DM-01, DM-02, DM-06, DM-07, DM-09, US-12. ⚠️ Depends on Issue #13 (Draft Repository).

---

### Issue #21 · `[FEATURE]` Draft Creation & Edit UI

**User Story:** As a user, I want a form to create and edit video drafts so that I can prepare metadata before distributing, choosing only the platforms I have connected and want to target.

**Acceptance Criteria:**

- [ ] `/dashboard/drafts` page lists all user drafts with title, created date, and action buttons (edit, delete)
- [ ] "New Draft" button navigates to a create form
- [ ] Draft form includes fields: title (required), description (textarea), tags (comma-separated or tag input)
- [ ] The "Target Platforms" section loads the user's connected accounts from `GET /api/connected-accounts` and renders a toggle/checkbox for each; platforms the user has not connected are not selectable (show a "Connect" link instead)
- [ ] Toggling a platform on reveals that platform's per-platform fields (visibility selector: public / unlisted / private); toggling it off hides and clears those fields
- [ ] At least one platform must be toggled on before the form can be submitted
- [ ] Form submits to the Draft API and shows success/error feedback
- [ ] `/dashboard/drafts/[id]` loads an existing draft into the form for editing, restoring previously selected platforms and their per-platform settings
- [ ] Delete action shows a confirmation dialog before deleting
- [ ] "Upload Video" button on the draft edit page navigates to `/dashboard/drafts/[id]/upload`

**Priority:** P0 (High)

**T-Shirt Size Estimate:** L (large — several days)

**Additional Context:** PRD refs: DM-01, DM-02, DM-05, DM-07, DM-10, DM-11, DM-12, US-12. Consider using shadcn/ui form components. ⚠️ Depends on Issue #15 (Connected Accounts Repository) for loading the user's connected platforms.

---

### ✅ Issue #22 · `[FEATURE]` Video File Upload to R2 with Progress Bar

**User Story:** As a user, I want to upload a video file from my draft's page and see a progress bar so that I know how long the upload will take.

**Acceptance Criteria:**

- [x] Upload UI is accessible at `/dashboard/drafts/[id]/upload` via an "Upload Video" button on the draft edit page
- [x] Upload UI allows selecting a file via file picker or drag-and-drop
- [x] Client-side validation rejects files > 5 GB or unsupported formats (MP4, MOV, AVI, MKV, WebM) before upload begins
- [x] `POST /api/uploads/presign` accepts `{ fileName, contentType, fileSize, draftId }` and returns a presigned R2 PUT URL plus an `uploadJobId`
- [x] Client uploads directly to R2 via the presigned URL using `XMLHttpRequest` with progress tracking
- [x] A progress bar shows upload percentage
- [x] On success, an `UploadJob` record is created in Appwrite linked to the draft, and the `uploadJobId` is displayed to the user
- [x] Upload can be cancelled mid-progress; progress bar resets and user can start a new upload
- [x] Free-tier users who have reached the monthly limit (10 uploads) see a quota-exceeded message with an "Upgrade to Supporter" prompt instead of the upload form
- [x] Error states are handled gracefully (network failure, timeout, server errors)

**Priority:** P0 (High)

**T-Shirt Size Estimate:** L (large — several days)

**Additional Context:** PRD refs: VU-01 through VU-04, VU-08, US-05. ⚠️ Depends on Issue #18 (R2 Client) and Issue #21 (Draft UI — provides the draft context and entry point).

---

### Issue #23 · `[FEATURE]` Upload Usage Tracking & Free Tier Limit

**User Story:** As a free-tier user, I want to see how many uploads I have left this month so that I know when I need to upgrade.

**Acceptance Criteria:**

- [ ] `GET /api/uploads/usage` returns the current month's upload count and remaining uploads for the user
- [ ] The upload UI displays "X of 10 uploads used this month" for free-tier users
- [ ] Free-tier users who have used 10 uploads see a disabled upload button with an "Upgrade to Supporter" prompt
- [ ] Supporter users see "Unlimited uploads" with no counter
- [ ] Upload count is incremented when a distribution is initiated (not when the file is uploaded to R2)

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: VU-09, VU-10. ⚠️ Depends on Issue #17 (Upload Usage Repository).

---

### ✅ Issue #24 · `[TASK]` Cancel Upload Mid-Progress

**Task Description:** Allow users to cancel an in-progress file upload to R2. The `XMLHttpRequest` or `AbortController` should abort the upload and the UI should reset.

**Sprint:** 3

**Size Estimate:** S (small — a few hours)

**Acceptance Criteria:**

- [x] A "Cancel" button is visible while an upload is in progress
- [x] Clicking "Cancel" aborts the upload request
- [x] The progress bar resets and the user can start a new upload
- [ ] If partially uploaded, the R2 object is cleaned up (or left for TTL cleanup)

**Related Feature / Epic:** Video Upload (VU-05)

---

## Sprint 4 — Platform OAuth Connections (Mar 12–14)

### Issue #25 · `[FEATURE]` YouTube OAuth2 Connection Flow

**User Story:** As a user, I want to connect my YouTube account so that VideoSphere can upload videos on my behalf.

**Acceptance Criteria:**

- [ ] `GET /api/platforms/connect/youtube` redirects to Google OAuth2 consent screen requesting YouTube upload permissions
- [ ] `GET /api/platforms/callback/youtube` handles the callback, exchanges the code for tokens, and stores them in `connected_accounts`
- [ ] GCP Authorized redirect URI: `http://localhost:3000/api/platforms/callback/youtube`
- [ ] The user's YouTube channel name is fetched and stored as `platformName`
- [ ] On success, user is redirected to the connections page with a success message
- [ ] On failure, user sees an error message

**Priority:** P0 (High)

**T-Shirt Size Estimate:** L (large — several days)

**Additional Context:** PRD refs: PM-01, US-01. Requires Google Cloud Console project with YouTube Data API v3 enabled. OAuth scopes: `https://www.googleapis.com/auth/youtube.upload`. ⚠️ Depends on Issue #15 (Connected Accounts Repository).

---

### Issue #? · `[FEATURE]` Google Drive OAuth2 Connection Flow

**User Story:** As a user, I want to connect my Google Drive account so that VideoSphere can backup videos on my behalf.

**Acceptance Criteria:**

- [ ] `GET /api/platforms/connect/drive` redirects to Google OAuth2 consent screen requesting Google Drive permissions
- [ ] `GET /api/platforms/callback/drive` handles the callback, exchanges the code for tokens, and stores them in `connected_accounts`
- [ ] GCP Authorized redirect URI: `http://localhost:3000/api/platforms/callback/drive`
- [ ] On success, user is redirected to the connections page with a success message
- [ ] On failure, user sees an error message

**Priority:** P0 (High)

**T-Shirt Size Estimate:** L (large — several days)

**Additional Context:** PRD refs: PM-01, US-01. Requires Google Cloud Console project with Google Drive API enabled. ⚠️ Depends on Issue #15 (Connected Accounts Repository).

---

### Issue #26 · `[FEATURE]` Vimeo OAuth2 Connection Flow

**User Story:** As a user, I want to connect my Vimeo account so that I can distribute videos to Vimeo.

**Acceptance Criteria:**

- [ ] `GET /api/platforms/connect/vimeo` redirects to Vimeo OAuth2 consent screen
- [ ] `GET /api/platforms/callback/vimeo` handles the callback, exchanges the code for tokens, and stores them in `connected_accounts`
- [ ] Vimeo Callback URL: `http://localhost:3000/api/platforms/callback/vimeo`
- [ ] The user's Vimeo display name is fetched and stored as `platformName`
- [ ] On success, user is redirected to the connections page with a success message
- [ ] On failure, user sees an error message

**Priority:** P0 (High)

**T-Shirt Size Estimate:** L (large — several days)

**Additional Context:** PRD refs: PM-02, US-02. Requires Vimeo Developer app with upload access scope. ⚠️ Depends on Issue #15 (Connected Accounts Repository).

---

### Issue #27 · `[FEATURE]` Connected Accounts Management Page

**User Story:** As a user, I want to view and manage my connected platform accounts so that I can control which platforms VideoSphere can access.

**Acceptance Criteria:**

- [ ] `/profile/connections` page lists all connected accounts with: platform icon, platform name, channel/user name, connection status
- [ ] Each connected account has a "Disconnect" button
- [ ] Disconnecting shows a confirmation dialog, then calls `DELETE /api/platforms/connections/[id]`
- [ ] Unconnected platforms show a "Connect" button that initiates the OAuth flow
- [ ] `GET /api/platforms/connections` API route returns the user's connected accounts

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: PM-03, PM-04, US-03, US-04.

---

### Issue #28 · `[TASK]` OAuth Token Refresh Logic

**Task Description:** Implement automatic OAuth token refresh for YouTube and Vimeo. Before making any API call to a platform, check if the access token is expired and refresh it using the stored refresh token. Update the stored tokens in `connected_accounts`.

**Sprint:** 4

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [ ] A `refreshTokenIfNeeded(connectedAccount)` utility checks token expiry
- [ ] If expired, it uses the platform-specific refresh endpoint to get new tokens
- [ ] Updated tokens are saved back to `connected_accounts` via the repository
- [ ] If refresh fails (e.g., revoked access), the account status is updated and user is notified

**Related Feature / Epic:** Platform Management (PM-05)

---

### Issue #29 · `[TASK]` Platform Connection Status Indicator

**Task Description:** Display a clear visual indicator for each connected platform showing whether the connection is active, token expired, or disconnected.

**Sprint:** 4

**Size Estimate:** S (small — a few hours)

**Acceptance Criteria:**

- [ ] Connected + valid token → green "Connected" badge
- [ ] Connected + expired token → amber "Token expired — reconnect" badge with re-auth button
- [ ] Not connected → grey "Not connected" with "Connect" button
- [ ] Status is derived from token expiry date compared to current time

**Related Feature / Epic:** Platform Management (PM-06)

---

## Sprint 5 — Distribution Engine (Mar 15–18)

### Issue #30 · `[FEATURE]` YouTube Upload Adapter

**User Story:** As a user, I want VideoSphere to upload my video to YouTube so that I don't have to do it manually.

**Acceptance Criteria:**

- [ ] A `lib/platforms/youtube.ts` adapter module implements `uploadVideo(videoStream, metadata, tokens)`
- [ ] The adapter uses the YouTube Data API v3 `videos.insert` endpoint
- [ ] Metadata (title, description, tags, visibility) is sent with the upload
- [ ] On success, the adapter returns the YouTube video ID and URL
- [ ] On failure, the adapter returns a structured error with details
- [ ] The adapter handles token refresh before uploading

**Priority:** P0 (High)

**T-Shirt Size Estimate:** L (large — several days)

**Additional Context:** PRD refs: MD-01, MD-03. Use resumable upload protocol for large files. ⚠️ Depends on Issues #25, #28.

---

### Issue #31 · `[FEATURE]` Vimeo Upload Adapter

**User Story:** As a user, I want VideoSphere to upload my video to Vimeo so that I can reach my audience there without duplicating effort.

**Acceptance Criteria:**

- [ ] A `lib/platforms/vimeo.ts` adapter module implements `uploadVideo(videoStream, metadata, tokens)`
- [ ] The adapter uses the Vimeo API's tus-based upload flow
- [ ] Metadata (title, description, tags, visibility) is set after upload
- [ ] On success, the adapter returns the Vimeo video ID and URL
- [ ] On failure, the adapter returns a structured error with details
- [ ] The adapter handles token refresh before uploading

**Priority:** P0 (High)

**T-Shirt Size Estimate:** L (large — several days)

**Additional Context:** PRD refs: MD-02, MD-03. ⚠️ Depends on Issues #26, #28.

---

### Issue #32 · `[FEATURE]` Distribution Engine & API Route

**User Story:** As a user, I want to click "Distribute" and have my video uploaded to all selected platforms simultaneously.

**Acceptance Criteria:**

- [ ] `POST /api/uploads/distribute` accepts a draft ID, R2 object key, and target platform list
- [ ] The endpoint creates an `UploadJob` record and a `PlatformUpload` record per target platform
- [ ] Distribution runs asynchronously — the API responds immediately with the job ID
- [ ] The distribution engine reads the video from R2 and streams it to each platform adapter in parallel
- [ ] Each platform upload updates its `PlatformUpload` status independently (a YouTube failure doesn't block Vimeo)
- [ ] On completion, the `UploadJob` status is set to `completed` (or `failed` if all platforms failed)
- [ ] Free-tier users are limited to 2 platforms per upload; the API enforces this

**Priority:** P0 (High)

**T-Shirt Size Estimate:** XL (extra large — a full sprint or more)

**Additional Context:** PRD refs: MD-03, MD-04, MD-07, MD-08, NF-11, NF-15. This is the core of the application. Consider using a queue or background job pattern. ⚠️ Depends on Issues #14, #16, #18, #30, #31.

---

### Issue #33 · `[FEATURE]` Upload Job Tracking Dashboard

**User Story:** As a user, I want to see the status of all my video distributions in one place so I can track what's been published.

**Acceptance Criteria:**

- [ ] `/dashboard` page shows a list of all upload jobs for the current user, sorted by most recent
- [ ] Each job displays: video title, target platforms, overall status, timestamps
- [ ] Expanding a job shows per-platform status: platform name, status badge, video URL (if completed), error message (if failed)
- [ ] Status badges use clear visual indicators: pending (grey), uploading (blue), completed (green), failed (red)
- [ ] `GET /api/uploads/jobs` returns paginated upload jobs for the authenticated user
- [ ] `GET /api/uploads/jobs/[id]` returns a specific job with its platform uploads

**Priority:** P0 (High)

**T-Shirt Size Estimate:** L (large — several days)

**Additional Context:** PRD refs: JT-01 through JT-05, US-09, US-11.

---

### Issue #34 · `[FEATURE]` Retry Failed Platform Upload

**User Story:** As a user, I want to retry a failed platform upload without re-uploading the video file so I can fix temporary issues.

**Acceptance Criteria:**

- [ ] Failed platform uploads show a "Retry" button
- [ ] `POST /api/uploads/jobs/[id]/retry` re-initiates the distribution for the failed platform(s), reading the video from R2
- [ ] The platform upload status resets to `pending` and goes through the normal flow
- [ ] A retry is only possible if the R2 file still exists (within 72-hour retention)
- [ ] If the R2 file has been deleted, the retry shows "Video file expired — please re-upload"

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: MD-05, JT-06, US-10, NF-12. ⚠️ Depends on Issue #32.

---

### Issue #35 · `[TASK]` R2 File Cleanup After Distribution

**Task Description:** Implement automatic cleanup of temporary video files in R2. Files should be deleted after all platform uploads complete, or after 72 hours — whichever comes first.

**Sprint:** 5

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [ ] After all platform uploads for a job complete successfully, the R2 object is deleted
- [ ] A scheduled cleanup process (or cron) deletes R2 objects older than 72 hours
- [ ] Cleanup logs are recorded for debugging
- [ ] Retry is aware of cleanup — shows appropriate message if file is gone

**Related Feature / Epic:** Video Upload & Storage (VU-07)

---

## Sprint 6 — AI Metadata Generation (Mar 19–21)

### Issue #36 · `[FEATURE]` OpenRouter AI Client Setup

**User Story:** As a developer, I want a configured AI client that routes requests through OpenRouter so we can access multiple LLM models.

**Acceptance Criteria:**

- [ ] `lib/ai/openrouter.ts` (or similar) configures the OpenRouter API client
- [ ] Environment variables `OPENROUTER_API_KEY`, `OPENROUTER_FREE_MODEL`, `OPENROUTER_PREMIUM_MODEL` are added to `.env.example`
- [ ] A `generateMetadata(prompt, model)` function sends a chat completion request and parses the response
- [ ] The function returns a typed object: `{ title: string, description: string, tags: string[] }`
- [ ] Error handling covers API failures, rate limits, and malformed responses

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: AI-08. Use the Vercel AI SDK or direct REST calls.

---

### Issue #37 · `[FEATURE]` "Generate with AI" Metadata Endpoint

**User Story:** As a user, I want to click "Generate with AI" to auto-fill my video's title, description, and tags so I can save time.

**Acceptance Criteria:**

- [ ] `POST /api/ai/generate-metadata` accepts: `fileName`, `userPrompt` (optional), `platforms` (array)
- [ ] The endpoint determines the user's tier (free vs. supporter) and selects the appropriate model
- [ ] Free-tier users get results from the lower-cost model
- [ ] Supporter users get results from the premium model
- [ ] The response returns `{ title, description, tags }` that can be pasted into the draft form
- [ ] Response time is under 10 seconds

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: AI-01 through AI-05, AI-08, US-16, US-18, US-19. ⚠️ Depends on Issue #36.

---

### Issue #38 · `[FEATURE]` "Generate with AI" UI Button on Draft Form

**User Story:** As a user, I want to see AI-generated metadata in my draft form and be able to edit it before distributing.

**Acceptance Criteria:**

- [ ] The draft creation/edit form has a "Generate with AI" button
- [ ] Clicking the button sends the video filename and optional user prompt to the AI endpoint
- [ ] A loading spinner/skeleton shows while waiting for the response
- [ ] The returned title, description, and tags populate the form fields (editable)
- [ ] The user can click "Generate with AI" again to regenerate
- [ ] If the AI request fails, a non-blocking error toast is shown and the fields remain editable

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: AI-01, AI-03, US-16, US-17. ⚠️ Depends on Issues #21, #37.

---

### Issue #39 · `[TASK]` AI Platform-Specific Character Limit Enforcement

**Task Description:** Ensure AI-generated metadata respects platform-specific character limits. The AI prompt should include instructions about maximum lengths, and the API should truncate/validate the response.

**Sprint:** 6

**Size Estimate:** S (small — a few hours)

**Acceptance Criteria:**

- [ ] YouTube limits: title ≤ 100 chars, description ≤ 5,000 chars
- [ ] Vimeo limits: title ≤ 128 chars, description ≤ 5,000 chars
- [ ] The AI prompt includes these limits as instructions
- [ ] The API validates/truncates the response before returning it

**Related Feature / Epic:** AI Metadata (AI-06)

---

## Sprint 7 — Payments & Stripe Integration (Mar 22–25)

### Issue #40 · `[FEATURE]` Pricing Page (Free vs. Supporter Comparison)

**User Story:** As a free user, I want to see a clear comparison of Free vs. Supporter features so I understand the value of upgrading.

**Acceptance Criteria:**

- [x] `/pricing` page displays a side-by-side comparison table (matching PRD section 14)
- [x] Features compared: monthly uploads, connected platforms, AI model quality, price
- [x] A prominent "Upgrade to Supporter" CTA button is shown on the Supporter column
- [ ] Free-tier column shows "Current Plan" if the user is on free, or a "You're a Supporter!" badge if already upgraded
- [x] Page is accessible to both authenticated and unauthenticated visitors

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: FP-01, US-28.

---

### Issue #41 · `[FEATURE]` Stripe Checkout Integration

**User Story:** As a free user, I want to upgrade to Supporter by completing a payment so I can unlock premium features.

**Acceptance Criteria:**

- [ ] Clicking "Upgrade to Supporter" calls `POST /api/payments/checkout` which creates a Stripe Checkout Session
- [ ] The user is redirected to Stripe's hosted checkout page
- [ ] The checkout uses **Stripe test mode** (no real payments)
- [ ] On success, the user is redirected back to `/profile` with a success query param
- [ ] On cancellation, the user is redirected back to `/pricing`

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: FP-02, FP-07, US-29. Add `stripe` npm dependency. Stripe test keys go in `.env.local`.

---

### Issue #42 · `[FEATURE]` Stripe Webhook Handler

**User Story:** As the system, I need to process Stripe webhook events so that user tier upgrades happen reliably server-side.

**Acceptance Criteria:**

- [ ] `POST /api/webhooks/stripe` receives Stripe webhook events
- [ ] Webhook signature is verified using the Stripe webhook secret (reject unsigned requests)
- [ ] On `checkout.session.completed`, the handler identifies the user and sets `isSupporter: true` in `user_profiles`
- [ ] The webhook handler is idempotent (processing the same event twice doesn't cause issues)
- [ ] Webhook events are logged for debugging
- [ ] Error responses return appropriate status codes

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: FP-03, FP-04, NF-06. Use `stripe.webhooks.constructEvent()` for signature verification. ⚠️ Depends on Issue #12 (User Repository).

---

### Issue #43 · `[TASK]` Supporter Tier Enforcement Across the App

**Task Description:** Ensure all tier-gated features check `isSupporter` on the server side. This includes upload limits, platform count limits, and AI model selection.

**Sprint:** 7

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [ ] `POST /api/uploads/distribute` rejects requests exceeding 2 platforms for free-tier users
- [ ] `POST /api/uploads/presign` checks monthly usage for free-tier users (10/month limit)
- [ ] `POST /api/ai/generate-metadata` selects the model based on the user's tier
- [ ] All checks are server-side (client-side checks are supplementary, not authoritative)
- [ ] Clear error messages explain tier limitations and prompt upgrade

**Related Feature / Epic:** Freemium Model (FP-05, FP-06)

---

## Sprint 8 — Admin Dashboard (Mar 26–28)

### Issue #44 · `[FEATURE]` Admin Dashboard — User Table

**User Story:** As an admin, I want to view all users with their roles and subscription status so I can manage the platform.

**Acceptance Criteria:**

- [ ] `/admin/dashboard` page displays a table of all users
- [ ] Columns: email, role (`user`/`admin`), supporter status, created date
- [ ] Table supports pagination (or shows up to 50 users with a "Load more" button)
- [ ] `GET /api/admin/users` returns paginated user list (admin-only route)
- [ ] Non-admin users receive 403 when calling this endpoint

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: AD-01, AD-04, US-31, US-34. ⚠️ Depends on Issue #10 (proxy.ts) and Issue #12 (User Repository).

---

### Issue #45 · `[FEATURE]` Admin Dashboard — System Stats

**User Story:** As an admin, I want to see system health stats so I can monitor the platform at a glance.

**Acceptance Criteria:**

- [ ] Admin dashboard displays stats cards: total users, total supporters, uploads this month, active drafts
- [ ] `GET /api/admin/stats` aggregates data from Appwrite collections and returns the stats
- [ ] Stats update each time the admin visits the page (no caching required for MVP)
- [ ] Route is admin-only (403 for non-admins)

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: AD-05, AD-07, US-32.

---

### Issue #46 · `[FEATURE]` Admin Dashboard — Error Log

**User Story:** As an admin, I want to view recent failed upload errors with details so I can debug issues.

**Acceptance Criteria:**

- [ ] Admin dashboard has an "Error Log" section or tab
- [ ] Displays a table of recent failed platform uploads: job ID, user email, platform, error message, timestamp
- [ ] `GET /api/admin/errors` queries `platform_uploads` where `status = 'failed'`, sorted by most recent
- [ ] Shows the most recent 50 errors (with optional pagination)
- [ ] Route is admin-only

**Priority:** P1 (Medium)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: AD-06, US-33.

---

## Sprint 9 — Scheduled Publishing & Per-Platform Metadata (Mar 29–Apr 1)

### Issue #47 · `[FEATURE]` Scheduled Publishing — Date/Time Picker

**User Story:** As a user, I want to schedule my video to publish at a specific date and time per platform so I can coordinate releases.

**Acceptance Criteria:**

- [ ] Draft form includes an optional "Schedule publish" date/time picker per platform
- [ ] Date/time is stored as ISO 8601 in the `scheduledAt` field of `platform_uploads`
- [ ] If no schedule is set, the distribution happens immediately
- [ ] Timezone is auto-detected from the browser

**Priority:** P1 (Medium)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: SP-01, SP-05, US-20.

---

### Issue #48 · `[FEATURE]` Scheduled Publishing — Queue & Execution

**User Story:** As a user, I want my scheduled videos to be published at the set time automatically.

**Acceptance Criteria:**

- [ ] A server-side process (cron job or polling loop) checks for `platform_uploads` with `scheduledAt <= now` and `status = 'pending'`
- [ ] Matching records are distributed using the existing distribution engine
- [ ] After execution, the status is updated to `completed` or `failed`
- [ ] The process runs at a reasonable interval (e.g., every 1 minute)

**Priority:** P1 (Medium)

**T-Shirt Size Estimate:** L (large — several days)

**Additional Context:** PRD refs: SP-02. ⚠️ Depends on Issue #32 (Distribution Engine).

---

### Issue #49 · `[FEATURE]` Scheduled Uploads Dashboard Tab

**User Story:** As a user, I want to view all my scheduled uploads in one place so I can manage upcoming publications.

**Acceptance Criteria:**

- [ ] `/dashboard/scheduled` page shows all pending scheduled uploads
- [ ] Each entry shows: video title, target platform, scheduled date/time, status
- [ ] Users can cancel a scheduled upload (sets status to `cancelled`)
- [ ] Users can reschedule (update the `scheduledAt` time)

**Priority:** P1 (Medium)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: SP-03, SP-04, US-21, US-22.

---

### Issue #50 · `[FEATURE]` Per-Platform Metadata Overrides

**User Story:** As a user, I want to customize metadata per platform so that each platform gets optimized content.

**Acceptance Criteria:**

- [ ] Draft form has a "Customize per platform" toggle
- [ ] When enabled, separate title, description, and tag fields appear for each target platform
- [ ] Per-platform overrides are stored in the `platform_uploads` records
- [ ] If no override is set, the default draft metadata is used
- [ ] The distribution engine uses per-platform metadata when available

**Priority:** P1 (Medium)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: DM-03, US-13.

---

### Issue #51 · `[FEATURE]` Thumbnail Upload/Selection Per Platform

**User Story:** As a user, I want to select or upload a thumbnail for each platform so my videos look professional everywhere.

**Acceptance Criteria:**

- [ ] Draft form includes a thumbnail upload/selection area
- [ ] Users can upload a custom thumbnail image (JPG, PNG, max 2 MB)
- [ ] Thumbnails are stored in R2 (separate from video files)
- [ ] Per-platform thumbnail override is supported when "Customize per platform" is enabled
- [ ] Thumbnails are sent to each platform during distribution

**Priority:** P1 (Medium)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: DM-04, US-14.

---

## Sprint 10 — Responsive Design & UI Polish (Apr 2–4)

### Issue #52 · `[FEATURE]` User Profile Page

**User Story:** As a user, I want to view and edit my profile so I can manage my account information.

**Acceptance Criteria:**

- [ ] `/profile` page displays: name, email, role, subscription status (Free / Supporter)
- [ ] Users can edit their name
- [ ] Supporters see a "Supporter" badge
- [x] Free users see a link to `/pricing` to upgrade
- [x] The page links to `/profile/connections` for managing platform accounts

**Priority:** P0 (High)

**T-Shirt Size Estimate:** M (medium — a day or two)

**Additional Context:** PRD refs: UA-08, UA-09, US-27, FP-08.

---

### Issue #53 · `[TASK]` Mobile-Responsive Audit & Fixes

**Task Description:** Audit all pages for responsive design and fix any layout issues. Target viewports: mobile (≥320px), tablet (≥768px), desktop (≥1024px).

**Sprint:** 10

**Size Estimate:** L (large — several days)

**Acceptance Criteria:**

- [ ] All pages render correctly at 320px, 768px, and 1024px widths
- [ ] Navigation adapts to mobile (hamburger menu or drawer)
- [ ] Tables on admin dashboard are horizontally scrollable or cards on mobile
- [ ] Upload progress bar is usable on mobile
- [ ] Draft form is usable on mobile (no horizontal overflow)
- [ ] No layout breaks at any standard viewport size

**Related Feature / Epic:** Responsive Design (NF-19, NF-20)

---

### Issue #54 · `[TASK]` Landing Page & Marketing Pages Polish

**Task Description:** Polish the marketing pages (`/`, `/about`, `/contact`, `/pricing`) with professional layout, clear CTAs, and VideoSphere branding.

**Sprint:** 10

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [x] Landing page (`/`) has a hero section explaining VideoSphere's value proposition
- [x] Landing page has a CTA leading to `/signup`
- [ ] About page has project/team information
- [ ] Contact page has a contact form or contact info
- [ ] All pages use consistent branding (colors, fonts, spacing)
- [ ] All pages are mobile-responsive

**Related Feature / Epic:** Marketing Pages

---

### Issue #55 · `[TASK]` Navbar & Footer Component Updates

**Task Description:** Update the Navbar and Footer components to reflect the full application: auth-aware navigation, links to all pages, and consistent styling.

**Sprint:** 10

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [x] Navbar shows: Logo/brand, Dashboard link (auth'd), Profile link (auth'd), Login/Signup (unauth'd), Logout button (auth'd)
- [ ] Navbar highlights the active page
- [x] Navbar is mobile-responsive (hamburger menu)
- [ ] Footer shows: Links to About, Contact, Pricing, GitHub repo link
- [ ] Admin users see an "Admin" link in the Navbar

**Related Feature / Epic:** Layout Components

---

## Sprint 11 — Testing & Stretch Goals (Apr 5–8)

### Issue #56 · `[TASK]` Unit Tests — Repository Layer

**Task Description:** Write Vitest unit tests for all repository modules: `users.ts`, `drafts.ts`, `upload-jobs.ts`, `connected-accounts.ts`, `platform-uploads.ts`, `upload-usage.ts`. Mock the Appwrite SDK.

**Sprint:** 11

**Size Estimate:** L (large — several days)

**Acceptance Criteria:**

- [ ] Each repository function has at least one test
- [x] Tests mock Appwrite SDK calls (no real database calls)
- [x] Tests verify correct Appwrite method calls and parameter shapes
- [x] Tests verify tags JSON serialization/deserialization in drafts repo
- [x] All tests pass with `pnpm test`

**Related Feature / Epic:** Testing

---

### Issue #57 · `[TASK]` Unit Tests — API Routes

**Task Description:** Write Vitest tests for critical API routes: auth routes, draft CRUD, uploads/presign, ai/generate-metadata, webhooks/stripe.

**Sprint:** 11

**Size Estimate:** L (large — several days)

**Acceptance Criteria:**

- [ ] Auth routes: test successful registration, login, logout, and error cases
- [ ] Draft routes: test CRUD operations and authorization
- [ ] Upload routes: test presign URL generation and usage limit checks
- [ ] AI routes: test model selection based on user tier
- [ ] Stripe webhook: test signature verification and user update
- [ ] All tests pass with `pnpm test`

**Related Feature / Epic:** Testing

---

### Issue #58 · `[TASK]` Component Tests — Dashboard & Draft Form

**Task Description:** Write React Testing Library + Vitest tests for key UI components: Dashboard job list, Draft creation form, Upload progress bar.

**Sprint:** 11

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [ ] Dashboard renders job list correctly with mock data
- [ ] Draft form validates required fields
- [ ] Upload progress bar renders correct percentage
- [ ] "Generate with AI" button triggers the correct API call
- [ ] All component tests pass with `pnpm test`

**Related Feature / Epic:** Testing

---

### Issue #59 · `[TASK]` Upload Job Status Polling (Real-Time Updates)

**Task Description:** Implement polling (or SSE) so that the Dashboard updates upload job statuses without requiring a full page refresh.

**Sprint:** 11

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [ ] The Dashboard polls `GET /api/uploads/jobs` at a configurable interval (e.g., every 5 seconds)
- [ ] When a job status changes, the UI updates in place without a page reload
- [ ] Polling stops when there are no active (in-progress) jobs
- [ ] Polling resumes when new distributions are initiated

**Related Feature / Epic:** Upload Job Tracking (JT-07) — Stretch

---

### Issue #60 · `[TASK]` Draft Metadata Validation

**Task Description:** Validate draft metadata before distribution: title required, character limits per platform, at least one platform selected.

**Sprint:** 11

**Size Estimate:** S (small — a few hours)

**Acceptance Criteria:**

- [ ] Title is required and cannot be empty
- [ ] Title length respects platform limits (YouTube: 100 chars, Vimeo: 128 chars)
- [ ] Description length respects platform limits (5,000 chars)
- [ ] At least one platform must be selected for distribution
- [ ] Validation errors are displayed inline on the form
- [ ] Server-side validation mirrors client-side checks

**Related Feature / Epic:** Draft Management (DM-08)

---

## Sprint 12 — Final Polish & Presentation Prep (Apr 9–12)

### Issue #61 · `[TASK]` Bug Fixes & Edge Case Handling

**Task Description:** Reserve time for bug fixes discovered during testing, edge case handling, and UX improvements based on team testing.

**Sprint:** 12

**Size Estimate:** L (large — several days)

**Acceptance Criteria:**

- [ ] All reported bugs are triaged and P0 bugs are fixed
- [ ] Error states are handled gracefully across the app (no unhandled promise rejections)
- [x] Loading states exist for all async operations
- [x] 404 page renders for unknown routes
- [x] Error boundary (`error.tsx`) catches and displays runtime errors

**Related Feature / Epic:** Polish

---

### Issue #62 · `[TASK]` CI Pipeline Verification

**Task Description:** Verify that the GitHub Actions CI pipeline passes all checks: lint, format, type-check, build, and tests.

**Sprint:** 12

**Size Estimate:** S (small — a few hours)

**Acceptance Criteria:**

- [x] `pnpm lint` passes with zero errors
- [x] `pnpm format:check` passes (all files formatted)
- [x] `pnpm type-check` passes (zero TypeScript errors)
- [ ] `pnpm build` succeeds
- [x] `pnpm test` runs all tests and they pass
- [x] GitHub Actions workflow runs green on `main`

**Related Feature / Epic:** DevOps / Quality

---

### Issue #63 · `[TASK]` Docker Compose Full-Stack Verification

**Task Description:** Verify that `docker-compose up` brings up the complete application stack (Next.js + Appwrite) and the app is fully functional in Docker.

**Sprint:** 12

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [ ] `docker-compose up` starts all services without errors
- [ ] The Next.js app is accessible at the configured port
- [ ] Appwrite console is accessible
- [ ] Auth flow works end-to-end in the Docker environment
- [ ] At least one upload + distribution flow works in Docker

**Related Feature / Epic:** Containerization (NF-21, NF-22)

---

### Issue #64 · `[TASK]` Documentation Update & README

**Task Description:** Update `README.md` with project overview, tech stack, setup instructions, environment variables list, and contributor information. Ensure all docs are current.

**Sprint:** 12

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [ ] `README.md` includes: project description, tech stack, quick start instructions, environment variables list, architecture overview
- [ ] `SETUP.md` is verified end-to-end by a team member who hasn't set up before
- [ ] All environment variables are documented in `.env.example`
- [ ] API routes are documented (at minimum, listed with descriptions)
- [ ] Contributing workflow matches `CONTRIBUTING.md`

**Related Feature / Epic:** Documentation

---

### Issue #65 · `[TASK]` Presentation Preparation

**Task Description:** Prepare for the final live presentation on April 13. Rehearse the demo flow, prepare talking points, and ensure the app is in a stable state.

**Sprint:** 12

**Size Estimate:** M (medium — a day or two)

**Acceptance Criteria:**

- [ ] Demo script covers: registration → connect platforms → create draft → AI metadata → upload → distribute → track jobs
- [ ] Admin dashboard demo: user table, stats, error log
- [ ] Pricing / Stripe upgrade demo (using test cards)
- [ ] The app is deployed or running on Docker for the demo
- [ ] Team members know their presentation roles
- [ ] Backup plan exists if live demo has issues (screenshots/recording)

**Related Feature / Epic:** Presentation

---

## Stretch Goal Issues (Optional — Beyond MVP)

These issues can be created if the team has capacity after completing all P0 and P1 items above.

### ✅ Issue #66 · `[FEATURE]` Dark/Light Mode Toggle

**User Story:** As a user, I want to switch between dark and light themes so the app is comfortable to use at any time of day.

**Priority:** Low · **Size:** S

---

### Issue #67 · `[FEATURE]` Toast Notifications

**User Story:** As a user, I want to see non-blocking toast notifications for success/error events so I always know what's happening.

**Priority:** Low · **Size:** S

---

### Issue #68 · `[FEATURE]` Skeleton Loading States

**User Story:** As a user, I want to see skeleton placeholders while pages load so the app feels fast.

**Priority:** Low · **Size:** S

---

### Issue #69 · `[FEATURE]` Form Validation with React Hook Form + Zod

**User Story:** As a developer, I want consistent form validation using React Hook Form and Zod schemas so forms are robust and type-safe.

**Priority:** Low · **Size:** M

---

### Issue #70 · `[FEATURE]` Zod Validation on All API Routes

**User Story:** As a developer, I want all API routes to validate input with Zod schemas so malformed requests are rejected cleanly (NF-07).

**Priority:** Low · **Size:** M

---

### Issue #71 · `[FEATURE]` Password Reset Flow

**User Story:** As a user, I want to reset my password if I forget it so I don't lose access to my account.

**Priority:** Low · **Size:** M

---

### Issue #72 · `[FEATURE]` Database Seeding Script

**User Story:** As a developer, I want a seed script that populates the database with test data so I can develop and demo more easily.

**Priority:** Low · **Size:** M

---

### Issue #73 · `[FEATURE]` AI Platform-Optimized Variants

**User Story:** As a user, I want AI to generate different metadata variants optimized for each platform (e.g., different tag styles for YouTube vs. Vimeo).

**Priority:** Low · **Size:** M

**Additional Context:** PRD ref: AI-07.

---

### Issue #74 · `[FEATURE]` E2E Tests with Playwright

**User Story:** As a developer, I want end-to-end tests covering the core workflow so we catch regressions before deployment.

**Priority:** Low · **Size:** L

---

### Issue #75 · `[FEATURE]` CSP Headers & Rate Limiting

**User Story:** As a developer, I want CSP headers and rate limiting on auth/AI endpoints to prevent abuse (NF-09).

**Priority:** Low · **Size:** M

---

---

## Summary — Issue Count by Sprint

| Sprint | Focus                                    | Issues     | Count |
| ------ | ---------------------------------------- | ---------- | ----- |
| 0      | Project Setup                            | #1–#3      | 3     |
| 1      | Auth & Appwrite                          | #4–#11     | 8     |
| 2      | Data Model & Repositories               | #12–#19    | 8     |
| 3      | Draft Management & Upload                | #20–#24    | 5     |
| 4      | Platform OAuth                           | #25–#29    | 5     |
| 5      | Distribution Engine                      | #30–#35    | 6     |
| 6      | AI Metadata                              | #36–#39    | 4     |
| 7      | Payments & Stripe                        | #40–#43    | 4     |
| 8      | Admin Dashboard                          | #44–#46    | 3     |
| 9      | Scheduled Publishing & Per-Platform      | #47–#51    | 5     |
| 10     | Responsive Design & Polish               | #52–#55    | 4     |
| 11     | Testing & Stretch                        | #56–#60    | 5     |
| 12     | Final Polish & Presentation              | #61–#65    | 5     |
| —      | Stretch Goals (optional)                 | #66–#75    | 10    |
| **Total** |                                       |            | **75** |

---

## Dependency Graph (Critical Path)

```
Setup (#1-3)
  └─▶ Auth (#4-11)
       ├─▶ User Repo (#12) ─▶ Admin Dashboard (#44-46)
       ├─▶ All Repositories (#12-17)
       │    ├─▶ Draft API + UI (#20-21)
       │    ├─▶ R2 Client (#18) ─▶ Upload UI (#22-24)
       │    └─▶ Connected Accounts (#15)
       │         ├─▶ YouTube OAuth (#25) ─▶ YouTube Adapter (#30)──┐
       │         └─▶ Vimeo OAuth (#26) ──▶ Vimeo Adapter (#31)────┤
       │                                                           │
       │              ┌────────────────────────────────────────────┘
       │              ▼
       │         Distribution Engine (#32) ─▶ Job Tracking (#33-34)
       │              │                       ─▶ Scheduling (#47-49)
       │              └─▶ R2 Cleanup (#35)
       │
       ├─▶ AI Client (#36) ─▶ AI Endpoint (#37) ─▶ AI UI (#38)
       │
       └─▶ Stripe Checkout (#41) ─▶ Webhook (#42) ─▶ Tier Enforcement (#43)
```

---

*This roadmap is a living document. Update it as sprints progress and priorities shift.*
