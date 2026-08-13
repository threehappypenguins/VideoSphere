// =============================================================================
// Source-side sermon idiom clarification + Mandarin safety repair
// =============================================================================

/**
 * True when English looks like confession / offense toward God (not military defiance).
 * @param text - Source and/or recent context.
 * @returns Whether biblical confession sense is plausible.
 */
export function hasSermonConfessSense(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\bsins?\b/i.test(t) ||
    /\bsinned\b/i.test(t) ||
    /\bsinning\b/i.test(t) ||
    /\boffend(?:ed|s|ing)?\b/i.test(t) ||
    /\btrespass/i.test(t) ||
    /\bconfess/i.test(t) ||
    /\brepent/i.test(t) ||
    /\bagainst\s+(?:the\s+)?(?:Lord|God|Him)\b/i.test(t) ||
    /\bbefore\s+the\s+Lord\b/i.test(t)
  );
}

/**
 * True when English explicitly means fight/defy (do not “fix” those translations).
 * @param text - Source text.
 * @returns Whether defiance wording is intentional.
 */
export function hasExplicitDefySense(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\bdef(?:y|ies|ied)\b/i.test(t) ||
    /\bfight(?:s|ing)?\s+against\b/i.test(t) ||
    /\brebel(?:s|led|ling)?\s+(?:against\s+)?(?:the\s+)?(?:Lord|God)\b/i.test(t) ||
    /\boppos(?:e|es|ed|ing)\s+(?:the\s+)?(?:Lord|God)\b/i.test(t)
  );
}

/**
 * Rewrites high-ambiguity English sermon collocations into clearer English before MT.
 * Soft-split ASR often separates “sinned” from “against the Lord”; pass recent context
 * so trailing “against the Lord/God” fragments still clarify.
 *
 * @param text - Source caption final.
 * @param recentSourceContext - Prior source finals (optional).
 * @returns Clarified text, or the original when nothing matched.
 */
