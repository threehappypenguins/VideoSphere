/**
 * Client-safe YouTube metadata limits shared by drafts, livestreams, and API routes.
 */

/** Matches YouTube Data API `videos.snippet.title` maximum length. */
export const MAX_DRAFT_TITLE_LENGTH = 100;

/** YouTube Studio rejects single-character tags; match that minimum in our editors. */
export const MIN_YOUTUBE_TAG_LENGTH = 2;
