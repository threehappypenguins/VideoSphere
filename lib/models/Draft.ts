import mongoose, { Schema } from 'mongoose';

/**
 * Raw MongoDB document shape for the `drafts` collection.
 *
 * `document` is intentionally stored as a JSON string to preserve the
 * existing payload shape used by repository mapping and API contracts.
 */
export interface DraftDocument {
  _id: string;
  userId: string;
  document: string;
  createdAt: Date;
  updatedAt: Date;
}

const DraftSchema = new Schema<DraftDocument>(
  {
    _id: { type: String },
    userId: { type: String, required: true, index: true, trim: true },
    document: { type: String, required: true },
  },
  { timestamps: true }
);

export const DraftModel =
  (mongoose.models.Draft as mongoose.Model<DraftDocument> | undefined) ||
  mongoose.model<DraftDocument>('Draft', DraftSchema, 'drafts');
