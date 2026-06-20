import { createReadStream } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeBackupFileNameSettings } from '@/lib/backup-filename';
import {
  createSharedBackupMetadataSession,
  isBackupMetadataInjectableContentType,
  prepareBackupMetadataVideoForUpload,
  resolveBackupInjectedMetadata,
  resolveBackupMetadataOutputContentType,
  shouldInjectBackupMetadata,
} from '@/lib/backup-metadata';

function isFfmpegAvailable(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ffmpegAvailable = isFfmpegAvailable();

/** Distinct from production mkdtemp staging dirs so stray test fixtures are easy to spot and sweep. */
const TEST_INPUT_PREFIX = 'videosphere-backup-meta-test-';

async function listBackupMetadataTempDirs(): Promise<string[]> {
  const entries = await readdir(tmpdir());
  const matches = entries.filter((entry) => entry.startsWith('videosphere-backup-meta-'));
  const dirs: string[] = [];

  for (const entry of matches) {
    const path = join(tmpdir(), entry);
    if ((await stat(path)).isDirectory()) {
      dirs.push(entry);
    }
  }

  return dirs;
}

function testInputPath(extension: 'mp4' | 'mov'): string {
  return join(tmpdir(), `${TEST_INPUT_PREFIX}${Date.now()}.${extension}`);
}

async function removeTestInputFile(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => {});
}

/** Removes test fixture files left in /tmp (production only creates staging directories). */
async function cleanupTestInputFiles(): Promise<void> {
  const entries = await readdir(tmpdir());
  for (const entry of entries) {
    if (!entry.startsWith('videosphere-backup-meta-')) {
      continue;
    }

    const path = join(tmpdir(), entry);
    if ((await stat(path)).isFile()) {
      await rm(path, { force: true }).catch(() => {});
    }
  }
}

describe('backup metadata helpers', () => {
  it('detects injectable MP4 and QuickTime content types', () => {
    expect(isBackupMetadataInjectableContentType('video/mp4')).toBe(true);
    expect(isBackupMetadataInjectableContentType('video/quicktime')).toBe(true);
    expect(isBackupMetadataInjectableContentType('video/webm')).toBe(false);
  });

  it('preserves source container MIME type for metadata injection output', () => {
    expect(resolveBackupMetadataOutputContentType('video/mp4')).toBe('video/mp4');
    expect(resolveBackupMetadataOutputContentType('video/quicktime')).toBe('video/quicktime');
  });

  it('resolves injected metadata from backup settings and title', () => {
    expect(
      resolveBackupInjectedMetadata({
        title: ' Sunday Service ',
        settings: normalizeBackupFileNameSettings({
          datePrefixDate: '2026-06-18',
          albumArtist: 'Church Name',
          album: 'Sermons',
          genre: 'Speech',
        }),
      })
    ).toEqual({
      title: 'Sunday Service',
      albumArtist: 'Church Name',
      album: 'Sermons',
      genre: 'Speech',
      year: '2026',
    });
  });

  it('requires metadataEnabled and an injectable content type', () => {
    expect(
      shouldInjectBackupMetadata(
        normalizeBackupFileNameSettings({ metadataEnabled: true }),
        'video/mp4'
      )
    ).toBe(true);
    expect(
      shouldInjectBackupMetadata(
        normalizeBackupFileNameSettings({ metadataEnabled: false }),
        'video/mp4'
      )
    ).toBe(false);
    expect(
      shouldInjectBackupMetadata(
        normalizeBackupFileNameSettings({ metadataEnabled: true }),
        'video/webm'
      )
    ).toBe(false);
  });
});

