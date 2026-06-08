import { NextRequest, NextResponse } from 'next/server';
import { mergeSermonAudioEventTypes } from '@/lib/platforms/sermon-audio-event-types';
import { requireSermonAudioConnection } from '@/lib/platforms/sermon-audio-api';
import {
  SERMONAUDIO_API_BASE,
  SermonAudioUpstreamHttpError,
  assertSermonAudioHttpOk,
  isSermonAudioCredentialsFailure,
  resolveSermonAudioApiUrl,
  sermonAudioUpstreamResponseStatus,
  sermonAudioUpstreamApiErrorLabel,
} from '@/lib/platforms/sermon-audio-http';
import type { ApiError, ApiResponse } from '@/types';

const SERMONAUDIO_EVENT_TYPES_URL = `${SERMONAUDIO_API_BASE}/v2/node/filter_options/sermon_event_types`;

/** Upper bound on event-type catalog pagination requests (guards runaway `next` chains). */
const SERMONAUDIO_EVENT_TYPES_MAX_PAGES = 100;

function eventTypeLabel(item: unknown): string | null {
  if (typeof item === 'string') {
    const trimmed = item.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    for (const key of ['description', 'displayEventType', 'eventType', 'name', 'label']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
    }
  }
  return null;
}

function parseEventTypeLabelsFromBody(body: unknown): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (label: string | null) => {
    if (!label || seen.has(label)) return;
    seen.add(label);
    labels.push(label);
  };

  if (Array.isArray(body)) {
    for (const item of body) {
      pushUnique(eventTypeLabel(item));
    }
    return labels;
  }

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['results', 'sermonEventTypes', 'data', 'eventTypes', 'sermon_event_types']) {
      const candidate = record[key];
      if (!Array.isArray(candidate)) continue;
      for (const item of candidate) {
        pushUnique(eventTypeLabel(item));
      }
      if (labels.length > 0) return labels;
    }
  }

  return labels;
}

async function fetchAllSermonEventTypeLabels(apiKey: string): Promise<string[]> {
  const labels = new Set<string>();
  const visitedUrls = new Set<string>();
  const headers = {
    'X-Api-Key': apiKey,
    Accept: 'application/json',
  };

  // Global catalog — omit `broadcaster_id`, which would restrict results to categories
  // this broadcaster has already used (not the full list shown on sermonaudio.com).
  let nextUrl: string | null = resolveSermonAudioApiUrl(SERMONAUDIO_EVENT_TYPES_URL);

  while (nextUrl) {
    if (visitedUrls.has(nextUrl) || visitedUrls.size >= SERMONAUDIO_EVENT_TYPES_MAX_PAGES) {
      break;
    }
    visitedUrls.add(nextUrl);

    const response = await fetch(nextUrl, { method: 'GET', headers, cache: 'no-store' });
    await assertSermonAudioHttpOk(response, 'Failed to fetch SermonAudio event types');

    const body: unknown = await response.json();
    for (const label of parseEventTypeLabelsFromBody(body)) {
      labels.add(label);
    }

    const next =
      body && typeof body === 'object' && typeof (body as Record<string, unknown>).next === 'string'
        ? ((body as Record<string, unknown>).next as string).trim()
        : '';
    nextUrl = next !== '' ? resolveSermonAudioApiUrl(next) : null;
  }

  return [...labels].sort((a, b) => a.localeCompare(b));
}

/**
 * Returns the global SermonAudio event type catalog for the authenticated user's connected account.
 * Merges paginated `GET /v2/node/filter_options/sermon_event_types` results with the documented
 * OpenAPI `SermonEventType` enum, because the API often returns only broadcaster-used categories.
 * @param req - Incoming GET request.
 * @returns JSON list of event type labels, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireSermonAudioConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const fetched = await fetchAllSermonEventTypeLabels(connection.apiKey);
    const labels = mergeSermonAudioEventTypes(fetched);
    const res: ApiResponse<string[]> = { data: labels };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    if (err instanceof SermonAudioUpstreamHttpError) {
      if (isSermonAudioCredentialsFailure(err.status)) {
        const errRes: ApiError = {
          error: 'Bad Request',
          message:
            'SermonAudio API key is invalid or revoked. Reconnect SermonAudio in account settings.',
          statusCode: 400,
        };
        return NextResponse.json(errRes, { status: 400 });
      }

      const status = sermonAudioUpstreamResponseStatus(err.status);
      const errRes: ApiError = {
        error: sermonAudioUpstreamApiErrorLabel(status),
        message: 'SermonAudio is temporarily unavailable. Try again in a few minutes.',
        statusCode: status,
      };
      return NextResponse.json(errRes, { status });
    }

    console.error(
      '[GET /api/platforms/sermon-audio/filter-options/sermon-event-types] Unexpected error:',
      err
    );
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load SermonAudio event types',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
