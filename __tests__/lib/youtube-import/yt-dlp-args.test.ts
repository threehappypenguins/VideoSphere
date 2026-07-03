import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  YT_DLP_DEFAULT_REMOTE_COMPONENTS,
  YT_DLP_IMPORT_DOWNLOAD_FORMAT,
  buildYtDlpBaseArgs,
  buildYtDlpMetadataArgs,
} from '@/lib/youtube-import/yt-dlp-args';

describe('buildYtDlpBaseArgs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enables Node and GitHub-hosted EJS scripts by default when Deno is absent', () => {
    const args = buildYtDlpBaseArgs();

    expect(args).toContain('--no-update');
    expect(args).toContain('--js-runtimes');
    expect(args).toContainEqual(expect.stringMatching(/^node:/));
    expect(args).toContain('--remote-components');
    expect(args).toContain(YT_DLP_DEFAULT_REMOTE_COMPONENTS);
  });

  it('allows disabling remote component downloads', () => {
    vi.stubEnv('YT_DLP_REMOTE_COMPONENTS', 'none');

    const args = buildYtDlpBaseArgs();

    expect(args).not.toContain('--remote-components');
  });

  it('supports a custom remote component source', () => {
    vi.stubEnv('YT_DLP_REMOTE_COMPONENTS', 'ejs:npm');

    const args = buildYtDlpBaseArgs();

    expect(args).toContain('ejs:npm');
  });
});

describe('YT_DLP_IMPORT_DOWNLOAD_FORMAT', () => {
  it('prefers m4a/mp4a audio over the default Opus DASH fallback', () => {
    expect(YT_DLP_IMPORT_DOWNLOAD_FORMAT).toContain('ba[ext=m4a]');
    expect(YT_DLP_IMPORT_DOWNLOAD_FORMAT).toContain('acodec^=mp4a');
    expect(YT_DLP_IMPORT_DOWNLOAD_FORMAT.endsWith('bv*+ba/b')).toBe(true);
  });
});

describe('buildYtDlpMetadataArgs', () => {
  it('appends JSON metadata flags after the shared base args', () => {
    const watchUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const args = buildYtDlpMetadataArgs(watchUrl);

    expect(args.at(-1)).toBe(watchUrl);
    expect(args).toContain('-J');
    expect(args).toContain('--no-playlist');
    expect(args).toContain('--js-runtimes');
  });
});
