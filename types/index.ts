// =============================================================================
// SHARED TYPE DEFINITIONS
// =============================================================================
// Place your shared TypeScript types and interfaces in this file.
// Types that are used across multiple components or pages belong here.
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
  /** Per-platform upload defaults stored on the profile (`platformDefaults`; profile GET/PATCH today). */
  platformDefaults?: PlatformDefaults;
  /** Cross-device UI preferences (profile GET/PATCH). */
  preferences?: UserPreferences;
}

/** User-selectable clock format for schedule time pickers and labels. */
export type UserClockFormat = '12' | '24';

/**
 * User preferences stored on the profile and synced across devices.
 * @property clockFormat - Schedule/time display format. Defaults to `'12'`.
 */
export interface UserPreferences {
  clockFormat?: UserClockFormat;
}

/** Platform identifier; shared with ConnectedAccount and PlatformUpload. */
export type ConnectedAccountPlatform =
  | 'youtube'
  | 'vimeo'
  | 'google_drive'
  | 'sftp'
  | 'smb'
  | 'sermon_audio'
  | 'facebook';

/** Platforms we support for drafts, uploads, and connections (extend as you add backends). */
export const CONNECTED_ACCOUNT_PLATFORMS: readonly ConnectedAccountPlatform[] = [
  'youtube',
  'vimeo',
  'google_drive',
  'sftp',
  'smb',
  'sermon_audio',
  'facebook',
];

/** Livestream distribution platforms (extend as you add backends). */
export const LIVESTREAM_PLATFORMS = [
  'youtube',
  'facebook',
] as const satisfies readonly ConnectedAccountPlatform[];

/** SFTP authentication method stored on a connected account. */
export type SftpAuthMethod = 'key' | 'password';

/** Supported date tokens for backup filename prefixes. */
export type BackupDateFormat = 'YYYYMMDD' | 'YYYY-MM-DD' | 'YYYYDDMM' | 'YYYY-DD-MM';

/** AM/PM suffix appended directly to the formatted date prefix. */
export type BackupDateSuffix = 'AM' | '-AM' | 'PM' | '-PM';

/**
 * Draft-level backup filename settings for Google Drive, SFTP, and SMB uploads.
 * Stored in the draft `document` JSON as `backupNaming`.
 */
export interface BackupFileNameSettings {
  /** When true, prefix the filename with the selected date. Default true. */
  datePrefixEnabled?: boolean;
  /** Calendar date for the prefix (`YYYY-MM-DD`). Defaults to today in the editor when unset. */
  datePrefixDate?: string;
  /** Date format used when {@link datePrefixEnabled} is true. Default `YYYYMMDD`. */
  dateFormat?: BackupDateFormat;
  /** When true, append {@link dateSuffix} directly to the formatted date prefix. Default false. */
  dateSuffixEnabled?: boolean;
  /** AM/PM token appended to the date prefix when {@link dateSuffixEnabled} is true. Default `AM`. */
  dateSuffix?: BackupDateSuffix;
  /** When true, include the optional series segment between date and title. Default false. */
  seriesEnabled?: boolean;
  /** Series label inserted when {@link seriesEnabled} is true. */
  series?: string;
  /** When true, append {@link suffix} in parentheses after the title. Default false. */
  suffixEnabled?: boolean;
  /** Label appended as `(suffix)` after the title when {@link suffixEnabled} is true. */
  suffix?: string;
  /** When true, store backups in a `{year}/` subfolder under the configured remote root. Default true. */
  yearFolderEnabled?: boolean;
  /** When true, inject MP4/MOV metadata atoms during backup upload via ffmpeg (no re-encode). Default false. */
  metadataEnabled?: boolean;
  /** Album artist metadata (`album_artist` atom) when {@link metadataEnabled} is true. */
  albumArtist?: string;
  /** Album metadata (`album` atom) when {@link metadataEnabled} is true. */
  album?: string;
  /** Genre metadata (`genre` atom) when {@link metadataEnabled} is true. */
  genre?: string;
}

