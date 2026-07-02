import type { ConnectedAccountPlatform, LivestreamStatus } from '@/types';

const LIVESTREAM_STATUSES = new Set<LivestreamStatus>([
  'draft',
  'scheduled',
  'live',
  'ended',
  'failed',
]);

/**
 * Top-level MongoDB query fields denormalized from a livestream document payload.
 */
export interface LivestreamMongoQueryFields {
  /** Livestream lifecycle status. */
  status: LivestreamStatus;
  /** Whether YouTube is in the distribution target list. */
  hasYoutubeTarget: boolean;
  /** Linked YouTube broadcast id, or empty when unset. */
  youtubeBroadcastId: string;
  /** YouTube lifecycle status string, or empty when unset. */
  youtubeLifecycleStatus: string;
}

/**
 * Derives indexed query fields from parsed livestream document payload fields.
 * @param doc - Parsed document payload fields.
 * @returns Top-level MongoDB query fields.
 */
export function livestreamQueryFieldsFromStoredDocument(doc: {
  status: LivestreamStatus;
  targets: readonly ConnectedAccountPlatform[];
  youtubeBroadcastId?: string;
  youtubeLifecycleStatus?: string;
}): LivestreamMongoQueryFields {
  return {
    status: doc.status,
    hasYoutubeTarget: doc.targets.includes('youtube'),
    youtubeBroadcastId: doc.youtubeBroadcastId?.trim() ?? '',
    youtubeLifecycleStatus: doc.youtubeLifecycleStatus?.trim() ?? '',
  };
}

/**
 * Derives indexed query fields from a stored livestream JSON document string.
 * @param documentJson - Serialized livestream document column.
 * @returns Top-level MongoDB query fields.
 */
export function livestreamQueryFieldsFromDocumentJson(
  documentJson: string
): LivestreamMongoQueryFields {
  const parsed = JSON.parse(documentJson) as {
    status?: unknown;
    targets?: unknown;
    youtubeBroadcastId?: unknown;
    youtubeLifecycleStatus?: unknown;
  };

  const status =
    typeof parsed.status === 'string' && LIVESTREAM_STATUSES.has(parsed.status as LivestreamStatus)
      ? (parsed.status as LivestreamStatus)
      : 'draft';

  const targets = Array.isArray(parsed.targets)
    ? parsed.targets.filter(
        (target): target is ConnectedAccountPlatform => typeof target === 'string'
      )
    : [];

  return livestreamQueryFieldsFromStoredDocument({
    status,
    targets,
    youtubeBroadcastId:
      typeof parsed.youtubeBroadcastId === 'string' ? parsed.youtubeBroadcastId : undefined,
    youtubeLifecycleStatus:
      typeof parsed.youtubeLifecycleStatus === 'string' ? parsed.youtubeLifecycleStatus : undefined,
  });
}
