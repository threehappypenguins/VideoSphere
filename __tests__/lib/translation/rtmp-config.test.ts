/**
 * MediaMTX / RTMP URL and path helpers for OBS → PCM ingest.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetMediamtxProbeCacheForTests,
  buildMediamtxRtspUrl,
  buildRtmpPublishUrl,
  buildRtmpServerUrl,
  getMediamtxRtspBase,
  isRtmpIngestEnvReady,
  probeMediamtxReachable,
  resolveMediamtxProbeTarget,
  streamKeyFromMtxPath,
} from '@/lib/translation/rtmp-config';
import {
  __resetRtmpPcmPullersForTests,
  isRtmpPcmPullConfigured,
  verifyRtmpHookSecret,
} from '@/lib/translation/rtmp-pcm-puller';

describe('rtmp-config', () => {
  const envKeys = [
    'TRANSLATION_MEDIAMTX_RTSP_BASE',
    'TRANSLATION_RTMP_HOOK_SECRET',
    'TRANSLATION_RTMP_PATH_PREFIX',
    'TRANSLATION_RTMP_PUBLIC_HOST',
  ] as const;
  const previous = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
    __resetRtmpPcmPullersForTests();
    __resetMediamtxProbeCacheForTests();
  });

  /**
   * Snapshots and overrides an env var for the duration of a test.
   * @param key - Env key.
   * @param value - New value, or undefined to delete.
   */
  function setEnv(key: (typeof envKeys)[number], value: string | undefined): void {
    if (!previous.has(key)) previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it('builds RTSP pull URLs from MediaMTX base + path', () => {
    setEnv('TRANSLATION_MEDIAMTX_RTSP_BASE', 'rtsp://mediamtx:8554/');
    expect(getMediamtxRtspBase()).toBe('rtsp://mediamtx:8554');
    expect(buildMediamtxRtspUrl('live/streamKey123')).toBe(
      'rtsp://mediamtx:8554/live/streamKey123'
    );
    expect(buildMediamtxRtspUrl('/live/streamKey123/')).toBe(
      'rtsp://mediamtx:8554/live/streamKey123'
    );
  });

  it('returns null RTSP URL when base env is unset', () => {
    setEnv('TRANSLATION_MEDIAMTX_RTSP_BASE', undefined);
    expect(getMediamtxRtspBase()).toBeNull();
    expect(buildMediamtxRtspUrl('live/abc')).toBeNull();
    expect(isRtmpPcmPullConfigured()).toBe(false);
  });

  it('builds OBS server URL without the stream key', () => {
    setEnv('TRANSLATION_RTMP_PUBLIC_HOST', '192.168.1.51:1935');
    setEnv('TRANSLATION_RTMP_PATH_PREFIX', 'live');
    expect(buildRtmpServerUrl()).toBe('rtmp://192.168.1.51:1935/live');
    expect(buildRtmpPublishUrl('abcKey')).toBe('rtmp://192.168.1.51:1935/live/abcKey');
  });

  it('returns null RTMP URLs when public host is unset', () => {
    setEnv('TRANSLATION_RTMP_PUBLIC_HOST', undefined);
    expect(buildRtmpServerUrl()).toBeNull();
    expect(buildRtmpPublishUrl('abcKey')).toBeNull();
  });

  it('extracts stream key from MediaMTX paths', () => {
    expect(streamKeyFromMtxPath('live/abc123')).toBe('abc123');
    expect(streamKeyFromMtxPath('abc123')).toBe('abc123');
    expect(streamKeyFromMtxPath('/live/abc123/')).toBe('abc123');
  });

  it('verifies publisher hook secret in constant time when configured', () => {
    setEnv('TRANSLATION_RTMP_HOOK_SECRET', 'hook-secret');
    expect(verifyRtmpHookSecret('hook-secret')).toBe(true);
    expect(verifyRtmpHookSecret('wrong')).toBe(false);
    expect(verifyRtmpHookSecret(null)).toBe(false);
  });

  it('rejects hook secrets when env is unset', () => {
    setEnv('TRANSLATION_RTMP_HOOK_SECRET', undefined);
    expect(verifyRtmpHookSecret('anything')).toBe(false);
  });

  it('requires both public RTMP host and RTSP base for ingest env readiness', () => {
    setEnv('TRANSLATION_RTMP_PUBLIC_HOST', undefined);
    setEnv('TRANSLATION_MEDIAMTX_RTSP_BASE', undefined);
    expect(isRtmpIngestEnvReady()).toBe(false);

    setEnv('TRANSLATION_RTMP_PUBLIC_HOST', '192.168.1.51:1935');
    expect(isRtmpIngestEnvReady()).toBe(false);

    setEnv('TRANSLATION_MEDIAMTX_RTSP_BASE', 'rtsp://127.0.0.1:8554');
    expect(isRtmpIngestEnvReady()).toBe(true);
  });

  it('resolves the MediaMTX probe target from the RTSP base', () => {
    setEnv('TRANSLATION_RTMP_PUBLIC_HOST', '192.168.1.51:1935');
    setEnv('TRANSLATION_MEDIAMTX_RTSP_BASE', 'rtsp://127.0.0.1:8554');
    expect(resolveMediamtxProbeTarget()).toEqual({ host: '127.0.0.1', port: 8554 });
  });

  it('reports MediaMTX unreachable when ingest env is incomplete', async () => {
    setEnv('TRANSLATION_RTMP_PUBLIC_HOST', '127.0.0.1:1935');
    setEnv('TRANSLATION_MEDIAMTX_RTSP_BASE', undefined);
    await expect(probeMediamtxReachable({ bypassCache: true })).resolves.toBe(false);
  });
});
