import { SERMONAUDIO_API_BASE, sermonAudioJsonHeaders } from '@/lib/platforms/sermon-audio-http';

/** Minimum query length for SermonAudio multisearch (`GET /v2/node/search`). */
export const SERMON_AUDIO_SPEAKER_SEARCH_MIN_LENGTH = 2;

/** Number of recent sermons scanned to build the recency-ordered speaker list. */
export const SERMON_AUDIO_RECENT_SPEAKERS_SERMON_PAGE_SIZE = 100;

/**
 * A SermonAudio speaker option for draft UI and upload metadata.
 * @property speakerID - SermonAudio speaker id.
 * @property displayName - Human-readable speaker name sent as `speakerName` on upload.
 */
export interface SermonAudioSpeakerOption {
  speakerID: number;
  displayName: string;
}

/**
 * Parses a SermonAudio speaker object from API JSON.
 * @param item - Raw speaker payload from SermonAudio.
 * @returns Normalized speaker option, or null when invalid.
 */
export function parseSermonAudioSpeaker(item: unknown): SermonAudioSpeakerOption | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const speakerID = typeof record.speakerID === 'number' ? record.speakerID : null;
  const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : '';
  if (speakerID === null || !Number.isInteger(speakerID) || speakerID <= 0 || displayName === '') {
    return null;
  }
  return { speakerID, displayName };
}

/**
 * Parses the primary speaker from a sermon list item.
 * @param sermon - Raw sermon payload from `GET /v2/node/sermons`.
 * @returns Normalized speaker option, or null when missing/invalid.
 */
export function parseSermonAudioSpeakerFromSermonItem(
  sermon: unknown
): SermonAudioSpeakerOption | null {
  if (!sermon || typeof sermon !== 'object') return null;
  const speaker = (sermon as Record<string, unknown>).speaker;
  return parseSermonAudioSpeaker(speaker);
}

/**
 * Parses recent speakers from a newest-first sermon list, preserving preach recency.
 * @param body - Parsed sermons list JSON body (`results`).
 * @returns Deduplicated speakers with the most recently preached first.
 */
export function parseRecentSermonAudioSpeakersFromSermonsList(
  body: unknown
): SermonAudioSpeakerOption[] {
  if (!body || typeof body !== 'object') return [];
  const results = (body as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];

  const seen = new Set<number>();
  const ordered: SermonAudioSpeakerOption[] = [];
  for (const sermon of results) {
    const speaker = parseSermonAudioSpeakerFromSermonItem(sermon);
    if (!speaker || seen.has(speaker.speakerID)) continue;
    seen.add(speaker.speakerID);
    ordered.push(speaker);
  }
  return ordered;
}

/**
 * Parses speakers from broadcaster filter_options (alphabetical; not used for recency UI).
 * @param body - Parsed filter_options JSON body.
 * @returns Deduplicated speakers in filter_options order.
 */
export function parseRecentSermonAudioSpeakersFromFilterOptions(
  body: unknown
): SermonAudioSpeakerOption[] {
  if (!body || typeof body !== 'object') return [];
  const speakers = (body as Record<string, unknown>).speakers;
  if (!Array.isArray(speakers)) return [];

  const seen = new Set<number>();
  const ordered: SermonAudioSpeakerOption[] = [];
  for (const item of speakers) {
    const speaker = parseSermonAudioSpeaker(item);
    if (!speaker || seen.has(speaker.speakerID)) continue;
    seen.add(speaker.speakerID);
    ordered.push(speaker);
  }
  return ordered;
}

/**
 * Parses speaker search results, preserving API relevance order.
 * @param body - Parsed multisearch JSON body.
 * @returns Deduplicated speakers in search rank order.
 */
