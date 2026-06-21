import mongoose, { Schema } from 'mongoose';

/**
 * Raw MongoDB document shape for the `livestreams` collection.
 *
 * `document` is intentionally stored as a JSON string to preserve the
 * existing payload shape used by repository mapping and API contracts.
 */
export interface LivestreamDocument {
  _id: string;
  userId: string;
  document: string;
  createdAt: Date;
  updatedAt: Date;
}

const LivestreamSchema = new Schema<LivestreamDocument>(
  {
    _id: { type: String },
    userId: { type: String, required: true, index: true, trim: true },
    document: { type: String, required: true },
  },
  { timestamps: true }
);

export const LivestreamModel =
  (mongoose.models.Livestream as mongoose.Model<LivestreamDocument> | undefined) ||
  mongoose.model<LivestreamDocument>('Livestream', LivestreamSchema, 'livestreams');
