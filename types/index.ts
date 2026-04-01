// =============================================================================
// SHARED TYPE DEFINITIONS
// =============================================================================
// Place your shared TypeScript types and interfaces in this file.
// Types that are used across multiple components or pages belong here.
//
// STUDENT: Add your own types as you build features. For example:
//   - User type for your auth system
//   - Product/Item types for your core data
//   - API response types
//
// Types specific to a single component can stay in that component's file.
// =============================================================================

// =============================================================================
// VideoSphere entity types (used by lib/repositories and API routes)
// =============================================================================

export type UserRole = 'user' | 'admin';

export interface UploadUsage {
  userId: string;
  /** Current month in "YYYY-MM" format. */
  month: string;
  uploadCount: number;
}

export interface User {
  /** User identifier; aligns with user_profiles.userId in Appwrite. */
  userId: string;
  email: string;
  isSupporter: boolean;
  role: UserRole;
  hasCompletedOnboarding: boolean;
  /** Appwrite system attribute on `user_profiles` rows (ISO string). */
  $createdAt: string;
  /** Appwrite system attribute on `user_profiles` rows (ISO string). */
  $updatedAt: string;
}

/** Platform identifier; shared with ConnectedAccount and PlatformUpload. */
export type ConnectedAccountPlatform = 'youtube' | 'vimeo';

/** Platforms we support for drafts, uploads, and connections (extend as you add backends). */
export const CONNECTED_ACCOUNT_PLATFORMS: readonly ConnectedAccountPlatform[] = [
  'youtube',
  'vimeo',
];

/** Platform upload status (PRD: pending, uploading, completed, failed). */
export type PlatformUploadStatus = 'pending' | 'uploading' | 'completed' | 'failed';

/** Per-platform visibility (PRD: public, unlisted, private). */
export type PlatformUploadVisibility = 'public' | 'unlisted' | 'private';

/**
 * YouTube-only fields inside the draft `document.platforms` JSON.
 * Shared copy (title, description, tags) lives at the document root.
 *
 * Field names align with YouTube Data API v3 `videos.insert` `snippet` / `status` where applicable.
 */
export interface YouTubeDraftFields {
  /** YouTube Data API `snippet.categoryId` (numeric string, e.g. "22" = People & Blogs). */
  categoryId?: string;
  /** Maps to `status.selfDeclaredMadeForKids` on upload. */
  madeForKids?: boolean;
  /** `snippet.defaultLanguage` (BCP-47, e.g. "en"). */
  defaultLanguage?: string;
  /** `snippet.defaultAudioLanguage` (BCP-47). */
  defaultAudioLanguage?: string;
  /** `status.embeddable`. */
  embeddable?: boolean;
  /** `status.license`: standard YouTube license vs Creative Commons. */
  license?: 'youtube' | 'creativeCommon';
  /** `status.publicStatsViewable`. */
  publicStatsViewable?: boolean;
  /** `status.publishAt` (ISO 8601). Requires `privacyStatus` private until publish time. */
  publishAt?: string;
  /** `status.containsSyntheticMedia` (disclosure for altered / synthetic media). */
  containsSyntheticMedia?: boolean;
  /**
   * After upload, append the video via `playlistItems.insert` (one call per id).
   * Values are playlist **ids** from `playlist?list=…` in the URL.
   */
  playlistIds?: string[];
  /**
   * Playlist **titles** (`snippet.title`). Same key as [porjo/youtubeuploader](https://github.com/porjo/youtubeuploader) `-metaJSON`.
   * The server uses `playlists.list` (`mine=true`, paginated), then `playlists.insert` if no case-insensitive
   * title match, then `playlistItems.insert`. Duplicate titles in this array are deduped case-insensitively (first wins).
   */
  playlistTitles?: string[];
}

/** Vimeo `privacy` object (subset); merged after mapping draft `visibility` → `privacy.view`. */
export type VimeoPrivacyView =
  | 'anybody'
  | 'contacts'
  | 'disable'
  | 'nobody'
  | 'password'
  | 'unlisted'
  | 'users';