export function parseSermonAudioSpeakersFromSearchBody(body: unknown): SermonAudioSpeakerOption[] {
  if (!body || typeof body !== 'object') return [];
  const speakerResults = (body as Record<string, unknown>).speakerResults;
  if (!Array.isArray(speakerResults)) return [];

  const seen = new Set<number>();
  const ordered: SermonAudioSpeakerOption[] = [];
  for (const item of speakerResults) {
    const speaker = parseSermonAudioSpeaker(item);
    if (!speaker || seen.has(speaker.speakerID)) continue;
    seen.add(speaker.speakerID);
    ordered.push(speaker);
  }
  return ordered;
}

/**
 * Parses speaker arrays from generic SermonAudio list responses.
 * @param body - Parsed JSON response body.
 * @returns Deduplicated speakers sorted by display name.
 */
export function parseSermonAudioSpeakersFromBody(body: unknown): SermonAudioSpeakerOption[] {
  const byId = new Map<number, SermonAudioSpeakerOption>();

  const addSpeaker = (speaker: SermonAudioSpeakerOption | null) => {
    if (!speaker) return;
    byId.set(speaker.speakerID, speaker);
  };

  if (Array.isArray(body)) {
    for (const item of body) {
      addSpeaker(parseSermonAudioSpeaker(item));
    }
  } else if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['speakers', 'speakerResults', 'results']) {
      const candidate = record[key];
      if (!Array.isArray(candidate)) continue;
      for (const item of candidate) {
        addSpeaker(parseSermonAudioSpeaker(item));
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function readSermonAudioResponseErrorDetails(
  response: Response
): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

/**
 * Ensures a SermonAudio HTTP response succeeded before parsing JSON.
 * @param response - Upstream SermonAudio fetch response.
 * @param message - Error prefix when the response is not OK.
 * @throws When `response.ok` is false.
 */
async function assertSermonAudioResponseOk(response: Response, message: string): Promise<void> {
  if (response.ok) return;
  const details = await readSermonAudioResponseErrorDetails(response);
  throw new Error(
    details
      ? `${message} (HTTP ${response.status}): ${details}`
      : `${message} (HTTP ${response.status})`
  );
}

/**
 * Fetches recent speakers for a broadcaster from newest sermons (preach date descending).
 * @param apiKey - SermonAudio API key.
 * @param broadcasterId - Connected broadcaster id.
 * @returns Speakers ordered by most recently preached first.
 * @throws When the SermonAudio API request fails.
 */
export async function fetchRecentSermonAudioSpeakers(
  apiKey: string,
  broadcasterId: string
): Promise<SermonAudioSpeakerOption[]> {
  const url = new URL(`${SERMONAUDIO_API_BASE}/v2/node/sermons`);
  url.searchParams.set('broadcasterID', broadcasterId);
  url.searchParams.set('sortBy', 'newest');
  url.searchParams.set('pageSize', String(SERMON_AUDIO_RECENT_SPEAKERS_SERMON_PAGE_SIZE));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: sermonAudioJsonHeaders(apiKey),
    cache: 'no-store',
  });
  await assertSermonAudioResponseOk(response, 'Failed to fetch recent SermonAudio speakers');
  return parseRecentSermonAudioSpeakersFromSermonsList(await response.json());
}

/**
 * Searches SermonAudio speakers by display name via multisearch.
 * @param apiKey - SermonAudio API key.
 * @param query - Search text (minimum two characters).
 * @returns Matching speakers from `speakerResults`.
 * @throws When the SermonAudio API request fails.
 */
export async function searchSermonAudioSpeakers(
  apiKey: string,
  query: string
): Promise<SermonAudioSpeakerOption[]> {
  const trimmed = query.trim();
  if (trimmed.length < SERMON_AUDIO_SPEAKER_SEARCH_MIN_LENGTH) {
    return [];
  }

  const url = new URL(`${SERMONAUDIO_API_BASE}/v2/node/search`);
  url.searchParams.set('query', trimmed);
  url.searchParams.set('searchFor', 'Speaker');
  url.searchParams.set('pageSize', '20');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: sermonAudioJsonHeaders(apiKey),
    cache: 'no-store',
  });
  await assertSermonAudioResponseOk(response, 'Failed to search SermonAudio speakers');
  return parseSermonAudioSpeakersFromSearchBody(await response.json());
}
