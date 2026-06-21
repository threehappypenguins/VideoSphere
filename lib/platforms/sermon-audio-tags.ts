import { MIN_YOUTUBE_TAG_LENGTH } from '@/lib/youtube-metadata-limits';

/**
 * Normalizes a user-entered tag or hashtag for storage (trim, strip leading `#`).
 * @param tag - Raw tag text from the draft editor.
 * @returns Trimmed tag without leading hash characters.
 */
export function normalizeTagForStorage(tag: string): string {
  return tag.trim().replace(/^#+/, '').trim();
}

/**
 * Returns whether a normalized shared tag meets YouTube's minimum tag length.
 * @param tag - Raw or normalized tag text.
 * @returns True when the tag has at least {@link MIN_YOUTUBE_TAG_LENGTH} characters after normalization.
 */
export function isYouTubeCompatibleTagLength(tag: string): boolean {
  return normalizeTagForStorage(tag).length >= MIN_YOUTUBE_TAG_LENGTH;
}

/**
 * Splits parsed shared tags into accepted and too-short lists for YouTube-compatible targets.
 * @param tags - Parsed tag strings.
 * @returns Tags that meet the minimum length and tags rejected for being too short.
 */
export function partitionYouTubeCompatibleTags(tags: readonly string[]): {
  accepted: string[];
  tooShort: string[];
} {
  const accepted: string[] = [];
  const tooShort: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTagForStorage(tag);
    if (!normalized) continue;
    if (normalized.length < MIN_YOUTUBE_TAG_LENGTH) {
      tooShort.push(normalized);
    } else {
      accepted.push(normalized);
    }
  }
  return { accepted, tooShort };
}

/**
 * Builds a user-facing message when one or more tags were too short to add.
 * @param tooShort - Rejected tag strings.
 * @returns Sentence explaining the minimum length rule.
 */
export function formatTooShortYouTubeTagMessage(tooShort: readonly string[]): string {
  const quoted = tooShort.map((tag) => `"${tag}"`).join(', ');
  if (tooShort.length === 1) {
    return `Tags must be at least ${MIN_YOUTUBE_TAG_LENGTH} characters. ${quoted} was not added.`;
  }
  return `Tags must be at least ${MIN_YOUTUBE_TAG_LENGTH} characters. ${quoted} were not added.`;
}

/**
 * Parses comma-separated shared tag input (spaces allowed within each tag).
 * @param raw - Raw text from the tag input field.
 * @returns Normalized tag strings ready to store on the draft.
 */
export function parseSharedTagInput(raw: string): string[] {
  return raw.split(',').map(normalizeTagForStorage).filter(Boolean);
}

/**
 * Parses SermonAudio hashtag input (one word per tag; whitespace separates tokens).
 * @param raw - Raw text from a SermonAudio hashtag input field.
 * @returns Normalized single-word hashtag strings.
 */
export function parseSermonAudioHashtagInput(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((part) => normalizeTagForStorage(part).replace(/\s+/g, ''))
    .filter(Boolean);
}

/**
 * Formats draft tags into SermonAudio `keywords` (no spaces within each hashtag).
 * @param tags - Tag list from shared or per-platform draft metadata.
 * @returns Comma-separated keywords for the SermonAudio create-sermon API.
 */
export function formatSermonAudioKeywordsFromTags(tags: readonly string[]): string {
  return tags
    .map((tag) => normalizeTagForStorage(tag).replace(/\s+/g, ''))
    .filter(Boolean)
    .join(', ');
}

/**
 * Returns whether a tag already exists in a list (case-insensitive, `#`-agnostic).
 * @param tags - Existing stored tags.
 * @param candidate - Tag to check for duplication.
 * @returns True when an equivalent tag is already present.
 */
export function tagListIncludesEquivalent(tags: readonly string[], candidate: string): boolean {
  const normalizedCandidate = normalizeTagForStorage(candidate).toLowerCase();
  if (!normalizedCandidate) return false;
  return tags.some(
    (existing) => normalizeTagForStorage(existing).toLowerCase() === normalizedCandidate
  );
}

/**
 * Merges parsed tags into an existing list without duplicates.
 * @param tags - Existing stored tags.
 * @param parsed - Newly parsed tags to add.
 * @returns Updated tag list.
 */
export function mergeUniqueTags(tags: readonly string[], parsed: readonly string[]): string[] {
  const merged = [...tags];
  for (const tag of parsed) {
    if (!tagListIncludesEquivalent(merged, tag)) {
      merged.push(tag);
    }
  }
  return merged;
}
