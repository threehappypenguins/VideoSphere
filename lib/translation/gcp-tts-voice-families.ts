// =============================================================================
// GCP TTS voice families (model types) + public pricing hints
// =============================================================================

/**
 * Official Google Cloud Text-to-Speech pricing page.
 */
export const GCP_TTS_PRICING_URL = 'https://cloud.google.com/text-to-speech/pricing';

/**
 * Voice family / model type inferred from a GCP voice resource name.
 * Gemini-TTS and Instant Custom Voice use different APIs and are not listed here.
 */
export type GcpTtsVoiceFamilyId =
  | 'chirp3-hd'
  | 'neural2'
  | 'wavenet'
  | 'standard'
  | 'studio'
  | 'polyglot'
  | 'other';

/**
 * Display + pricing hint for a GCP TTS voice family.
 */
export interface GcpTtsVoiceFamilyInfo {
  /** Stable id used in UI state. */
  id: GcpTtsVoiceFamilyId;
  /** Human-readable model name. */
  label: string;
  /**
   * Free monthly usage limit from Google’s pricing table
   * (e.g. “0 to 4 million characters”).
   */
  freeUsageLimit: string;
  /** Short summary of post-free pricing. */
  priceAfterFree: string;
  /** Lower numbers appear first in the model dropdown. */
  sortOrder: number;
}

/**
 * Curated families supported by classic `synthesizeSpeech` + `listVoices`.
 * Pricing copied from Google Cloud TTS pricing (character-based models).
 */
export const GCP_TTS_VOICE_FAMILIES: Record<
  Exclude<GcpTtsVoiceFamilyId, 'other'>,
  GcpTtsVoiceFamilyInfo
> = {
  standard: {
    id: 'standard',
    label: 'Standard',
    freeUsageLimit: '0 to 4 million characters / month',
    priceAfterFree: 'US$4 per 1 million characters',
    sortOrder: 10,
  },
  wavenet: {
    id: 'wavenet',
    label: 'WaveNet',
    freeUsageLimit: '0 to 4 million characters / month',
    priceAfterFree: 'US$4 per 1 million characters',
    sortOrder: 20,
  },
  neural2: {
    id: 'neural2',
    label: 'Neural2',
    freeUsageLimit: '0 to 1 million characters / month',
    priceAfterFree: 'US$16 per 1 million characters',
    sortOrder: 30,
  },
  polyglot: {
    id: 'polyglot',
    label: 'Polyglot (Preview)',
    freeUsageLimit: '0 to 1 million characters / month',
    priceAfterFree: 'US$16 per 1 million characters',
    sortOrder: 40,
  },
  'chirp3-hd': {
    id: 'chirp3-hd',
    label: 'Chirp 3: HD',
    freeUsageLimit: '0 to 1 million characters / month',
    priceAfterFree: 'US$30 per 1 million characters',
    sortOrder: 50,
  },
  studio: {
    id: 'studio',
    label: 'Studio',
    freeUsageLimit: '0 to 1 million characters / month',
    priceAfterFree: 'US$160 per 1 million characters',
    sortOrder: 60,
  },
};

const OTHER_FAMILY: GcpTtsVoiceFamilyInfo = {
  id: 'other',
  label: 'Other',
  freeUsageLimit: '',
  priceAfterFree: '',
  sortOrder: 100,
};

/**
 * Resolves display metadata for a voice family id.
 * @param id - Family id.
 * @returns Label and free-tier pricing hints.
 */
export function gcpTtsVoiceFamilyInfo(id: GcpTtsVoiceFamilyId): GcpTtsVoiceFamilyInfo {
  if (id === 'other') return OTHER_FAMILY;
  return GCP_TTS_VOICE_FAMILIES[id];
}

/**
 * Classifies a GCP voice resource name into a pricing / model family.
 * @param voiceName - Voice name such as `es-US-Neural2-A` or `en-US-Chirp3-HD-Aoede`.
 * @returns Family id.
 */
export function classifyGcpTtsVoiceFamily(voiceName: string): GcpTtsVoiceFamilyId {
  const name = voiceName.trim();
  if (!name) return 'other';
  // Order matters: Chirp3-HD before generic tokens; Neural2 before Standard-like tokens.
  if (/Chirp3[-_]?HD/i.test(name) || /Chirp[-_]?3[-_]?HD/i.test(name)) return 'chirp3-hd';
  if (/Neural2/i.test(name)) return 'neural2';
  if (/Polyglot/i.test(name)) return 'polyglot';
  if (/Studio/i.test(name)) return 'studio';
  if (/WaveNet|Wavenet/i.test(name)) return 'wavenet';
  if (/Standard/i.test(name)) return 'standard';
  return 'other';
}

/**
 * Lists unique voice families present in a catalog, sorted for the model dropdown.
 * @param voiceNames - Voice resource names from `listVoices`.
 * @returns Family infos available in the catalog.
 */
export function gcpTtsVoiceFamiliesInCatalog(voiceNames: string[]): GcpTtsVoiceFamilyInfo[] {
  const seen = new Set<GcpTtsVoiceFamilyId>();
  for (const name of voiceNames) {
    seen.add(classifyGcpTtsVoiceFamily(name));
  }
  return [...seen]
    .map(gcpTtsVoiceFamilyInfo)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

/**
 * Infers a single family from already-configured voice names (edit modal).
 * @param configuredVoices - Language → voice map values.
 * @returns Shared family, or null when empty / mixed.
 */
export function inferGcpTtsVoiceFamily(
  configuredVoices: Iterable<string>
): GcpTtsVoiceFamilyId | null {
  let family: GcpTtsVoiceFamilyId | null = null;
  for (const voice of configuredVoices) {
    const trimmed = voice.trim();
    if (!trimmed) continue;
    const next = classifyGcpTtsVoiceFamily(trimmed);
    if (family == null) family = next;
    else if (family !== next) return null;
  }
  return family;
}
