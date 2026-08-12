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
  streamKeyHash?: string;
  /**
   * STT backend: streaming ASR or Groq chunked Whisper.
   * Legacy `openrouter` / `gcp` values are ignored at runtime.
   */
  sttProvider?: LiveTranslationSttProvider | string;
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
  gcpServiceAccountJsonEncrypted?: string;
  /**
   * STT model id for Groq Whisper.
   * Field name is historical; unused for streaming ASR providers.
   */
  openRouterSttModel?: string;
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
    sttProvider: {
      type: String,
      required: false,
      trim: true,
      // Keep legacy values in enum so old documents still load; normalizeSttProvider drops them.
      enum: [
        'deepgram',
        'assemblyai',
        'gladia',
        'speechmatics',
        'soniox',
        'modulate',
        'groq',
        'openrouter',
        'gcp',
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
    gcpServiceAccountJsonEncrypted: { type: String, required: false },
    openRouterSttModel: { type: String, required: false, trim: true },
    openRouterTranslateModel: { type: String, required: false, trim: true },
    gcpTtsVoices: { type: Map, of: String, required: false },
  },
  { timestamps: true }
);

export const LiveTranslationChannelModel =
  (mongoose.models.LiveTranslationChannel as
    | mongoose.Model<LiveTranslationChannelDocument>
    | undefined) ||
  mongoose.model<LiveTranslationChannelDocument>(
    'LiveTranslationChannel',
    LiveTranslationChannelSchema,
    'live_translation_channels'
  );