/** SFTP backup fields inside the draft `document.platforms` JSON. */
export interface SftpDraftFields extends Pick<PerPlatformCopyOverrides, 'titleOverride'> {}

/** SMB/CIFS backup fields inside the draft `document.platforms` JSON. */
export interface SmbDraftFields extends Pick<PerPlatformCopyOverrides, 'titleOverride'> {}

/** Google Drive backup fields inside the draft `document.platforms` JSON. */
export interface GoogleDriveDraftFields extends Pick<PerPlatformCopyOverrides, 'titleOverride'> {}

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
  /**
   * Platform-specific draft thumbnail R2 key when not using the shared draft thumbnail.
   * - Omitted/`undefined` — use the shared draft thumbnail.
   * - `''` — explicit per-platform “no thumbnail” (do not fall back to shared).
   * - `null` — PATCH/editor clear sentinel; merge removes the override so shared is used again.
   */
  thumbnailR2KeyOverride?: string | null;
  /**
   * MIME type for {@link thumbnailR2KeyOverride}.
   * Uses the same `undefined` / `''` / `null` semantics as {@link thumbnailR2KeyOverride}.
   */
  thumbnailContentTypeOverride?: string | null;
  /**
   * Presigned preview URL for {@link thumbnailR2KeyOverride} in the draft editor only.
   * Not persisted in draft document JSON.
   */
  thumbnailPreviewUrlOverride?: string;
}

/** Platform upload status. SermonAudio uses `unpublished` / `published` after upload instead of `completed`. */
export type PlatformUploadStatus =
  | 'pending'
  | 'uploading'
  | 'completed'
  | 'unpublished'
  | 'published'
  | 'failed';

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
  /** `snippet.defaultAudioLanguage` (BCP-47). `null` means explicitly cleared (no language). */
  defaultAudioLanguage?: string | null;
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
  /**
   * When true, marks this draft as a YouTube Short (UI icon + shorts URL on success).
   * Classification is automatic from format and duration.
   */
  isShort?: boolean;
}

/**
 * User-saved default values for YouTube upload fields on the profile.
 * Persisted under `platformDefaults.youtube` and updated via GET/PATCH `/api/auth/profile`.
 * The draft and livestream editors seed `platforms.youtube` from `/api/platforms/youtube/account-defaults`,
 * which merges these profile defaults on top of values read from YouTube.
 */
export interface YouTubeUserDefaults {
  madeForKids?: boolean;
  /** BCP-47 audio language (`snippet.defaultAudioLanguage`; distinct from `defaultLanguage`). */
  defaultAudioLanguage?: string;
  license?: 'youtube' | 'creativeCommon';
  embeddable?: boolean;
  categoryId?: string;
}

/** Per-platform upload default settings stored on the user profile. */
export interface PlatformDefaults {
  youtube?: YouTubeUserDefaults;
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
   * Category hints for `PUT /videos/{id}/categories` batch body.
   * @remarks
   * Each entry may be a bare slug, full `vimeo.com` URL, or one of:
   * - `/categories/{slug}` — top-level category
   * - `/categories/{parent}/subcategories/{slug}` — API subcategory path (e.g. Animation)
   * - `/categories/{parent}/{slug}` — short-form subcategory path (e.g. Branded Content)
   *
   * Connection URIs such as `/categories/{parent}/videos` are not valid selections.
   */
  categoryUris?: string[];
  /**
   * Stored Vimeo upload license selection.
   * @remarks
   * - `undefined` — no draft override; UI falls back to {@link VimeoAccountDefaults.license}
   *   and seeding may copy the connected account default onto the draft.
   * - `null` — explicit “no Creative Commons license” override (Vimeo upload UI label:
   *   “Select a license…”, **not** “All Rights Reserved”).
   * - `'by-nc'`, etc. — explicit Creative Commons license code from `GET /creativecommons`.
   *
   * Upload omits `license` on create when unset or `null`; only CC codes are sent.
   * Do not add a separate “All Rights Reserved” picker option — that label is internal/API
   * shorthand only and does not appear in Vimeo’s upload UI.
   */
  license?: VimeoVideoLicense | null;
  /**
   * Stored Vimeo `content_rating` codes for draft metadata and upload resolution.
   * @remarks
   * - `undefined` — not selected in the UI (field omitted on upload).
   * - `null` — explicit “Not selected” clear sent on PATCH; normalized to `undefined` when stored.
   * - `['safe']` — All audiences.
   * - `[]` — Mature tier selected with no detail flags yet (draft/UI placeholder only;
   *   omitted on upload until one or more mature-detail codes are chosen).
   * - `['language', …]` — one or more mature-detail codes from `GET /contentratings`
   *   (every API row except `safe` and `unrated`).
   */
  contentRating?: string[] | null;
}

