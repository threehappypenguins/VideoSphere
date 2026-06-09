import type { ConnectedAccountPlatform, DraftPlatforms } from '@/types';
import { platformLabel } from '@/lib/ui/platform-label';

const METADATA_PLATFORMS = ['youtube', 'vimeo', 'sermon_audio'] as const;

type MetadataPlatform = (typeof METADATA_PLATFORMS)[number];

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
  targets: ConnectedAccountPlatform[];
  platforms: DraftPlatforms;
}

function isMetadataPlatform(platform: ConnectedAccountPlatform): platform is MetadataPlatform {
  return (METADATA_PLATFORMS as readonly string[]).includes(platform);
}

function selectedMetadataPlatforms(targets: ConnectedAccountPlatform[]): MetadataPlatform[] {
  return targets.filter(isMetadataPlatform);
}

function usesSharedTitleGlobally(
  draft: DraftUploadValidationInput,
  platforms: MetadataPlatform[]
): boolean {
  return platforms.every((platform) => draft.platforms[platform]?.titleOverride === undefined);
}

function effectiveTitleForPlatform(
  draft: DraftUploadValidationInput,
  platform: MetadataPlatform
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
  const metadataTargets = selectedMetadataPlatforms(draft.targets);

  if (metadataTargets.length === 0) {
    return issues;
  }

  if (usesSharedTitleGlobally(draft, metadataTargets)) {
    pushIfEmpty(issues, 'title', draft.title, 'Title is required before upload.');
  } else {
    for (const platform of metadataTargets) {
      pushIfEmpty(
        issues,
        `title:${platform}`,
        effectiveTitleForPlatform(draft, platform),
        `${platformLabel(platform)} title is required before upload.`
      );
    }
  }

  if (draft.targets.includes('youtube')) {
    const yt = draft.platforms.youtube;
    if (yt?.isPremiere === true && (yt.publishAt ?? '').trim() === '') {
      issues.push({
        field: 'youtube.publishAt',
        message: 'A schedule date and time are required to set a video as a Premiere.',
      });
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

  return issues;
}
