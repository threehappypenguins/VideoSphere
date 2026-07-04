import { existsSync } from 'node:fs';
import { execPath } from 'node:process';

/** Default remote EJS source for distro-installed yt-dlp builds that omit bundled scripts. */
export const YT_DLP_DEFAULT_REMOTE_COMPONENTS = 'ejs:github';

/**
 * yt-dlp format selector for YouTube import source downloads.
 * Prefer direct HTTP progressive streams when available (fewer signed DASH fragments).
 * Otherwise fall back to `bv*+ba` with m4a/mp4a audio so the merged MP4 stays AAC.
 */
export const YT_DLP_IMPORT_DOWNLOAD_FORMAT =
  'bv*[protocol^=http][protocol!*=dash]+ba[protocol^=http][protocol!*=dash][ext=m4a]/' +
  'bv*[protocol^=http][protocol!*=dash]+ba[protocol^=http][protocol!*=dash]/' +
  'bv*+ba[ext=m4a]/bv*+ba[acodec^=mp4a.40.]/bv*+ba[acodec^=mp4a]/bv*+ba/b';

/**
 * HTTP chunk size for YouTube import downloads.
 * Stays at or under YouTube's undocumented ~10MB per-request throttle threshold.
 */
export const YT_DLP_IMPORT_HTTP_CHUNK_SIZE = '10M';

/**
 * Number of DASH/HLS fragments to fetch in parallel during import downloads.
 * Serial downloads are gentler on googlevideo signed URLs and datacenter IPs.
 */
export const YT_DLP_IMPORT_CONCURRENT_FRAGMENTS = 1;

/**
 * Default YouTube player clients for import extraction.
 * `android_vr` and `tv` avoid PO-token GVS requirements; `web_safari` can supply HLS.
 */
export const YT_DLP_IMPORT_PLAYER_CLIENTS = 'android_vr,tv,web_safari';

function resolveDenoExecutable(): string | null {
  const candidates = [
    process.env.DENO_BIN?.trim(),
    process.env.DENO_INSTALL ? `${process.env.DENO_INSTALL}/bin/deno` : undefined,
    '/usr/bin/deno',
    '/usr/local/bin/deno',
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Builds `--js-runtimes` flags for yt-dlp.
 * Deno is preferred (recommended by yt-dlp for YouTube JS challenges); Node is a fallback.
 * @returns Argument pairs for configured JavaScript runtimes.
 */
function buildJsRuntimeArgs(): string[] {
  const configured = process.env.YT_DLP_JS_RUNTIMES?.trim();
  if (configured) {
    return configured.split(',').flatMap((entry) => {
      const trimmed = entry.trim();
      return trimmed ? ['--js-runtimes', trimmed] : [];
    });
  }

  const args: string[] = [];
  const denoPath = resolveDenoExecutable();
  if (denoPath) {
    args.push('--js-runtimes', `deno:${denoPath}`);
  }
  args.push('--js-runtimes', `node:${execPath}`);
  return args;
}

/**
 * Builds YouTube extractor arguments for import/metadata calls.
 * @returns `--extractor-args` flag pair when player clients are configured.
 */
export function buildYtDlpYoutubeExtractorArgs(): string[] {
  const clients = process.env.YT_DLP_PLAYER_CLIENTS?.trim() || YT_DLP_IMPORT_PLAYER_CLIENTS;
  if (!clients) {
    return [];
  }

  return ['--extractor-args', `youtube:player_client=${clients}`];
}

/**
 * Builds shared yt-dlp flags required for current YouTube extraction.
 * @returns Base argument list to prepend before command-specific yt-dlp options.
 */
export function buildYtDlpBaseArgs(): string[] {
  const args = ['--no-update', ...buildJsRuntimeArgs(), ...buildYtDlpYoutubeExtractorArgs()];

  const remoteComponents = process.env.YT_DLP_REMOTE_COMPONENTS?.trim();
  if (remoteComponents && remoteComponents.toLowerCase() === 'none') {
    return args;
  }

  args.push('--remote-components', remoteComponents || YT_DLP_DEFAULT_REMOTE_COMPONENTS);
  return args;
}

/**
 * Builds yt-dlp arguments for JSON metadata extraction.
 * @param watchUrl - Full YouTube watch URL.
 * @returns Argument vector for `yt-dlp -J`.
 */
export function buildYtDlpMetadataArgs(watchUrl: string): string[] {
  return [...buildYtDlpBaseArgs(), '-J', '--no-playlist', watchUrl];
}
