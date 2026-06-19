import { createReadStream } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeBackupFileNameSettings } from '@/lib/backup-filename';
import {
  createSharedBackupMetadataSession,
  isBackupMetadataInjectableContentType,
  prepareBackupMetadataVideoForUpload,
  resolveBackupInjectedMetadata,
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

describe('backup metadata helpers', () => {
  it('detects injectable MP4 and QuickTime content types', () => {
    expect(isBackupMetadataInjectableContentType('video/mp4')).toBe(true);
    expect(isBackupMetadataInjectableContentType('video/quicktime')).toBe(true);
    expect(isBackupMetadataInjectableContentType('video/webm')).toBe(false);
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
  async function createTinyMp4(path: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=64x64:d=0.1',
        '-c:v',
        'libx264',
        '-f',
        'mp4',
        path,
        '-y',
      ]);
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`failed to create test mp4 (exit ${code})`));
      });
      ffmpeg.on('error', reject);
    });
  }

  it('writes a standard MP4 with metadata and streams the full output for upload', async () => {
    const path = join(tmpdir(), `videosphere-backup-meta-${Date.now()}.mp4`);
    await createTinyMp4(path);
    const inputSize = (await import('node:fs/promises')).stat(path).then((s) => s.size);

    const prepared = await prepareBackupMetadataVideoForUpload({
      source: createReadStream(path),
      expectedContentLength: await inputSize,
      sourceContentType: 'video/mp4',
      metadata: { title: 'Injected title', albumArtist: 'Artist', year: '2026' },
    });

    expect(prepared.contentLength).toBeGreaterThan(1000);
    expect(prepared.contentLength).toBeGreaterThanOrEqual(await inputSize);

    let streamedBytes = 0;
    const reader = prepared.stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamedBytes += value.byteLength;
    }

    expect(streamedBytes).toBe(prepared.contentLength);
  }, 15000);

  it('fans one ffmpeg pass to multiple upload streams', async () => {
    const path = join(tmpdir(), `videosphere-backup-meta-shared-${Date.now()}.mp4`);
    await createTinyMp4(path);
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
    await session!.dispose();
  }, 20000);
});
