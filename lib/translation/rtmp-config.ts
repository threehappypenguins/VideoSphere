// =============================================================================
// Optional MediaMTX / RTMP public URL helpers
// =============================================================================

import { connect as tcpConnect } from 'node:net';

/** Default RTMP listen port when TRANSLATION_RTMP_PUBLIC_HOST omits one. */
const DEFAULT_RTMP_PORT = 1935;
/** Default RTSP listen port when TRANSLATION_MEDIAMTX_RTSP_BASE omits one. */
const DEFAULT_RTSP_PORT = 8554;
/** TCP connect budget for the MediaMTX reachability probe. */
const MEDIAMTX_PROBE_TIMEOUT_MS = 800;
/** Reuse the last probe result briefly so owner-view rebuilds do not thrash TCP. */
const MEDIAMTX_PROBE_CACHE_MS = 3_000;

type MediamtxProbeTarget = { host: string; port: number };

let mediamtxProbeCache: { at: number; reachable: boolean } | null = null;

/**
 * Reads optional public RTMP host configuration for MediaMTX ingest.
 * Not required for browser mic ingest. No shared API keys live here.
 * @returns Host (and optional port) string, or null when unset.
 */
export function getTranslationRtmpPublicHost(): string | null {
  const host = process.env.TRANSLATION_RTMP_PUBLIC_HOST?.trim();
  return host || null;
}

/**
 * Internal RTSP base URL for the app to pull published paths from MediaMTX
 * (e.g. `rtsp://mediamtx:8554` on the Docker network).
 * @returns Base URL without trailing slash, or null when unset.
 */
export function getMediamtxRtspBase(): string | null {
  const base = process.env.TRANSLATION_MEDIAMTX_RTSP_BASE?.trim();
  if (!base) return null;
  return base.replace(/\/+$/, '');
}

/**
 * Shared secret for MediaMTX → app publisher webhooks (optional).
 * When unset, the publisher route rejects requests; RTMP auth can still start pullers.
 * @returns Secret string, or null when unset.
 */
export function getRtmpHookSecret(): string | null {
  const secret = process.env.TRANSLATION_RTMP_HOOK_SECRET?.trim();
  return secret || null;
}

/**
 * Path prefix used in RTMP/RTSP URLs (default `live`).
 * @returns Normalized path prefix without leading/trailing slashes.
 */
export function getTranslationRtmpPathPrefix(): string {
  return (process.env.TRANSLATION_RTMP_PATH_PREFIX?.trim() || 'live').replace(/^\/+|\/+$/g, '');
}

/**
 * Builds the owner-facing OBS Server URL (no stream key).
 * OBS Stream Key is pasted separately into the Stream Key field.
 * @returns `rtmp://host/live` style URL, or null when RTMP host env is not set.
 */
export function buildRtmpServerUrl(): string | null {
  const host = getTranslationRtmpPublicHost();
  if (!host) return null;
  const pathPrefix = getTranslationRtmpPathPrefix();
  if (host.startsWith('rtmp://') || host.startsWith('rtmps://')) {
    return `${host.replace(/\/+$/, '')}/${pathPrefix}`;
  }
  return `rtmp://${host.replace(/\/+$/, '')}/${pathPrefix}`;
}

/**
 * Builds the full RTMP publish URL including the stream key (single-field tools).
 * Prefer {@link buildRtmpServerUrl} + the key separately for OBS Custom.
 * @param streamKeyPlaintext - Plaintext stream key.
 * @returns Full rtmp:// URL, or null when RTMP host env is not set.
 */
export function buildRtmpPublishUrl(streamKeyPlaintext: string): string | null {
  const server = buildRtmpServerUrl();
  if (!server) return null;
  const key = streamKeyPlaintext.trim();
  if (!key) return null;
  return `${server}/${key}`;
}

/**
 * Builds the RTSP URL the app uses to pull a published MediaMTX path as PCM.
 * @param mtxPath - MediaMTX path (e.g. `live/<streamKey>` or bare stream key).
 * @returns Absolute RTSP URL, or null when RTSP base is not configured.
 */
export function buildMediamtxRtspUrl(mtxPath: string): string | null {
  const base = getMediamtxRtspBase();
  if (!base) return null;
  const cleaned = mtxPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleaned) return null;
  return `${base}/${cleaned}`;
}

