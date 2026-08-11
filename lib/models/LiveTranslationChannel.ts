import mongoose, { Schema } from 'mongoose';
import type { LiveTranslationSttProvider } from '@/lib/translation/capabilities';

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
  /** STT backend: `openrouter` (default) or `groq`. */
  sttProvider?: LiveTranslationSttProvider;
  openRouterApiKeyEncrypted?: string;
  groqApiKeyEncrypted?: string;
  gcpServiceAccountJsonEncrypted?: string;
  /**
   * STT model id for `sttProvider`.
   * Field name is historical; used for both OpenRouter and Groq.
   */
  openRouterSttModel?: string;
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
      enum: ['openrouter', 'groq'],
      default: 'openrouter',
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