export type VimeoPrivacyComments = 'anybody' | 'contacts' | 'nobody';
export type VimeoPrivacyEmbed = 'private' | 'public' | 'whitelist';

/** Subset of Vimeo `embed` on `POST /me` videos (player chrome). */
export interface VimeoDraftEmbed {
  playbar?: boolean;
  volume?: boolean;
  buttons?: Partial<{
    like: boolean;
    share: boolean;
    embed: boolean;
    fullscreen: boolean;
    hd: boolean;
    watchlater: boolean;
    scaling: boolean;
  }>;
  title?: Partial<{
    name: 'hide' | 'show' | 'user';
    owner: 'hide' | 'show' | 'user';
    portrait: 'hide' | 'show' | 'user';
  }>;
}

export interface VimeoDraftPrivacy {
  view?: VimeoPrivacyView;
  comments?: VimeoPrivacyComments;
  embed?: VimeoPrivacyEmbed;
  /**
   * Stored for future use / UI; **not** sent on video create (Vimeo frequently returns 2204 for
   * `privacy.download` on create across membership tiers). Enable downloads in Vimeo if your plan allows.
   */
  download?: boolean;
  add?: boolean;
}

/** Creative Commons license codes on Vimeo `POST /me/videos` / `PATCH /videos/{id}`. */
export type VimeoVideoLicense =
  | 'by'
  | 'by-nc'
  | 'by-nc-nd'
  | 'by-nc-sa'
  | 'by-nd'
  | 'by-sa'
  | 'cc0';

/**
 * Vimeo-only fields inside the draft `document.platforms` JSON.
 * Sent on `POST /me/videos` using **snake_case** keys where the Vimeo API expects them.
 */
export interface VimeoDraftFields {
  /**
   * Category hint for `PUT /videos/{id}/categories` batch body: `/categories/{slug}`, plain slug,
   * or vimeo.com category URL — not a made-up numeric id.
   */
  categoryUri?: string;
  /** Maps to API `license`. */
  license?: VimeoVideoLicense;
  /** Maps to API `locale` (e.g. `en-US`). See `GET /languages?filter=texttracks`. */
  locale?: string;
  /**
   * Maps to API `content_rating` (string array). Valid values from `GET /contentratings`.
   * Example often used in ratings UI: `"safe"`.
   */
  contentRating?: string[];
  /** Required when `privacy.view` is `password`. */
  password?: string;
  /** Maps to API `review_page`: `{ "active": true }`. */
  reviewPage?: { active?: boolean };
  /** Merged into `privacy` after draft-level `visibility` → `view`. */
  privacy?: VimeoDraftPrivacy;
  /** Player / embed chrome; maps to API `embed`. */
  embed?: VimeoDraftEmbed;
}

/**
 * Per-platform metadata on a draft (inside Appwrite `document` JSON).
 * Extend with e.g. `google_drive` when you add that destination.
 */
export interface DraftPlatforms {
  youtube?: YouTubeDraftFields;
  vimeo?: VimeoDraftFields;
}

export interface Draft {
  id: string;
  userId: string;
  /** Platforms this draft is configured to publish to (UI toggles). */
  readonly targets: readonly ConnectedAccountPlatform[];
  /** Required for uploads; stored in `document`. */
  title: string;
  description: string;
  /** Shared tag list for every target platform; stored in `document`. */
  tags: string[];
  /** Applied when distributing (mapped to each API's privacy model). */
  visibility: PlatformUploadVisibility;
  /** Per-platform-only options (e.g. YouTube categoryId, Vimeo category URI). */
  platforms: DraftPlatforms;
  /**
   * R2 object key for a custom thumbnail image (JPG or PNG), or undefined if none.
   * Best-effort cleared after distribution completes (retained if the cleanup DB write fails).
   */
  thumbnailR2Key?: string;
  /** MIME type of the thumbnail object (for platform upload and preview). */
  thumbnailContentType?: string;
  /**
   * Ephemeral presigned GET URL for the draft form preview.
   * Returned by endpoints that include draft payloads (e.g. GET/PATCH /api/drafts/[id],
   * and thumbnail complete) when a valid thumbnail exists.
   * Not stored in Appwrite.
   */
  thumbnailPreviewUrl?: string;
  /**
   * When this draft was first used to create an upload job.
   * Stored on the draft (denormalized) to avoid scanning upload job history.
   */
  usedInUploadAt?: string;
  /** Appwrite system attribute (ISO string). */
  $createdAt: string;
  /** Appwrite system attribute (ISO string). */
  $updatedAt: string;
}

