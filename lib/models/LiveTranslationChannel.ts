import mongoose, { Schema } from 'mongoose';
import type {
  LiveTranslationSttProvider,
  LiveTranslationTextTranslateProvider,
} from '@/lib/translation/capabilities';

/**
 * Raw MongoDB document shape for the `live_translation_channels` collection.
 */
export interface LiveTranslationChannelDocument {
  _id: string;
  userId: string;
  slug: string;
  publicEnabled: boolean;
  sourceLanguage: string;
  enabledLanguages: string[];
  /** SHA-256 of the RTMP stream key (MediaMTX auth). */
  streamKeyHash?: string;
  /**
   * Encrypted plaintext stream key so the owner can reveal/copy it again.
   * Auth still uses {@link streamKeyHash}; this field is never sent to MediaMTX.
   */
  streamKeyEncrypted?: string;
  /** STT backend (streaming ASR). */
  sttProvider?: LiveTranslationSttProvider;
  /** Caption translation backend (unused when STT is Soniox). */
  textTranslateProvider?: LiveTranslationTextTranslateProvider;
  openRouterApiKeyEncrypted?: string;
  groqApiKeyEncrypted?: string;
  deepgramApiKeyEncrypted?: string;
  assemblyaiApiKeyEncrypted?: string;
  gladiaApiKeyEncrypted?: string;
  speechmaticsApiKeyEncrypted?: string;
  sonioxApiKeyEncrypted?: string;
  modulateApiKeyEncrypted?: string;
  elevenLabsApiKeyEncrypted?: string;
  gcpServiceAccountJsonEncrypted?: string;
  /**
   * Chat translation model id for OpenRouter or Groq.
   * Unused when `textTranslateProvider` is `gcp` or STT is Soniox.
   */
  openRouterTranslateModel?: string;
  /** Per-language GCP TTS voices: ISO code → voice resource name. */
  gcpTtsVoices?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

const LiveTranslationChannelSchema = new Schema<LiveTranslationChannelDocument>(
  {
    _id: { type: String },
    userId: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    publicEnabled: { type: Boolean, default: false },
    sourceLanguage: { type: String, required: true, trim: true, default: 'en' },
    enabledLanguages: { type: [String], default: [] },
    streamKeyHash: { type: String, required: false },
    streamKeyEncrypted: { type: String, required: false },
    sttProvider: {
      type: String,
      required: false,
      trim: true,
      enum: [
        'deepgram',
        'assemblyai',
        'gladia',
        'speechmatics',
        'soniox',
        'modulate',
        'elevenlabs',
      ],
    },
    textTranslateProvider: {
      type: String,
      required: false,
      trim: true,
      enum: ['openrouter', 'groq', 'gcp'],
    },
    openRouterApiKeyEncrypted: { type: String, required: false },
    groqApiKeyEncrypted: { type: String, required: false },
    deepgramApiKeyEncrypted: { type: String, required: false },
    assemblyaiApiKeyEncrypted: { type: String, required: false },
    gladiaApiKeyEncrypted: { type: String, required: false },
    speechmaticsApiKeyEncrypted: { type: String, required: false },
    sonioxApiKeyEncrypted: { type: String, required: false },
    modulateApiKeyEncrypted: { type: String, required: false },
    elevenLabsApiKeyEncrypted: { type: String, required: false },
    gcpServiceAccountJsonEncrypted: { type: String, required: false },
    openRouterTranslateModel: { type: String, required: false, trim: true },
    gcpTtsVoices: { type: Map, of: String, required: false },
  },
  { timestamps: true }
);

export const LiveTranslationChannelModel = (() => {
  const existing = mongoose.models.LiveTranslationChannel as
    | mongoose.Model<LiveTranslationChannelDocument>
    | undefined;
  if (existing) {
    // Next.js HMR can keep a cached model compiled before new paths existed; without this,
    // strict mode strips fields like streamKeyEncrypted on $set.
    if (!existing.schema.path('streamKeyEncrypted')) {
      existing.schema.add({ streamKeyEncrypted: { type: String, required: false } });
    }
    return existing;
  }
  return mongoose.model<LiveTranslationChannelDocument>(
    'LiveTranslationChannel',
    LiveTranslationChannelSchema,
    'live_translation_channels'
  );
})();
