/**
 * Normalizes a user-entered tag or hashtag for storage (trim, strip leading `#`).
 * @param tag - Raw tag text from the draft editor.
 * @returns Trimmed tag without leading hash characters.
 */
export function normalizeTagForStorage(tag: string): string {
  return tag.trim().replace(/^#+/, '').trim();
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
