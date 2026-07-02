import mongoose, { Schema } from 'mongoose';
import type { LivestreamStatus } from '@/types';

/**
 * Raw MongoDB document shape for the `livestreams` collection.
 *
 * `document` is intentionally stored as a JSON string to preserve the
 * existing payload shape used by repository mapping and API contracts.
 * Top-level query fields mirror common list filters so pagination does not
 * require loading every row into memory.
 */
export interface LivestreamDocument {
  _id: string;
  userId: string;
  document: string;
  status?: LivestreamStatus;
  hasYoutubeTarget?: boolean;
  youtubeBroadcastId?: string;
  youtubeLifecycleStatus?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LIVESTREAM_STATUS_VALUES = ['draft', 'scheduled', 'live', 'ended', 'failed'] as const;

const LivestreamSchema = new Schema<LivestreamDocument>(
  {
    _id: { type: String },
    userId: { type: String, required: true, index: true, trim: true },
    document: { type: String, required: true },
    status: { type: String, enum: LIVESTREAM_STATUS_VALUES, index: true },
    hasYoutubeTarget: { type: Boolean, default: false, index: true },
    youtubeBroadcastId: { type: String, default: '', trim: true },
    youtubeLifecycleStatus: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

LivestreamSchema.index({ userId: 1, status: 1, updatedAt: -1 });
LivestreamSchema.index({
  userId: 1,
  hasYoutubeTarget: 1,
  youtubeBroadcastId: 1,
  updatedAt: -1,
});

export const LivestreamModel =
  (mongoose.models.Livestream as mongoose.Model<LivestreamDocument> | undefined) ||
  mongoose.model<LivestreamDocument>('Livestream', LivestreamSchema, 'livestreams');
