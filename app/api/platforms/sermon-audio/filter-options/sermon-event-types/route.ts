import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { mergeSermonAudioEventTypes } from '@/lib/platforms/sermon-audio-event-types';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import type { ApiError, ApiResponse } from '@/types';

const SERMONAUDIO_API_BASE = 'https://api.sermonaudio.com';
const SERMONAUDIO_EVENT_TYPES_URL = `${SERMONAUDIO_API_BASE}/v2/node/filter_options/sermon_event_types`;

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
  const pushUnique = (label: string | null) => {
    if (!label || labels.includes(label)) return;
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

function resolveSermonAudioUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return pathOrUrl;
  }
  return new URL(pathOrUrl, SERMONAUDIO_API_BASE).toString();
}

async function fetchAllSermonEventTypeLabels(apiKey: string): Promise<string[]> {
  const labels = new Set<string>();
  const headers = {
    'X-Api-Key': apiKey,
    Accept: 'application/json',
  };

  // Global catalog — omit `broadcaster_id`, which would restrict results to categories
  // this broadcaster has already used (not the full list shown on sermonaudio.com).
  let nextUrl: string | null = resolveSermonAudioUrl(SERMONAUDIO_EVENT_TYPES_URL);

  while (nextUrl) {
    const response = await fetch(nextUrl, { method: 'GET', headers, cache: 'no-store' });
    if (!response.ok) {
      break;
    }

    const body: unknown = await response.json();
    for (const label of parseEventTypeLabelsFromBody(body)) {
      labels.add(label);
    }

    const next =
      body && typeof body === 'object' && typeof (body as Record<string, unknown>).next === 'string'
        ? ((body as Record<string, unknown>).next as string).trim()
        : '';
    nextUrl = next !== '' ? resolveSermonAudioUrl(next) : null;
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
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const account = await getConnectedAccountWithTokens(userId, 'sermon_audio');
  if (!account) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'SermonAudio is not connected',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }

  const broadcasterId = account.platformUserId.trim();
  if (!broadcasterId) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'SermonAudio broadcaster ID is missing on the connected account',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  try {
    const fetched = await fetchAllSermonEventTypeLabels(account.accessToken);
    const labels = mergeSermonAudioEventTypes(fetched);
    const res: ApiResponse<string[]> = { data: labels };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
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
