import type { NextRequest } from 'next/server';

/** Header used for server-to-server import worker kickoff. */
export const YOUTUBE_IMPORT_WORKER_HEADER = 'x-youtube-import-worker-secret';

/**
 * Resolves the app base URL for internal worker kickoff requests.
 * @param req - Optional incoming request used to derive host/proto in dev.
 * @returns Origin without a trailing slash.
 */
export function resolveYoutubeImportKickoffBaseUrl(req?: NextRequest): string {
  const configured = process.env.APP_URL?.trim() ?? process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (req) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') ?? 'http';
    if (host) {
      return `${proto}://${host}`;
    }
  }

  const port = process.env.PORT?.trim() || '9624';
  return `http://127.0.0.1:${port}`;
}

/**
 * Starts a pending import job by POSTing to the long-running worker route.
 * @param jobId - Youtube import job id.
 * @param req - Optional request used to resolve the kickoff base URL.
 */
export async function kickoffYoutubeImportJob(jobId: string, req?: NextRequest): Promise<void> {
  const baseUrl = resolveYoutubeImportKickoffBaseUrl(req);
  const secret = process.env.YOUTUBE_IMPORT_WORKER_SECRET?.trim() ?? '';
  const headers: Record<string, string> = {};
  if (secret) {
    headers[YOUTUBE_IMPORT_WORKER_HEADER] = secret;
  } else if (req) {
    const cookie = req.headers.get('cookie');
    if (cookie) {
      headers.cookie = cookie;
    }
  }

  const response = await fetch(`${baseUrl}/api/youtube-import/${jobId}/run`, {
    method: 'POST',
    headers,
    cache: 'no-store',
  });

  if (response.ok || response.status === 409) {
    return;
  }

  const body = await response.text().catch(() => '');
  throw new Error(
    `YouTube import kickoff failed (${response.status})${body ? `: ${body.slice(0, 500)}` : ''}`
  );
}
