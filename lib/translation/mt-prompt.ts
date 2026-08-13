// =============================================================================
// Shared live-sermon MT prompt + recent-source context (OpenRouter / Groq chat)
// =============================================================================

/** Default number of prior finals included for disambiguation. */
export const MT_RECENT_CONTEXT_MAX_LINES = 4;

/** Soft cap on prior-source characters sent with each translate call. */
export const MT_RECENT_CONTEXT_MAX_CHARS = 700;

/**
 * System instructions for live Christian sermon / worship interpretation.
 * Kept compact for free-tier chat models while steering common idiom failures.
 * @param targetLanguageCode - Optional listen language code for hard target hints.
 * @returns System message content.
 */
export function liveSermonTranslateSystemPrompt(targetLanguageCode?: string | null): string {
  const target = targetLanguageCode?.trim().toLowerCase() ?? '';
  const chineseHardHint =
    target === 'zh' || target === 'yue' || target.startsWith('zh')
      ? ' For Mandarin/Cantonese: "I sinned against the Lord" MUST be 我得罪了主 or 我得罪了耶和华 — never 我要与主对抗 / 对抗 / 违抗 as the sense of that confession. '
      : ' ';

  return (
    'You are a precise live interpreter for Christian sermons and worship. ' +
    'Translate only the current segment into the target language. ' +
    'Prefer biblical and liturgical readings over secular ones when both are possible. ' +
    'When the target is Mandarin or Cantonese, write natural text for that variety (not the other).' +
    chineseHardHint +
    'Preferred sense examples (adapt naturally to the target language): ' +
    '"sinned against the Lord/God" = confessed guilt / offended God (not fought or defied God); ' +
    '"sin against" = do wrong toward / offend by sinning (not oppose militarily); ' +
    '"the Word" in preaching often means Scripture; ' +
    '"grace", "fellowship", "the cross", "the blood", "born again" use Christian senses when context fits. ' +
    'Use Recent source only to disambiguate meaning and pronouns; do not translate or summarize it. ' +
    'Return ONLY the translation of the current segment — no quotes, labels, or commentary.'
  );
}

/**
 * Collects prior source finals immediately before a segment for MT context.
 * @param segments - Ordered session segments (oldest first).
 * @param segmentId - Segment currently being translated.
 * @param options - Optional line/char caps.
 * @returns Joined prior source text, or empty when none.
 */
export function buildRecentSourceContext(
  segments: ReadonlyArray<{ id: string; sourceText: string }>,
  segmentId: string,
  options?: { maxLines?: number; maxChars?: number }
): string {
  const maxLines = options?.maxLines ?? MT_RECENT_CONTEXT_MAX_LINES;
  const maxChars = options?.maxChars ?? MT_RECENT_CONTEXT_MAX_CHARS;
  const idx = segments.findIndex((s) => s.id === segmentId);
  if (idx <= 0) return '';

  const prior: string[] = [];
  let chars = 0;
  for (let i = idx - 1; i >= 0 && prior.length < maxLines; i -= 1) {
    const text = segments[i]?.sourceText?.trim() ?? '';
    if (!text) continue;
    if (chars + text.length > maxChars && prior.length > 0) break;
    prior.unshift(text);
    chars += text.length + (prior.length > 1 ? 1 : 0);
  }
  return prior.join('\n');
}

/**
 * Builds the user message for a chat-completions translate call.
 * @param params - Language labels, current text, and optional prior source.
 * @returns User message content.
 */
export function liveSermonTranslateUserPrompt(params: {
  sourceLanguageName: string;
  targetLanguageName: string;
  text: string;
  /** Prior source finals for disambiguation only. */
  recentSourceContext?: string | null;
}): string {
  const trimmed = params.text.trim();
  const recent = params.recentSourceContext?.trim() ?? '';
  const lines = [
    `Source language: ${params.sourceLanguageName}`,
    `Target language: ${params.targetLanguageName}`,
    '',
  ];
  if (recent) {
    lines.push('Recent source (context only; do not translate):', recent, '');
  }
  lines.push('Current segment:', trimmed);
  return lines.join('\n');
}