/**
 * Extracts the stream key segment from a MediaMTX path.
 * @param mtxPath - Path such as `live/abc123` or `abc123`.
 * @returns Last path segment, or empty string.
 */
export function streamKeyFromMtxPath(mtxPath: string): string {
  const segments = mtxPath.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

/**
 * Returns whether optional RTMP/MediaMTX public host env is present.
 * @returns True when TRANSLATION_RTMP_PUBLIC_HOST is set.
 */
export function isRtmpConfigured(): boolean {
  return getTranslationRtmpPublicHost() !== null;
}

/**
 * True when both the public RTMP host and internal RTSP base env vars are set.
 * Stream-key controls need both so OBS and the app puller can talk to MediaMTX.
 * @returns Whether RTMP ingest is fully wired in env.
 */
export function isRtmpIngestEnvReady(): boolean {
  return isRtmpConfigured() && getMediamtxRtspBase() !== null;
}

/**
 * Parses `host:port` from an RTMP public host env value.
 * @param raw - Value of TRANSLATION_RTMP_PUBLIC_HOST.
 * @returns Probe target, or null when unparseable.
 */
function parseRtmpPublicHostTarget(raw: string): MediamtxProbeTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme =
      trimmed.startsWith('rtmp://') || trimmed.startsWith('rtmps://')
        ? trimmed
        : `rtmp://${trimmed}`;
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    const port = url.port ? Number(url.port) : DEFAULT_RTMP_PORT;
    if (!Number.isFinite(port) || port <= 0) return null;
    return { host: url.hostname, port };
  } catch {
    return null;
  }
}

/**
 * Parses host/port from the RTSP base the app uses to pull PCM.
 * @param raw - Value of TRANSLATION_MEDIAMTX_RTSP_BASE.
 * @returns Probe target, or null when unparseable.
 */
function parseRtspBaseTarget(raw: string): MediamtxProbeTarget | null {
  try {
    const url = new URL(raw);
    if (!url.hostname) return null;
    const port = url.port ? Number(url.port) : DEFAULT_RTSP_PORT;
    if (!Number.isFinite(port) || port <= 0) return null;
    return { host: url.hostname, port };
  } catch {
    return null;
  }
}

/**
 * Chooses the TCP probe target for MediaMTX (RTSP pull address preferred).
 * @returns Host/port to connect to, or null when env is incomplete.
 */
export function resolveMediamtxProbeTarget(): MediamtxProbeTarget | null {
  const rtspBase = getMediamtxRtspBase();
  if (rtspBase) {
    const fromRtsp = parseRtspBaseTarget(rtspBase);
    if (fromRtsp) return fromRtsp;
  }
  const publicHost = getTranslationRtmpPublicHost();
  if (publicHost) return parseRtmpPublicHostTarget(publicHost);
  return null;
}

/**
 * Attempts a short TCP connect to `host:port`.
 * @param target - Destination.
 * @param timeoutMs - Connect deadline.
 * @returns True when the TCP handshake succeeds.
 */
function tcpProbe(target: MediamtxProbeTarget, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tcpConnect({ host: target.host, port: target.port });
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Probes whether MediaMTX is reachable from this process (sidecar up + env wired).
 * Results are cached briefly so repeated owner-view builds do not open many sockets.
 * @param options - Optional cache bypass (e.g. owner clicked “Check again”).
 * @returns True when env is ready and a TCP connect to MediaMTX succeeds.
 */
export async function probeMediamtxReachable(options?: {
  bypassCache?: boolean;
}): Promise<boolean> {
  if (!isRtmpIngestEnvReady()) {
    mediamtxProbeCache = null;
    return false;
  }
  const target = resolveMediamtxProbeTarget();
  if (!target) {
    mediamtxProbeCache = null;
    return false;
  }

  const now = Date.now();
  if (
    !options?.bypassCache &&
    mediamtxProbeCache &&
    now - mediamtxProbeCache.at < MEDIAMTX_PROBE_CACHE_MS
  ) {
    return mediamtxProbeCache.reachable;
  }

  const reachable = await tcpProbe(target, MEDIAMTX_PROBE_TIMEOUT_MS);
  mediamtxProbeCache = { at: now, reachable };
  return reachable;
}

/**
 * Clears the MediaMTX probe cache (tests / forced recheck).
 * @returns Void.
 */
export function __resetMediamtxProbeCacheForTests(): void {
  mediamtxProbeCache = null;
}