describe.skipIf(!ffmpegAvailable)('backup metadata ffmpeg integration', () => {
  afterEach(async () => {
    await cleanupTestInputFiles();
  });

  async function createTinyVideo(path: string, format: 'mp4' | 'mov'): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=64x64:d=0.1',
        '-c:v',
        'mpeg4',
        '-f',
        format,
        path,
      ]);
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`failed to create test ${format} (exit ${code})`));
      });
      ffmpeg.on('error', reject);
    });
  }

  async function createTinyMp4(path: string): Promise<void> {
    await createTinyVideo(path, 'mp4');
  }

  async function createTinyMov(path: string): Promise<void> {
    await createTinyVideo(path, 'mov');
  }

  it('writes a standard MP4 with metadata and streams the full output for upload', async () => {
    const path = testInputPath('mp4');
    await createTinyMp4(path);

    try {
      const inputSize = (await import('node:fs/promises')).stat(path).then((s) => s.size);

      const prepared = await prepareBackupMetadataVideoForUpload({
        source: createReadStream(path),
        expectedContentLength: await inputSize,
        sourceContentType: 'video/mp4',
        metadata: { title: 'Injected title', albumArtist: 'Artist', year: '2026' },
      });

      expect(prepared.contentLength).toBeGreaterThan(1000);
      expect(prepared.contentLength).toBeGreaterThanOrEqual(await inputSize);
      expect(prepared.contentType).toBe('video/mp4');

      let streamedBytes = 0;
      const reader = prepared.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamedBytes += value.byteLength;
      }

      expect(streamedBytes).toBe(prepared.contentLength);
      await prepared.dispose();

      expect(await listBackupMetadataTempDirs()).toHaveLength(0);
    } finally {
      await removeTestInputFile(path);
    }
  }, 15000);

  it('preserves QuickTime container for MOV metadata injection', async () => {
    const path = testInputPath('mov');
    await createTinyMov(path);

    try {
      const inputSize = (await import('node:fs/promises')).stat(path).then((s) => s.size);

      const prepared = await prepareBackupMetadataVideoForUpload({
        source: createReadStream(path),
        expectedContentLength: await inputSize,
        sourceContentType: 'video/quicktime',
        metadata: { title: 'MOV title', year: '2026' },
      });

      expect(prepared.contentType).toBe('video/quicktime');
      expect(prepared.contentLength).toBeGreaterThan(1000);
      await prepared.dispose();

      expect(await listBackupMetadataTempDirs()).toHaveLength(0);
    } finally {
      await removeTestInputFile(path);
    }
  }, 15000);

  it('disposes temp staging files when the prepared stream is never read', async () => {
    const path = testInputPath('mp4');
    await createTinyMp4(path);

    try {
      const inputSize = (await import('node:fs/promises')).stat(path).then((s) => s.size);

      const prepared = await prepareBackupMetadataVideoForUpload({
        source: createReadStream(path),
        expectedContentLength: await inputSize,
        sourceContentType: 'video/mp4',
        metadata: { title: 'Unused stream', year: '2026' },
      });

      await expect(prepared.dispose()).resolves.toBeUndefined();
      await expect(prepared.dispose()).resolves.toBeUndefined();

      expect(await listBackupMetadataTempDirs()).toHaveLength(0);
    } finally {
      await removeTestInputFile(path);
    }
  }, 15000);

  it('fans one ffmpeg pass to multiple upload streams', async () => {
    const path = testInputPath('mp4');
    await createTinyMp4(path);

    try {
      const inputSize = (await import('node:fs/promises')).stat(path).then((s) => s.size);

      let openSourceCount = 0;
      const session = createSharedBackupMetadataSession({
        openSource: async () => {
          openSourceCount += 1;
          return {
            readable: createReadStream(path),
            contentLength: await inputSize,
            contentType: 'video/mp4',
          };
        },
        expectedContentLength: await inputSize,
        sourceContentType: 'video/mp4',
        backupNaming: normalizeBackupFileNameSettings({ metadataEnabled: true }),
        injectedMetadata: { title: 'Shared title', year: '2026' },
      });
      expect(session).not.toBeNull();

      const [first, second] = await Promise.all([
        session!.openUploadStream(),
        session!.openUploadStream(),
      ]);

      expect(openSourceCount).toBe(1);
      expect(first.contentLength).toBeGreaterThan(1000);
      expect(second.contentLength).toBe(first.contentLength);
      expect(first.contentType).toBe('video/mp4');
      expect(second.contentType).toBe('video/mp4');

      const readStreamBytes = async (stream: ReadableStream<Uint8Array>) => {
        let bytes = 0;
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
        }
        return bytes;
      };

      const [firstBytes, secondBytes] = await Promise.all([
        readStreamBytes(first.stream),
        readStreamBytes(second.stream),
      ]);

      expect(firstBytes).toBe(first.contentLength);
      expect(secondBytes).toBe(second.contentLength);
      await first.dispose();
      await second.dispose();
      await session!.dispose();

      expect(await listBackupMetadataTempDirs()).toHaveLength(0);
    } finally {
      await removeTestInputFile(path);
    }
  }, 20000);
});
