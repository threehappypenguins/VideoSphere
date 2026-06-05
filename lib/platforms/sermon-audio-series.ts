import { SERMONAUDIO_API_BASE, sermonAudioJsonHeaders } from '@/lib/platforms/sermon-audio-http';

/** Minimum query length for broadcaster series search (`searchKeyword`). */
export const SERMON_AUDIO_SERIES_SEARCH_MIN_LENGTH = 2;

/** Number of recent sermons scanned to build the recency-ordered series list. */
export const SERMON_AUDIO_RECENT_SERIES_SERMON_PAGE_SIZE = 100;

/**
 * A SermonAudio series option for draft UI and upload metadata.
 * @property seriesID - SermonAudio series id.
 * @property title - Series title sent as `subtitle` on upload when not using `seriesID` alone.
 */
export interface SermonAudioSeriesOption {
  seriesID: number;
  title: string;
}

/**
 * Parses a SermonAudio series object from API JSON.
 * @param item - Raw series payload from SermonAudio.
 * @returns Normalized series option, or null when invalid.
 */
export function parseSermonAudioSeries(item: unknown): SermonAudioSeriesOption | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const seriesID = typeof record.seriesID === 'number' ? record.seriesID : null;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (seriesID === null || !Number.isInteger(seriesID) || seriesID <= 0 || title === '') {
    return null;
  }
  return { seriesID, title };
}

/**
 * Parses the series from a sermon list item.
 * @param sermon - Raw sermon payload from `GET /v2/node/sermons`.
 * @returns Normalized series option, or null when missing/invalid.
 */
export function parseSermonAudioSeriesFromSermonItem(
  sermon: unknown
): SermonAudioSeriesOption | null {
  if (!sermon || typeof sermon !== 'object') return null;
  const record = sermon as Record<string, unknown>;
  const series = record.series;
  if (!series || typeof series !== 'object') return null;

  const parsed = parseSermonAudioSeries(series);
  if (parsed) return parsed;

  const seriesID = (series as Record<string, unknown>).seriesID;
  if (typeof seriesID !== 'number' || !Number.isInteger(seriesID) || seriesID <= 0) {
    return null;
  }

  const subtitle = typeof record.subtitle === 'string' ? record.subtitle.trim() : '';
  if (subtitle === '') return null;
  return { seriesID, title: subtitle };
}

/**
 * Parses recent series from a newest-first sermon list, preserving usage recency.
 * @param body - Parsed sermons list JSON body (`results`).
 * @returns Deduplicated series with the most recently used first.
 */
export function parseRecentSermonAudioSeriesFromSermonsList(
  body: unknown
): SermonAudioSeriesOption[] {
  if (!body || typeof body !== 'object') return [];
  const results = (body as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];

  const seen = new Set<number>();
  const ordered: SermonAudioSeriesOption[] = [];
  for (const sermon of results) {
    const series = parseSermonAudioSeriesFromSermonItem(sermon);
    if (!series || seen.has(series.seriesID)) continue;
    seen.add(series.seriesID);
    ordered.push(series);
  }
  return ordered;
}

/**
 * Parses series search/list results, preserving API order.
 * @param body - Parsed series list JSON body.
 * @returns Deduplicated series in response order.
 */
export function parseSermonAudioSeriesFromListBody(body: unknown): SermonAudioSeriesOption[] {
  if (!body || typeof body !== 'object') return [];
  const results = (body as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];

  const seen = new Set<number>();
  const ordered: SermonAudioSeriesOption[] = [];
  for (const item of results) {
    const series = parseSermonAudioSeries(item);
    if (!series || seen.has(series.seriesID)) continue;
    seen.add(series.seriesID);
    ordered.push(series);
  }
  return ordered;
}

/**
 * Parses series search results from multisearch, preserving relevance order.
 * @param body - Parsed multisearch JSON body.
 * @returns Deduplicated series in search rank order.
 */
