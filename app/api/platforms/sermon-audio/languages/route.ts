import { NextRequest, NextResponse } from 'next/server';
import { requireSermonAudioConnection } from '@/lib/platforms/sermon-audio-api';
import {
  parseSermonAudioLanguagesFromListBody,
  sortSermonAudioLanguageOptions,
  type SermonAudioLanguageOption,
} from '@/lib/platforms/sermon-audio-languages';
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

const SERMONAUDIO_LANGUAGES_URL = `${SERMONAUDIO_API_BASE}/v2/node/languages`;

/** Upper bound on language catalog pagination requests (guards runaway `next` chains). */
const SERMONAUDIO_LANGUAGES_MAX_PAGES = 100;

async function fetchAllSermonAudioLanguages(apiKey: string): Promise<SermonAudioLanguageOption[]> {
  const byCode = new Map<string, SermonAudioLanguageOption>();
  const visitedUrls = new Set<string>();
  const headers = {
    'X-Api-Key': apiKey,
    Accept: 'application/json',
  };

  let nextUrl: string | null = resolveSermonAudioApiUrl(SERMONAUDIO_LANGUAGES_URL);

  while (nextUrl) {
    if (visitedUrls.has(nextUrl) || visitedUrls.size >= SERMONAUDIO_LANGUAGES_MAX_PAGES) {
      break;
    }
    visitedUrls.add(nextUrl);

    const response = await fetch(nextUrl, { method: 'GET', headers, cache: 'no-store' });
    await assertSermonAudioHttpOk(response, 'Failed to fetch SermonAudio languages');

    const body: unknown = await response.json();
    for (const option of parseSermonAudioLanguagesFromListBody(body)) {
      byCode.set(option.code, option);
    }

    const next =
      body && typeof body === 'object' && typeof (body as Record<string, unknown>).next === 'string'
        ? ((body as Record<string, unknown>).next as string).trim()
        : '';
    nextUrl = next !== '' ? resolveSermonAudioApiUrl(next) : null;
  }

  return sortSermonAudioLanguageOptions([...byCode.values()]);
}

/**
 * Returns the SermonAudio language catalog for the authenticated user's connected account.
 * Proxies paginated `GET /v2/node/languages` for draft sermon `languageCode` selection.
 * @param req - Incoming GET request.
 * @returns JSON list of language code and display name pairs, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireSermonAudioConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const languages = await fetchAllSermonAudioLanguages(connection.apiKey);
    const res: ApiResponse<SermonAudioLanguageOption[]> = { data: languages };
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

    console.error('[GET /api/platforms/sermon-audio/languages] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load SermonAudio languages',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
