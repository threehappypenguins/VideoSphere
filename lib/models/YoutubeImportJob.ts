import mongoose, { Schema } from 'mongoose';
import type { YoutubeImportJobStatus } from '@/types';

/**
 * Raw MongoDB document shape for the `youtube_import_jobs` collection.
 */
export interface YoutubeImportJobDocument {
  _id: string;
  userId: string;
  draftId: string;
  sourceUrl: string;
  youtubeVideoId: string;
  livestreamId: string;
  startSeconds: number;
  endSeconds: number;
  status: YoutubeImportJobStatus;
  progressPercent: number;
  errorMessage: string;
  r2Key: string;
  uploadJobId: string;
  distributeQueued: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ACTIVE_YOUTUBE_IMPORT_JOB_STATUSES: YoutubeImportJobStatus[] = [
  'pending',
  'downloading',
  'trimming',
  'uploading',
];

const YoutubeImportJobSchema = new Schema<YoutubeImportJobDocument>(
  {
    _id: { type: String },
    userId: { type: String, required: true, trim: true },
    draftId: { type: String, required: true, trim: true },
    sourceUrl: { type: String, required: true, trim: true },
    youtubeVideoId: { type: String, required: true, trim: true },
    livestreamId: { type: String, default: '' },
    startSeconds: { type: Number, required: true, min: 0 },
    endSeconds: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'downloading', 'trimming', 'uploading', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
    errorMessage: { type: String, default: '' },
    r2Key: { type: String, default: '' },
    uploadJobId: { type: String, default: '' },
    distributeQueued: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Partial unique index on userId for in-flight jobs (see getActiveYoutubeImportJobForUser).
// Do not also set index: true on the userId field — that creates a duplicate { userId: 1 } index.
YoutubeImportJobSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ACTIVE_YOUTUBE_IMPORT_JOB_STATUSES },
    },
  }
);

YoutubeImportJobSchema.index({ draftId: 1, createdAt: -1 });

export const YoutubeImportJobModel =
  (mongoose.models.YoutubeImportJob as mongoose.Model<YoutubeImportJobDocument> | undefined) ||
  mongoose.model<YoutubeImportJobDocument>(
    'YoutubeImportJob',
    YoutubeImportJobSchema,
    'youtube_import_jobs'
  );
