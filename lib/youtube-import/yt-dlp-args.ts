import { execPath } from 'node:process';

/** Default remote EJS source for distro-installed yt-dlp builds that omit bundled scripts. */
export const YT_DLP_DEFAULT_REMOTE_COMPONENTS = 'ejs:github';

/**
 * Builds shared yt-dlp flags required for current YouTube extraction.
 * @returns Base argument list to prepend before command-specific yt-dlp options.
 */
export function buildYtDlpBaseArgs(): string[] {
  const args = ['--no-update', '--js-runtimes', `node:${execPath}`];

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
