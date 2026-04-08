// =============================================================================
// Shared helpers for the AI generate-metadata endpoints
// (both the standard JSON route and the streaming SSE route)
// =============================================================================

import type { ConnectedAccountPlatform } from '@/types';
import { PLATFORM_LABELS } from '@/lib/ui/platform-label';

/** Max `fileName` length (raw string) before calling the LLM — caps tokens and latency. */
export const MAX_GENERATE_METADATA_FILE_NAME_CHARS = 512;

/** Max optional `userPrompt` length (raw string) before calling the LLM. */
export const MAX_GENERATE_METADATA_USER_PROMPT_CHARS = 4000;

// ---------------------------------------------------------------------------
// Platform character limits (PRD AI-06)
// ---------------------------------------------------------------------------
/**
 * Defines the PLATFORM_LIMITS constant.
 */
export const PLATFORM_LIMITS: Record<
  ConnectedAccountPlatform,
  { titleMax: number; descriptionMax: number }
> = {
  youtube: { titleMax: 100, descriptionMax: 5000 },
  vimeo: { titleMax: 128, descriptionMax: 5000 },
  // Drive is a backup/archive target; keep practical metadata limits aligned with UI defaults.
  google_drive: { titleMax: 255, descriptionMax: 5000 },
};

/** Derive the most restrictive limits across the requested platforms. */
export function getLimits(platforms: ConnectedAccountPlatform[]): {
  titleMax: number;
  descriptionMax: number;
} {
  return platforms.reduce(
    (acc, platform) => {
      const limits = PLATFORM_LIMITS[platform];
      return {
        titleMax: Math.min(acc.titleMax, limits.titleMax),
        descriptionMax: Math.min(acc.descriptionMax, limits.descriptionMax),
      };
    },
    { titleMax: Infinity, descriptionMax: Infinity }
  );
}

/** Build the system prompt with platform-specific limits and SEO guidance. */
export function buildSystemPrompt(
  platforms: ConnectedAccountPlatform[],
  titleMax: number,
  descriptionMax: number
): string {
  const platformList = platforms.join(' and ');
  const platformDetails = platforms
    .map((p) => {
      const l = PLATFORM_LIMITS[p];
      return `- ${PLATFORM_LABELS[p]}: title max ${l.titleMax} chars, description max ${l.descriptionMax} chars`;
    })
    .join('\n');

  return `You are a video SEO expert helping creators write metadata for ${platformList} videos.

Return ONLY a JSON object with exactly these three keys:
  "title"       — string, max ${titleMax} characters
  "description" — string, max ${descriptionMax} characters
  "tags"        — array of 5 to 10 relevant keyword strings

Platform character limits:
${platformDetails}

SEO best practices to follow:
- Place the most important keyword near the start of the title
- Write a description that naturally incorporates relevant keywords in the first 2 sentences (shown before "show more")
- Use specific, searchable tags (mix of broad and niche keywords)
- Keep the tone engaging and informative; avoid keyword stuffing
- Do NOT include hashtags in the description or title
- Respond with ONLY the JSON object — no markdown, no prose, no code fences`;
}

/** Build the user message from filename and optional additional context. */
export function buildUserMessage(fileName: string, userPrompt?: string): string {
  return [
    `Video filename: ${fileName.trim()}`,
    userPrompt?.trim() ? `Additional context: ${userPrompt.trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
