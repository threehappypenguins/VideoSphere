import type { ConnectedAccountPlatform, DraftPlatforms, PlatformUploadVisibility } from '@/types';
import { DRAFT_TITLE_OVERRIDE_PLATFORM_ORDER } from '@/lib/draft-title';
import { platformLabel } from '@/lib/ui/platform-label';

type TitlePlatform = (typeof DRAFT_TITLE_OVERRIDE_PLATFORM_ORDER)[number];

const PRIVACY_PLATFORMS = ['youtube', 'vimeo'] as const;
type PrivacyPlatform = (typeof PRIVACY_PLATFORMS)[number];

/** Stable field keys used for upload validation highlighting in the draft modal. */
export type DraftUploadFieldKey = string;

/**
 * Issue returned when a draft is missing data required for upload/distribution.
 */
export interface DraftUploadValidationIssue {
  /** Field key for UI highlighting (e.g. `title`, `title:youtube`, `sermon_audio.speakerName`). */
  field: DraftUploadFieldKey;
  /** Human-readable message for toasts or inline hints. */
  message: string;
}

/**
 * Minimal draft shape required for upload validation.
 */
export interface DraftUploadValidationInput {
  title: string;
  description: string;
  tags: string[];
  visibility: PlatformUploadVisibility;
  targets: ConnectedAccountPlatform[];
  platforms: DraftPlatforms;
  /** When `false`, Vimeo cannot accept `unlisted` visibility. */
  vimeoSupportsUnlistedPrivacy?: boolean | null;
}

function selectedPrivacyPlatforms(targets: ConnectedAccountPlatform[]): PrivacyPlatform[] {
  return PRIVACY_PLATFORMS.filter((platform) => targets.includes(platform));
}

function usesSharedVisibilityGlobally(
  draft: DraftUploadValidationInput,
  platforms: readonly PrivacyPlatform[]
): boolean {
  return platforms.every((platform) => draft.platforms[platform]?.visibilityOverride === undefined);
}

function effectiveVisibilityForPlatform(
  draft: DraftUploadValidationInput,
  platform: PrivacyPlatform
): PlatformUploadVisibility {
  return draft.platforms[platform]?.visibilityOverride ?? draft.visibility;
}

function selectedTitlePlatforms(targets: ConnectedAccountPlatform[]): TitlePlatform[] {
  return DRAFT_TITLE_OVERRIDE_PLATFORM_ORDER.filter((platform) => targets.includes(platform));
}

function usesSharedTitleGlobally(
  draft: DraftUploadValidationInput,
  platforms: readonly TitlePlatform[]
): boolean {
  return platforms.every((platform) => draft.platforms[platform]?.titleOverride === undefined);
}

function effectiveTitleForPlatform(
  draft: DraftUploadValidationInput,
  platform: TitlePlatform
): string {
  const fields = draft.platforms[platform];
  return fields?.titleOverride !== undefined ? fields.titleOverride : draft.title;
}

function pushIfEmpty(
  issues: DraftUploadValidationIssue[],
  field: DraftUploadFieldKey,
  value: string | undefined,
  message: string
): void {
  if ((value ?? '').trim() === '') {
    issues.push({ field, message });
  }
}

function hasValidSermonAudioSpeaker(
  sa: DraftUploadValidationInput['platforms']['sermon_audio'] | undefined
): boolean {
  const speakerID = sa?.speakerID;
  if (typeof speakerID === 'number' && Number.isInteger(speakerID) && speakerID > 0) {
    return true;
  }
  return (sa?.speakerName ?? '').trim() !== '';
}

/**
 * Validates that a draft has the metadata required to upload and distribute to its selected targets.
 * Draft save may omit these fields; upload must not proceed until they are present.
 * @param draft - Current draft editor values.
 * @returns Validation issues; empty when upload may proceed.
 */
export function validateDraftForUpload(
  draft: DraftUploadValidationInput
): DraftUploadValidationIssue[] {
  const issues: DraftUploadValidationIssue[] = [];
  const titlePlatforms = selectedTitlePlatforms(draft.targets);

  if (titlePlatforms.length > 0) {
    if (usesSharedTitleGlobally(draft, titlePlatforms)) {
      pushIfEmpty(issues, 'title', draft.title, 'Title is required before upload.');
    } else {
      for (const platform of titlePlatforms) {
        pushIfEmpty(
          issues,
          `title:${platform}`,
          effectiveTitleForPlatform(draft, platform),
          `${platformLabel(platform)} title is required before upload.`
        );
      }
    }
  }

  if (draft.targets.includes('sermon_audio')) {
    const sa = draft.platforms.sermon_audio;
    if (!hasValidSermonAudioSpeaker(sa)) {
      issues.push({
        field: 'sermon_audio.speakerName',
        message: 'Speaker is required for SermonAudio before upload.',
      });
    }
    pushIfEmpty(
      issues,
      'sermon_audio.preachDate',
      sa?.preachDate,
      'Date recorded is required for SermonAudio before upload.'
    );
    pushIfEmpty(
      issues,
      'sermon_audio.eventType',
      sa?.eventType,
      'Event category is required for SermonAudio before upload.'
    );
  }

  if (draft.targets.includes('vimeo') && draft.vimeoSupportsUnlistedPrivacy === false) {
    const privacyPlatforms = selectedPrivacyPlatforms(draft.targets);
    if (privacyPlatforms.length > 0) {
      if (usesSharedVisibilityGlobally(draft, privacyPlatforms)) {
        if (draft.visibility === 'unlisted') {
          issues.push({
            field: 'visibility',
            message: 'Unlisted is not available on your Vimeo plan. Choose Public or Private.',
          });
        }
      } else if (effectiveVisibilityForPlatform(draft, 'vimeo') === 'unlisted') {
        issues.push({
          field: 'visibility:vimeo',
          message: 'Unlisted is not available on your Vimeo plan. Choose Public or Private.',
        });
      }
    }
  }

  return issues;
}
