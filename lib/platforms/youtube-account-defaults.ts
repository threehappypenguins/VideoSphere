import type { YouTubeDraftFields } from '@/types';

/** Upload metadata defaults read from the connected YouTube account. */
export interface YouTubeAccountDefaults {
  /** BCP-47 audio language from the channel or most recent upload (`snippet.defaultAudioLanguage`). */
  defaultAudioLanguage?: string;
  /** From channel `status.selfDeclaredMadeForKids` or `status.madeForKids`. */
  madeForKids?: boolean;
  /** From the most recent upload's `snippet.categoryId`. */
  categoryId?: string;
  /** From the most recent upload's `status.license`. */
  license?: 'youtube' | 'creativeCommon';
  /** From the most recent upload's `status.embeddable`. */
  embeddable?: boolean;
}

/** Platform YouTube fields that account defaults may seed when still unset. */
export type YouTubeAccountDefaultsSeedTarget = Pick<
  YouTubeDraftFields,
  'madeForKids' | 'defaultAudioLanguage' | 'license' | 'embeddable' | 'categoryId'
>;

/**
 * Builds a partial YouTube platform patch from account defaults for fields not already set.
 * @param platformFields - Current `platforms.youtube` values on the draft or livestream.
 * @param defaults - Account defaults from YouTube Data API.
 * @returns Patch to merge onto the row, or an empty object when nothing to seed.
 */
export function buildYouTubeAccountDefaultsSeedPatch(
  platformFields: YouTubeAccountDefaultsSeedTarget | undefined,
  defaults: YouTubeAccountDefaults
): Partial<YouTubeAccountDefaultsSeedTarget> {
  const yt = platformFields ?? {};
  const patch: Partial<YouTubeAccountDefaultsSeedTarget> = {};

  if (yt.madeForKids === undefined && defaults.madeForKids !== undefined) {
    patch.madeForKids = defaults.madeForKids;
  }
  if (yt.defaultAudioLanguage === undefined && defaults.defaultAudioLanguage !== undefined) {
    patch.defaultAudioLanguage = defaults.defaultAudioLanguage;
  }
  if (yt.license === undefined && defaults.license !== undefined) {
    patch.license = defaults.license;
  }
  if (yt.embeddable === undefined && defaults.embeddable !== undefined) {
    patch.embeddable = defaults.embeddable;
  }
  if (yt.categoryId === undefined && defaults.categoryId !== undefined) {
    patch.categoryId = defaults.categoryId;
  }

  return patch;
}
