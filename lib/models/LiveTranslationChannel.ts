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
  /** STT backend: `openrouter`, `groq`, or `gcp` (unset until the owner chooses). */
  sttProvider?: LiveTranslationSttProvider;
  /** Caption translation backend: `openrouter`, `groq`, or `gcp` (unset until chosen; no auto-fallback). */
  textTranslateProvider?: LiveTranslationTextTranslateProvider;
  openRouterApiKeyEncrypted?: string;
  groqApiKeyEncrypted?: string;
  gcpServiceAccountJsonEncrypted?: string;
  /**
   * STT model id for `sttProvider`.
   * Field name is historical; used for OpenRouter, Groq, and GCP recognition models.
   */
  openRouterSttModel?: string;
  /**
   * Chat translation model id for OpenRouter or Groq.
   * Unused when `textTranslateProvider` is `gcp`.
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
      enum: ['openrouter', 'groq', 'gcp'],
    },
    textTranslateProvider: {
      type: String,
      required: false,
      trim: true,
      enum: ['openrouter', 'groq', 'gcp'],
    },
    openRouterApiKeyEncrypted: { type: String, required: false },
    groqApiKeyEncrypted: { type: String, required: false },
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
