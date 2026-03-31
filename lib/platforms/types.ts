/**
 * Cross-platform upload types — shared between YouTube, Vimeo, and draft → distribute metadata.
 * Per-platform fields stay in separate optional interfaces and are composed into {@link PlatformUploadMetadata}.
 */

import type { PlatformUploadVisibility, VimeoDraftFields } from '@/types';

/** Copy and visibility applied to every target platform. */
export interface SharedPlatformUploadMetadata {
  title: string;
  description: string;
  tags: string[];
  visibility: PlatformUploadVisibility;
  /** R2 key for custom thumbnail image (optional). */
  thumbnailR2Key?: string;
  thumbnailContentType?: string;
}

/** YouTube Data API upload–specific fields (omit unused keys for Vimeo-only jobs). */
export interface YoutubeSpecificUploadMetadata {
  /** YouTube Data API `snippet.categoryId`; omit to use server default. */
  categoryId?: string;
  /** YouTube `status.selfDeclaredMadeForKids` when set. */
  madeForKids?: boolean;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  embeddable?: boolean;
  license?: 'youtube' | 'creativeCommon';
  publicStatsViewable?: boolean;
  publishAt?: string;
  containsSyntheticMedia?: boolean;
  playlistIds?: string[];
  /**
   * Resolved with `playlists.list` then `playlists.insert` if no title match, then `playlistItems.insert`
   * (same pattern as [porjo/youtubeuploader](https://github.com/porjo/youtubeuploader) `playlistTitles` / `playlistIds`).
   * New playlists use the video’s `privacyStatus`.
   */
  playlistTitles?: string[];
}

/** Vimeo API upload–specific fields (omit unused keys for YouTube-only jobs). */
export interface VimeoSpecificUploadMetadata {
  /** `/categories/{slug}`, plain slug, or vimeo.com category URL. */
  vimeoCategoryUri?: string;
  /** Vimeo-only create options (from draft `platforms.vimeo`). */
  vimeo?: VimeoDraftFields;
}

/**
 * Draft → adapter payload: shared copy plus optional per-platform blocks (flat merge for convenience).
 */
export type PlatformUploadMetadata = SharedPlatformUploadMetadata &
  YoutubeSpecificUploadMetadata &
  VimeoSpecificUploadMetadata;

export interface PlatformUploadTokens {
  accessToken: string;
  refreshToken?: string;
  tokenExpiry?: string;
}

export interface PlatformUploadError {
  code: string;
  message: string;
  statusCode?: number;
  details?: string;
}

export type PlatformUploadResult =
  | { ok: true; platformVideoId: string; platformUrl: string }
  | { ok: false; error: PlatformUploadError };
