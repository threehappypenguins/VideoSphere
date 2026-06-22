import { updateUser } from '@/lib/repositories/users';
import type { YouTubeLivestreamFields, YouTubeUserDefaults } from '@/types';

/**
 * Maps explicit YouTube livestream platform fields to storable user profile defaults.
 * @param youtube - `platforms.youtube` from a saved or scheduled livestream.
 * @returns Profile patch fields, or undefined when nothing should be persisted.
 */
export function youtubeLivestreamFieldsToUserDefaults(
  youtube: YouTubeLivestreamFields | undefined
): Partial<YouTubeUserDefaults> | undefined {
  if (!youtube) {
    return undefined;
  }

  const out: Partial<YouTubeUserDefaults> = {};

  const categoryId = youtube.categoryId?.trim();
  if (categoryId) {
    out.categoryId = categoryId;
  }

  const defaultAudioLanguage = youtube.defaultAudioLanguage?.trim();
  if (defaultAudioLanguage) {
    out.defaultAudioLanguage = defaultAudioLanguage;
  }

  if (typeof youtube.madeForKids === 'boolean') {
    out.madeForKids = youtube.madeForKids;
  }

  if (youtube.license === 'youtube' || youtube.license === 'creativeCommon') {
    out.license = youtube.license;
  }

  if (typeof youtube.embeddable === 'boolean') {
    out.embeddable = youtube.embeddable;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Saves YouTube livestream metadata choices onto the user's profile defaults for future drafts.
 * Failures are logged and do not propagate to callers.
 * @param userId - Authenticated user id.
 * @param youtube - `platforms.youtube` to remember as defaults.
 */
export async function persistUserYouTubePlatformDefaults(
  userId: string,
  youtube: YouTubeLivestreamFields | undefined
): Promise<void> {
  const patch = youtubeLivestreamFieldsToUserDefaults(youtube);
  if (!patch) {
    return;
  }

  try {
    await updateUser(userId, { platformDefaultsYoutube: patch });
  } catch (err) {
    console.error('[persistUserYouTubePlatformDefaults]', err);
  }
}