export type UploadJobStatus =
  | 'pending'
  | 'uploading'
  | 'distributing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface UploadJob {
  id: string;
  userId: string;
  draftId: string | null;
  /** R2 object key for the uploaded video file. For new jobs this is set at creation; may be null only for legacy/backfill rows or if job creation is ever decoupled from presign. */
  r2Key: string | null;
  status: UploadJobStatus;
  errorMessage: string | null;
  /**
   * UTC month "YYYY-MM" for which a free-tier quota slot was claimed at presign.
   * Empty string if the user was unlimited at presign (supporter/admin). `null` for
   * legacy rows created before this field existed (cancel may fall back to current tier).
   */
  quotaClaimMonth: string | null;
  /** Appwrite system attribute (ISO string). */
  $createdAt: string;
  /** Appwrite system attribute (ISO string). */
  $updatedAt: string;
}

/** Platform upload (one per target platform per upload job). See PRD Platform Upload. */
export interface PlatformUpload {
  id: string;
  uploadJobId: string;
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
  platformVideoId: string;
  platformUrl: string;
  /** Snapshot from row `document` JSON at creation. */
  title: string;
  description: string;
  tags: string[];
  visibility: PlatformUploadVisibility;
  scheduledAt: string | null;
  errorMessage: string | null;
  /** Appwrite system attribute (ISO string). */
  $createdAt: string;
  /** Appwrite system attribute (ISO string). */
  $updatedAt: string;
}

/** Upload job with its related platform uploads (for dashboard/APIs). */
export interface UploadJobWithPlatformUploads extends UploadJob {
  platformUploads: PlatformUpload[];
}

/**
 * Safe shape for listing and API responses. No OAuth tokens.
 * Use this for GET /api/platforms/connections, UI, and any response sent to the client.
 */
export interface ConnectedAccountPublic {
  id: string;
  userId: string;
  platform: ConnectedAccountPlatform;
  tokenExpiry: string;
  /** True when a non-empty refresh token is stored (encrypted at rest). */
  hasRefreshToken: boolean;
  platformUserId: string;
  platformName: string;
  /** Appwrite system attribute (ISO string). */
  $createdAt: string;
  /** Appwrite system attribute (ISO string). */
  $updatedAt: string;
}

/**
 * Full connected account including OAuth tokens. Use only server-side when calling
 * platform APIs (upload, token refresh). Do not expose in API responses or client.
 */
export interface ConnectedAccount extends ConnectedAccountPublic {
  accessToken: string;
  refreshToken: string;
}

// =============================================================================
// Example type — demonstrates the pattern for defining shared types.
// =============================================================================

export interface ExampleItem {
  id: string;
  title: string;
  description: string;
  createdAt: string;
}

// =============================================================================
// AI Metadata Generation types (PRD: AI-01 through AI-06, AI-08)
// =============================================================================

/** Structured metadata returned by the AI metadata generation endpoint. */
export interface GeneratedMetadata {
  title: string;
  description: string;
  tags: string[];
}

/** Request body for POST /api/ai/generate-metadata. */
export interface GenerateMetadataRequest {
  fileName: string;
  userPrompt?: string;
  platforms: ConnectedAccountPlatform[];
}

/**
 * Standard API response wrapper.
 * Use this pattern to keep your API responses consistent.
 */
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

/**
 * Standard API error response.
 */
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
