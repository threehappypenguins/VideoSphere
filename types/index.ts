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

/**
 * Defines the UserRole type.
 */
export type UserRole = 'user' | 'admin';

/**
 * How the user authenticates to VideoSphere (login/setup/invite), not platform connections.
 * Mutually exclusive password vs Google OAuth.
 */
export type UserAuthProvider = 'google' | 'password';

/**
 * Defines the shape of user.
 */
export interface User {
  /** Stable application user identifier stored as the Mongo profile key (compatibility alias retained as userId). */
  userId: string;
  email: string;
  name?: string;
  hasCompletedOnboarding: boolean;
  role: UserRole;
  /** Sign-in method; set on every profile at creation. */
  authProvider: UserAuthProvider;
  /** Profile creation timestamp in ISO 8601 string format, sourced from Mongo document creation time. */
  $createdAt: string;
  /** Profile update timestamp in ISO 8601 string format, sourced from Mongo document update time. */
  $updatedAt: string;
  /** Per-platform upload default settings (e.g. YouTube field presets for new drafts). */
  platformDefaults?: PlatformDefaults;
}

/** Platform identifier; shared with ConnectedAccount and PlatformUpload. */
export type ConnectedAccountPlatform =
  | 'youtube'
  | 'vimeo'
  | 'google_drive'
  | 'sftp'
  | 'smb'
  | 'sermon_audio';

/** Platforms we support for drafts, uploads, and connections (extend as you add backends). */
export const CONNECTED_ACCOUNT_PLATFORMS: readonly ConnectedAccountPlatform[] = [
  'youtube',
  'vimeo',
  'google_drive',
  'sftp',
  'smb',
  'sermon_audio',
];

/** SFTP authentication method stored on a connected account. */
export type SftpAuthMethod = 'key' | 'password';

/** SFTP-only fields inside the draft `document.platforms` JSON (no publish options yet). */
export interface SftpDraftFields {}

/** SMB/CIFS draft fields placeholder (no publish-specific options yet). */
export interface SmbDraftFields {}

/**
 * Optional per-platform overrides for shared draft copy (title, description, tags).
 * When set, distribution uses these values instead of the document-root fields for that platform.
 */
export interface PerPlatformCopyOverrides {
  /** Platform-specific title; maps to each API's title field (e.g. SA `fullTitle`, YouTube `snippet.title`). */
  titleOverride?: string;
  /** Platform-specific description/body text. */
  descriptionOverride?: string;
  /** Platform-specific tags; mapped per API (e.g. YouTube `snippet.tags`, Vimeo `tags`). */
  tagsOverride?: string[];
}

/**
 * Optional per-platform overrides for shared draft metadata (title, description, tags, visibility).
 * When set, distribution uses these values instead of the document-root fields for that platform.
 */
export interface PerPlatformOverrides extends PerPlatformCopyOverrides {
  /** Platform-specific privacy (YouTube and Vimeo only). */
  visibilityOverride?: PlatformUploadVisibility;
}

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
export interface YouTubeDraftFields extends PerPlatformOverrides {
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
  /**
   * `videos.insert` query parameter `notifySubscribers`. When `false`, subscribers are not
   * notified and the video is omitted from the subscriptions feed. Omitted/`true` matches YouTube default (notify).
   */
  notifySubscribers?: boolean;
  /** `status.publishAt` (ISO 8601). Requires `privacyStatus` private until publish time. */
  publishAt?: string;
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
  /**
   * Recording date sent to `recordingDetails.recordingDate` (RFC 3339 full-date, e.g. "2025-06-08").
   * Omitted from upload unless explicitly set.
   */
  recordingDate?: string;
}

/**
 * User-saved default values for YouTube upload fields.
 * Loaded when initialising a new draft's `platforms.youtube` block.
 * Stored on the user profile under `platformDefaults.youtube`.
 */
export interface YouTubeUserDefaults {
  madeForKids?: boolean;
  /** BCP-47 video language (`snippet.defaultAudioLanguage`). */
  defaultAudioLanguage?: string;
  license?: 'youtube' | 'creativeCommon';
  embeddable?: boolean;
  categoryId?: string;
}