export function parseSermonAudioSeriesFromSearchBody(body: unknown): SermonAudioSeriesOption[] {
  if (!body || typeof body !== 'object') return [];
  const seriesResults = (body as Record<string, unknown>).seriesResults;
  if (!Array.isArray(seriesResults)) return [];

  const seen = new Set<number>();
  const ordered: SermonAudioSeriesOption[] = [];
  for (const item of seriesResults) {
    const series = parseSermonAudioSeries(item);
    if (!series || seen.has(series.seriesID)) continue;
    seen.add(series.seriesID);
    ordered.push(series);
  }
  return ordered;
}

/**
 * Builds a series id to title map from a broadcaster series list response.
 * @param body - Parsed broadcaster series list JSON body.
 * @returns Map of series id to title.
 */
export function buildSermonAudioSeriesTitleMap(body: unknown): Map<number, string> {
  const map = new Map<number, string>();
  for (const series of parseSermonAudioSeriesFromListBody(body)) {
    map.set(series.seriesID, series.title);
  }
  return map;
}

async function fetchBroadcasterSeriesTitleMap(
  apiKey: string,
  broadcasterId: string
): Promise<Map<number, string>> {
  const url = new URL(
    `${SERMONAUDIO_API_BASE}/v2/node/broadcasters/${encodeURIComponent(broadcasterId)}/series`
  );
  url.searchParams.set('pageSize', '100');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: sermonAudioJsonHeaders(apiKey),
    cache: 'no-store',
  });
  if (!response.ok) {
    return new Map();
  }
  return buildSermonAudioSeriesTitleMap(await response.json());
}

/**
 * Fetches recent series for a broadcaster from newest sermons (preach date descending).
 * @param apiKey - SermonAudio API key.
 * @param broadcasterId - Connected broadcaster id.
 * @returns Series ordered by most recently used first.
 */
export async function fetchRecentSermonAudioSeries(
  apiKey: string,
  broadcasterId: string
): Promise<SermonAudioSeriesOption[]> {
  const url = new URL(`${SERMONAUDIO_API_BASE}/v2/node/sermons`);
  url.searchParams.set('broadcasterID', broadcasterId);
  url.searchParams.set('sortBy', 'newest');
  url.searchParams.set('pageSize', String(SERMON_AUDIO_RECENT_SERIES_SERMON_PAGE_SIZE));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: sermonAudioJsonHeaders(apiKey),
    cache: 'no-store',
  });
  if (!response.ok) {
    return [];
  }

  const recent = parseRecentSermonAudioSeriesFromSermonsList(await response.json());
  const missingTitleIds = recent
    .filter((series) => series.title === '')
    .map((series) => series.seriesID);
  if (missingTitleIds.length === 0) {
    return recent;
  }

  const titleMap = await fetchBroadcasterSeriesTitleMap(apiKey, broadcasterId);
  return recent
    .map((series) => ({
      seriesID: series.seriesID,
      title: series.title || titleMap.get(series.seriesID) || '',
    }))
    .filter((series) => series.title !== '');
}

/**
 * Searches a broadcaster's series by title.
 * @param apiKey - SermonAudio API key.
 * @param broadcasterId - Connected broadcaster id.
 * @param query - Search text (minimum two characters).
 * @returns Matching series for the broadcaster.
 */
export async function searchSermonAudioSeries(
  apiKey: string,
  broadcasterId: string,
  query: string
): Promise<SermonAudioSeriesOption[]> {
  const trimmed = query.trim();
  if (trimmed.length < SERMON_AUDIO_SERIES_SEARCH_MIN_LENGTH) {
    return [];
  }

  const url = new URL(
    `${SERMONAUDIO_API_BASE}/v2/node/broadcasters/${encodeURIComponent(broadcasterId)}/series`
  );
  url.searchParams.set('searchKeyword', trimmed);
  url.searchParams.set('pageSize', '20');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: sermonAudioJsonHeaders(apiKey),
    cache: 'no-store',
  });
  if (!response.ok) {
    return [];
  }
  return parseSermonAudioSeriesFromListBody(await response.json());
}