/**
 * Facebook Reels API–specific draft fields.
 * Stored under `platforms.facebook` in the draft `document` JSON.
 */
export interface FacebookDraftFields
  extends
    Pick<PerPlatformCopyOverrides, 'titleOverride' | 'descriptionOverride'>,
    Pick<
      PerPlatformOverrides,
      'thumbnailR2KeyOverride' | 'thumbnailContentTypeOverride' | 'thumbnailPreviewUrlOverride'
    > {
  /**
   * Desired publish state sent as `video_state` on the finish call.
   * - `PUBLISHED` — publish immediately (default)
   * - `SCHEDULED` — schedule for `scheduledPublishTime`
   */
  videoState?: 'PUBLISHED' | 'SCHEDULED';

  /**
   * Unix timestamp (seconds) for scheduled publish.
   * Required when `videoState` is `SCHEDULED`.
   * Must be between 10 minutes and 75 days from now (Facebook scheduling limit).
   */
  scheduledPublishTime?: number;
}

/**
 * SermonAudio-only fields inside the draft `document.platforms` JSON.
 * Shared copy (title, description, tags) lives at the document root unless overridden here.
 *
 * Field names align with SermonAudio `POST /v2/node/sermons` where applicable.
 */
export interface SermonAudioDraftFields
  extends
    PerPlatformCopyOverrides,
    Pick<
      PerPlatformOverrides,
      'thumbnailR2KeyOverride' | 'thumbnailContentTypeOverride' | 'thumbnailPreviewUrlOverride'
    > {
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
  /** Language code from `GET /v2/node/languages` (SA `languageCode`; defaults to `en`). */
  languageCode?: string;
  /** When not explicitly false, publish automatically after SA video processing completes (defaults to on). */
  autoPublishOnProcessed?: boolean;
  /**
   * Scheduled publication datetime for SermonAudio (`publishDate` on sermon create).
   * ISO 8601 wall-clock datetime, typically with offset (for example `2026-07-01T09:00:00-04:00`).
   * When set, `autoPublishOnProcessed` is disabled and the sermon goes live at this time.
   */
  publishDate?: string;
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
 * Backup targets may store per-destination title overrides on `platforms.google_drive`,
 * `platforms.sftp`, and `platforms.smb`.
 */
export interface DraftPlatforms {
  youtube?: YouTubeDraftFields;
  vimeo?: VimeoDraftFields;
  sermon_audio?: SermonAudioDraftFields;
  google_drive?: GoogleDriveDraftFields;
  sftp?: SftpDraftFields;
  smb?: SmbDraftFields;
  facebook?: FacebookDraftFields;
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
  /** Backup filename settings applied to Google Drive, SFTP, and SMB uploads. */
  backupNaming?: BackupFileNameSettings;
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

/** Lifecycle status for a scheduled livestream. */
export type LivestreamStatus = 'draft' | 'scheduled' | 'live' | 'ended' | 'failed';

/**
 * Which YouTube stream key slot is bound to a livestream.
 * Absent/`undefined` means no key is assigned yet (not a third enum value).
 */
export type LivestreamKeySlot = 'main' | 'temp';

/**
 * YouTube-only fields inside the livestream `document.platforms` JSON.
 * Shared copy (title, description, tags) lives at the document root.
 *
 * Field names align with YouTube Data API v3 live broadcast settings where applicable.
 */
export interface YouTubeLivestreamFields {
  /** YouTube Data API `snippet.categoryId` on the live broadcast (numeric string, e.g. "22"). */
  categoryId?: string;
  /** Maps to `status.selfDeclaredMadeForKids` on the live broadcast. */
  madeForKids?: boolean;
  /** `snippet.defaultAudioLanguage` (BCP-47) on the live broadcast. `null` means explicitly cleared. */
  defaultAudioLanguage?: string | null;
  /** `status.embeddable` on the live broadcast. */
  embeddable?: boolean;
  /** `status.license` on the live broadcast: standard YouTube license vs Creative Commons. */
  license?: 'youtube' | 'creativeCommon';
  /**
   * Notify subscribers when the live broadcast goes live (`notifySubscribers` on the live broadcast).
   * Omitted/`true` matches YouTube default (notify).
   */
  notifySubscribers?: boolean;
  /**
   * After the broadcast ends, append the archived video via `playlistItems.insert` (one call per id).
   * Playlist ids on the live broadcast, not the video draft.
   */
  playlistIds?: string[];
  /**
   * Playlist titles on the live broadcast (`snippet.title`). Same resolution flow as video drafts.
   * Stored on the live broadcast, not the video draft.
   */
  playlistTitles?: string[];
  /**
   * Default thumbnail URL on YouTube after upload (`thumbnails.set` / `videos.list`).
   * Server-managed — not accepted from client PATCH bodies.
   */
  thumbnailUrl?: string;
  /**
   * ISO timestamp of the last YouTube thumbnail upload from VideoSphere.
   * Used to bust CDN caches when building preview URLs.
   */
  thumbnailUpdatedAt?: string;
}

/**
 * Facebook-only fields inside the livestream `document.platforms` JSON.
 * Reserved for future per-stream Facebook options.
 */
export interface FacebookLivestreamFields {}

/**
 * Per-platform metadata on a livestream (inside `document` JSON).
 * Publish targets use `platforms.youtube` and `platforms.facebook`.
 */
export interface LivestreamPlatforms {
  youtube?: YouTubeLivestreamFields;
  facebook?: FacebookLivestreamFields;
}

/**
 * Scheduled livestream document stored in the `livestreams` collection.
 *
 * **YouTube key-slot lifecycle:** A new livestream starts as a `draft` with no `scheduledStartTime`
 * or `keySlot`. When the user schedules it, the server assigns either the `main` or `temp`
 * YouTube stream key from the connected account. If the main key is already in use, scheduling
 * uses `temp` instead. A background reconciliation job may later promote `temp` → `main` when
 * the main slot frees up (`keySwapPromotedAt` records when that promotion occurred).
 * `keySlot` and related fields are YouTube-only; Facebook livestreams never use them.
 *
 * **Facebook arm lifecycle:** Facebook has no main/temp stream-key concept. Only one Facebook
 * livestream per user may be "armed" (have a real `facebookLiveVideoId`) at a time. The first
 * scheduled Facebook livestream creates its `LiveVideo` immediately; additional queued rows
 * create theirs automatically at the auto-preparation window before start (`autoPromoteToMainKey`
 * / `autoPromoteToMainKeyMinutes`, shared with YouTube temp→main promotion timing).
 */
export interface Livestream {
  id: string;
  userId: string;
  status: LivestreamStatus;
  title: string;
  description: string;
  tags: string[];
  visibility: PlatformUploadVisibility;
  /** Platforms this livestream is configured to broadcast to (UI toggles). */
  targets: ConnectedAccountPlatform[];
  /** Per-platform-only options (e.g. YouTube categoryId, live comment settings). */
  platforms: LivestreamPlatforms;
  /** ISO 8601 scheduled start time; undefined while still a draft. */
  scheduledStartTime?: string;
  /** IANA timezone for interpreting {@link scheduledStartTime} in the schedule picker (e.g. `America/Toronto`). */
  scheduledStartTimeZone?: string;
  /** R2 object key for a custom thumbnail image (JPG or PNG), or undefined if none. */
  thumbnailR2Key?: string;
  /** MIME type of the thumbnail object (for platform upload and preview). */
  thumbnailContentType?: string;
  /**
   * Ephemeral presigned GET URL for the livestream form preview.
   * Not stored in persistent storage.
   */
  thumbnailPreviewUrl?: string;
  /** YouTube `liveBroadcasts` resource id after the broadcast is created. */
  youtubeBroadcastId?: string;
  /** YouTube `liveStreams` resource id bound to this broadcast. */
  youtubeBoundStreamId?: string;
  /** Which connected-account stream key slot is assigned (`main` or `temp`). */
  keySlot?: LivestreamKeySlot;
  /** ISO timestamp when a `temp` key slot was promoted to `main` during reconciliation. */
  keySwapPromotedAt?: string;
  /**
   * ISO timestamp when a main-slot livestream never went live and was moved to temp / ended
   * so a queued livestream could take the main key.
   */
  keySlotStaleAt?: string;
  /**
   * When true on a temp-slot livestream, a background job promotes it to the main key
   * before start. Defaults to enabled for temp-slot rows when unset.
   */
  autoPromoteToMainKey?: boolean;
  /** Minutes before scheduled start to auto-promote temp → main (5–60, step 5; default 30). */
  autoPromoteToMainKeyMinutes?: number;
  /** Raw YouTube `liveBroadcasts.status.lifeCycleStatus` value (polled later). */
  youtubeLifecycleStatus?: string;
  /** Facebook `LiveVideo` object id; created at arm time, not at schedule time. */
  facebookLiveVideoId?: string;
  /**
   * RTMPS ingest URL returned when the Facebook `LiveVideo` is created
   * (`rtmps://live-api-s.facebook.com:443/rtmp/FB-<id>-0-<token>`). Single-use per object;
   * there is no reusable/persistent equivalent. Encrypted at rest in the livestream document JSON.
   */
  facebookStreamUrl?: string;
  /** ISO timestamp when the Facebook `LiveVideo` object was created (arm time). */
  facebookArmedAt?: string;
  /** Raw Facebook `LiveVideo.status` value (`UNPUBLISHED`, `LIVE_NOW`, `VOD`; polled later). */
  facebookLifecycleStatus?: string;
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
  /** SermonAudio: auto-publish intent snapshot from distribute time. */
  sermonAudioAutoPublishOnProcessed?: boolean;
  /** Provider resumable session URL/URI when a platform supports chunked resume. */
  resumableUploadUrl?: string | null;
  /** Last byte offset confirmed by the provider for an in-progress resumable upload. */
  resumableBytesConfirmed?: number | null;
  /** ISO timestamp of the last persisted resumable-state update (staleness checks). */
  resumableUpdatedAt?: string | null;
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
  /** Folder path within My Drive for backups; empty or `/` means Drive root (Google Drive only). */
  googleDriveBackupFolderPath?: string;
  /** Facebook publish target: Page or personal profile (Facebook accounts only). */
  facebookTargetType?: 'page' | 'profile';
  /** Facebook Page ID when `facebookTargetType` is `page` (Facebook accounts only). */
  facebookPageId?: string;
  /** True when a non-empty YouTube main stream key is stored (encrypted at rest). */
  hasYoutubeMainStreamKey: boolean;
  /** True when a non-empty YouTube temp stream key is stored (encrypted at rest). */
  hasYoutubeTempStreamKey: boolean;
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
  /** Decrypted YouTube main stream key (server-only; never sent to the client). */
  youtubeMainStreamKey?: string;
  /** Decrypted YouTube temp stream key (server-only; never sent to the client). */
  youtubeTempStreamKey?: string;
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
