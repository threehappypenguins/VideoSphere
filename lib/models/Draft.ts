import mongoose, { Schema } from 'mongoose';

/**
 * Raw MongoDB document shape for the `drafts` collection.
 *
 * `document` remains a JSON string to match current Appwrite storage and
 * keep migration friction low.
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