export function clarifySermonSourceForMt(
  text: string,
  recentSourceContext?: string | null
): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  let out = trimmed;
  const recent = recentSourceContext?.trim() ?? '';
  const combined = `${recent}\n${trimmed}`;

  // Specific biblical subjects first (remove “against” entirely).
  out = out.replace(
    /\bI(?:'ve|\s+have|\s+had)?\s+sinned\s+against\s+the\s+Lord\b/gi,
    'I have sinned before the Lord and offended the Lord'
  );
  out = out.replace(
    /\bI(?:'ve|\s+have|\s+had)?\s+sinned\s+against\s+(?:the\s+)?God\b/gi,
    'I have sinned before God and offended God'
  );
  out = out.replace(
    /\b(?:he|she|they)\s+(?:has|have|had)\s+sinned\s+against\s+the\s+Lord\b/gi,
    (match) =>
      /\bthey\b/i.test(match)
        ? 'they have sinned before the Lord and offended the Lord'
        : /\bshe\b/i.test(match)
          ? 'she has sinned before the Lord and offended the Lord'
          : 'he has sinned before the Lord and offended the Lord'
  );
  out = out.replace(
    /\bsinned\s+against\s+the\s+Lord\b/gi,
    'sinned before the Lord and offended the Lord'
  );
  out = out.replace(
    /\bsinned\s+against\s+(?:the\s+)?God\b/gi,
    'sinned before God and offended God'
  );
  out = out.replace(/\bsin\s+against\s+the\s+Lord\b/gi, 'sin before the Lord and offend the Lord');
  out = out.replace(/\bsin\s+against\s+(?:the\s+)?God\b/gi, 'sin before God and offend God');
  out = out.replace(
    /\bsins\s+against\s+the\s+Lord\b/gi,
    'sins before the Lord and offends the Lord'
  );

  // Generic leftovers: still drop “against”.
  out = out.replace(/\b(have|has|had)\s+sinned\s+against\b/gi, '$1 sinned before and offended');
  out = out.replace(/\bsinned\s+against\b/gi, 'sinned before and offended');
  out = out.replace(
    /\b(do|does|did|will|shall|may|must|should|would|can|could)\s+not\s+sin\s+against\b/gi,
    '$1 not sin before or offend'
  );
  out = out.replace(/\bsin\s+against\b/gi, 'sin before and offend');
  out = out.replace(/\bsins\s+against\b/gi, 'sins before and offends');

  // Soft-split fragments: prior line had sin/confess; this line is only “against the Lord/God”.
  if (hasSermonConfessSense(combined) && !hasExplicitDefySense(trimmed)) {
    out = out.replace(/(?:^|["'“‘])\s*against\s+the\s+Lord\b/gi, (m) =>
      m.replace(/against\s+the\s+Lord/i, 'before the Lord — having offended the Lord')
    );
    out = out.replace(/(?:^|["'“‘])\s*against\s+(?:the\s+)?God\b/gi, (m) =>
      m.replace(/against\s+(?:the\s+)?God/i, 'before God — having offended God')
    );
    // Mid-sentence trailing fragment after a quote verb.
    out = out.replace(
      /\bsaid\s*[,:]?\s*["'“‘]?\s*against\s+the\s+Lord\b/gi,
      'said "I have sinned before the Lord and offended the Lord"'
    );
  }

  // Lord's Prayer / liturgy.
  out = out.replace(/\btrespassed\s+against\b/gi, 'wronged');
  out = out.replace(/\btrespass\s+against\b/gi, 'wrong');
  out = out.replace(/\btrespasses\s+against\b/gi, 'wrongs');

  return out;
}

/**
 * @deprecated Use {@link clarifySermonSourceForMt}.
 * @param text - Source caption final.
 * @returns Clarified text.
 */
export function clarifySermonSourceForNmt(text: string): string {
  return clarifySermonSourceForMt(text);
}

/**
 * Maps a defiance/betrayal collocation match to the confession wording.
 * @param match - Matched Chinese substring.
 * @returns Confession phrasing.
 */
function chineseConfessReplacement(match: string): string {
  if (match.includes('耶和华')) return match.startsWith('我') ? '我得罪了耶和华' : '得罪了耶和华';
  if (match.includes('上帝')) return match.startsWith('我') ? '我得罪了上帝' : '得罪了上帝';
  if (match.includes('神')) return match.startsWith('我') ? '我得罪了神' : '得罪了神';
  return match.startsWith('我') ? '我得罪了主' : '得罪了主';
}

/**
 * Repairs known Mandarin/Cantonese mistranslations of biblical “sin against”
 * (fight/defy 对抗, betray 背叛) when confession sense is plausible from the
 * current segment and/or recent source context.
 * @param params - Source, optional recent context, translated text, target code.
 * @returns Possibly repaired translation.
 */
export function repairSermonTranslation(params: {
  sourceText: string;
  /** Prior source finals — needed when ASR soft-splits the collocation. */
  recentSourceContext?: string | null;
  translatedText: string;
  targetLanguage: string;
}): string {
  const translated = params.translatedText.trim();
  if (!translated) return '';

  const target = params.targetLanguage.trim().toLowerCase();
  if (target !== 'zh' && target !== 'yue' && !target.startsWith('zh')) {
    return translated;
  }

  const source = `${params.recentSourceContext ?? ''}\n${params.sourceText}`;
  if (hasExplicitDefySense(params.sourceText)) return translated;

  // Repair when this line or nearby lines look like confession / “against the Lord”,
  // OR when the MT output itself is the known bad collocation (model ignored prompts).
  const outputLooksLikeDefyGod =
    /(?:我要)?与(?:主|神|上帝|耶和华)对抗/.test(translated) ||
    /对抗(?:了)?(?:主|神|上帝|耶和华)/.test(translated) ||
    /背叛(?:了)?(?:主|神|上帝|耶和华)/.test(translated);

  if (!hasSermonConfessSense(source) && !outputLooksLikeDefyGod) {
    return translated;
  }

  let out = translated;
  out = out.replace(/我要与(?:主|神|上帝|耶和华)对抗/g, (m) => chineseConfessReplacement(m));
  out = out.replace(/与(?:主|神|上帝|耶和华)对抗/g, (m) => chineseConfessReplacement(m));
  out = out.replace(/对抗(?:了)?(?:主|神|上帝|耶和华)/g, (m) => chineseConfessReplacement(m));
  // Soft-split “against God” often becomes 背叛上帝 in NMT/chat.
  out = out.replace(/背叛(?:了)?(?:主|神|上帝|耶和华)/g, (m) => {
    if (m.includes('耶和华')) return '得罪了耶和华';
    if (m.includes('上帝')) return '得罪了上帝';
    if (m.includes('神')) return '得罪了神';
    return '得罪了主';
  });

  return out;
}
