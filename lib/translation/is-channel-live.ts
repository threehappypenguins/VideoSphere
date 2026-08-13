/**
 * Lightweight live-status probe for RSC/API routes that must not import
 * `session-hub` (which pulls streaming ASR into the module graph and can
 * trigger Next.js webpack HMR full reloads across open tabs).
 */

/** `globalThis` key shared with `session-hub` for the in-process session Map. */
export const TRANSLATION_SESSIONS_GLOBAL_KEY = '__videosphereTranslationSessions' as const;

type LiveProbe = {
  /** True while owner mic ingest is active. */
  ingestActive?: boolean;
};

/**
 * Returns whether ingest is currently considered live for a channel.
 * @param channelId - Channel document id.
 * @returns True when ingest is active on this Node process.
 */
export function isChannelLive(channelId: string): boolean {
  const g = globalThis as typeof globalThis & {
    [TRANSLATION_SESSIONS_GLOBAL_KEY]?: Map<string, LiveProbe>;
  };
  return Boolean(g[TRANSLATION_SESSIONS_GLOBAL_KEY]?.get(channelId)?.ingestActive);
}