/** Per-platform upload default settings stored on the user profile. */
export interface PlatformDefaults {
  youtube?: YouTubeUserDefaults;
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

/**
 * Defines the VimeoPrivacyComments type.
 */
export type VimeoPrivacyComments = 'anybody' | 'contacts' | 'nobody';
/**
 * Defines the VimeoPrivacyEmbed type.
 */
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

/**
 * Defines the shape of vimeo draft privacy.
 */
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
export interface VimeoDraftFields extends PerPlatformOverrides {
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
 * SermonAudio-only fields inside the draft `document.platforms` JSON.
 * Shared copy (title, description, tags) lives at the document root unless overridden here.
 *
 * Field names align with SermonAudio `POST /v2/node/sermons` where applicable.
 */
export interface SermonAudioDraftFields extends PerPlatformCopyOverrides {
  /** SermonAudio speaker name. */
  speakerName?: string;
  /** SermonAudio speaker id when selected from SA speaker records. */
  speakerID?: number;
  /** Preach date (`YYYY-MM-DD`). */
  preachDate?: string;
  /** Event type from `GET /v2/node/filter_options/sermon_event_types`. */
  eventType?: string;
  /** Series or sub-heading label (SA `subtitle`; distinct from `displayTitle`). */
  subtitle?: string;
  /** SermonAudio series id when selected from SA series records. */
  seriesID?: number;
  /** Scripture reference text (SA `bibleText`). */
  bibleText?: string;
  /** Short title when the full title is long (SA `displayTitle`; not the series name). */
  displayTitle?: string;
  /** Language code (e.g. ISO 639-1). */
  languageCode?: string;
  /** When not explicitly false, publish automatically after SA video processing completes (defaults to on). */
  autoPublishOnProcessed?: boolean;
  /**
   * SermonAudio Cross Publish destinations (YouTube, Facebook, X) configured for this draft.
   * Mapped to `socialSharing` on sermon create; `publishSermonAudio` only PATCHes `publishDate`.
   */
  crossPublish?: SermonAudioCrossPublishSettings;
}

/** Cross Publish destination id stored under `SermonAudioDraftFields.crossPublish`. */
export type SermonAudioCrossPublishTarget = 'youtube' | 'facebook' | 'x';

/**
 * Cross Publish options for one social destination (SermonAudio dashboard feature).
 * @property postLink - Post a link to the sermon (Facebook and X only).
 * @property uploadFullVideo - Upload the full sermon video (YouTube and Facebook).
 * @property uploadVideoPreview - Upload a video preview clip (X/Twitter; maps to SA `useVideoClip`).
 * @property linkMessage - Custom message when `postLink` is enabled (Facebook and X).
 * @property title - YouTube video title when `uploadFullVideo` is enabled (maps to SA `title` on `google`).
 * @property description - YouTube video description when `uploadFullVideo` is enabled (maps to SA `message` on `google`).
 * @property privacy - YouTube visibility when `uploadFullVideo` is enabled (maps to SA `privacy` on `google`).
 */
export interface SermonAudioCrossPublishPlatformSettings {
  postLink?: boolean;
  uploadFullVideo?: boolean;
  uploadVideoPreview?: boolean;
  linkMessage?: string;
  title?: string;
  description?: string;
  privacy?: SermonAudioCrossPublishYouTubePrivacy;
}

/** YouTube Cross Publish visibility (SermonAudio Connections → YouTube). */
export type SermonAudioCrossPublishYouTubePrivacy = 'public' | 'unlisted' | 'private';

/** Cross Publish per-platform toggle id stored on `SermonAudioCrossPublishPlatformSettings`. */
export type SermonAudioCrossPublishOptionId = 'postLink' | 'uploadFullVideo' | 'uploadVideoPreview';

/**
 * Cross Publish settings grouped by destination platform.
 * @property enabled - Master Cross Publish toggle for the draft.
 * @property youtube - YouTube Cross Publish options.
 * @property facebook - Facebook Cross Publish options.
 * @property x - X (Twitter) Cross Publish options.
 */
export interface SermonAudioCrossPublishSettings {
  enabled?: boolean;
  youtube?: SermonAudioCrossPublishPlatformSettings;
  facebook?: SermonAudioCrossPublishPlatformSettings;
  x?: SermonAudioCrossPublishPlatformSettings;
}

/**
 * Per-platform metadata on a draft (inside `document` JSON).
 * Publish targets use `platforms.youtube` / `platforms.vimeo` / `platforms.sermon_audio`.
 * Google Drive is selected via `targets` only (no `platforms.google_drive` key).
 * SFTP / SMB may use `platforms.sftp` / `platforms.smb` as empty placeholders until backup-specific fields exist.
 */
export interface DraftPlatforms {
  youtube?: YouTubeDraftFields;
  vimeo?: VimeoDraftFields;
  sermon_audio?: SermonAudioDraftFields;
  sftp?: SftpDraftFields;
  smb?: SmbDraftFields;
}

/**
 * Defines the shape of draft.
 */
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
   * Not stored in persistent storage.
   */
  thumbnailPreviewUrl?: string;
  /**
   * When this draft was first used to create an upload job.
   * Stored on the draft (denormalized) to avoid scanning upload job history.
   */
  usedInUploadAt?: string;
  /** Persistence system attribute (ISO string). */
  $createdAt: string;
  /** Persistence system attribute (ISO string). */
  $updatedAt: string;
}

/**
 * Defines the UploadJobStatus type.
 */
export type UploadJobStatus =
  | 'pending'
  | 'uploading'
  | 'distributing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Defines the shape of upload job.
 */
export interface UploadJob {
  id: string;
  userId: string;
  draftId: string | null;
  /** R2 object key for the uploaded video file. For new jobs this is set at creation; may be null only for legacy/backfill rows or if job creation is ever decoupled from presign. */
  r2Key: string | null;
  status: UploadJobStatus;
  errorMessage: string | null;
  /** Persistence system attribute (ISO string). */
  $createdAt: string;
  /** Persistence system attribute (ISO string). */
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
  /** Persistence system attribute (ISO string). */
  $createdAt: string;
  /** Persistence system attribute (ISO string). */
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
  /** SFTP server hostname or IP (SFTP accounts only). */
  sftpHost?: string;
  /** SFTP server port (SFTP accounts only; default 22). */
  sftpPort?: number;
  /** Absolute remote directory for backups (SFTP accounts only). */
  sftpRemotePath?: string;
  /** Whether the stored credential is an SSH key or password (SFTP accounts only). */
  sftpAuthMethod?: SftpAuthMethod;
  /** SHA-256 host key fingerprint pinned after the first successful SFTP connect (SFTP accounts only). */
  sftpHostKeyFingerprint?: string;
  /** SMB server hostname or IP (SMB accounts only). */
  smbHost?: string;
  /** SMB share name without UNC prefix (SMB accounts only). */
  smbShare?: string;
  /** Windows domain or workgroup (SMB accounts only; optional). */
  smbDomain?: string;
  /** Path within the share for backups, e.g. `/VideoSphere` (SMB accounts only). */
  smbRemotePath?: string;
  /** Persistence system attribute (ISO string). */
  $createdAt: string;
  /** Persistence system attribute (ISO string). */
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

/**
 * Defines the shape of example item.
 */
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
