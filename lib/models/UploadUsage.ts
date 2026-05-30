import mongoose, { Schema } from 'mongoose';

/**
 * Raw MongoDB document shape for the `upload_usage` collection.
 */
export interface UploadUsageDocument {
  _id: string;
  userId: string;
  month: string;
  uploadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const UploadUsageSchema = new Schema<UploadUsageDocument>(
  {
    _id: { type: String },
    userId: { type: String, required: true, index: true, trim: true },
    month: { type: String, required: true, trim: true },
    uploadCount: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true }
);

UploadUsageSchema.index({ userId: 1, month: 1 }, { unique: true });

export const UploadUsageModel =
  (mongoose.models.UploadUsage as mongoose.Model<UploadUsageDocument> | undefined) ||
  mongoose.model<UploadUsageDocument>('UploadUsage', UploadUsageSchema, 'upload_usage');
