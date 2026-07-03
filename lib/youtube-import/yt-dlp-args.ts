import { existsSync } from 'node:fs';
import { execPath } from 'node:process';

/** Default remote EJS source for distro-installed yt-dlp builds that omit bundled scripts. */
export const YT_DLP_DEFAULT_REMOTE_COMPONENTS = 'ejs:github';

function resolveDenoExecutable(): string | null {
  const candidates = [
    process.env.DENO_BIN?.trim(),
    process.env.DENO_INSTALL ? `${process.env.DENO_INSTALL}/bin/deno` : undefined,
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
 * Builds shared yt-dlp flags required for current YouTube extraction.
 * @returns Base argument list to prepend before command-specific yt-dlp options.
 */
export function buildYtDlpBaseArgs(): string[] {
  const args = ['--no-update', ...buildJsRuntimeArgs()];

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
