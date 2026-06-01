import mongoose, { Schema } from 'mongoose';

/**
 * Defines invite token purpose.
 */
export type InviteTokenPurpose = 'setup' | 'invite';

/**
 * Raw MongoDB document shape for the `invites` collection.
 */
export interface InviteTokenDocument {
  _id: string;
  token: string;
  purpose: InviteTokenPurpose;
  createdBy?: string;
  createdAt: Date;
  expiresAt?: Date;
  usedAt?: Date;
  usedBy?: string;
  updatedAt: Date;
}

const InviteTokenSchema = new Schema<InviteTokenDocument>(
  {
    _id: { type: String },
    token: { type: String, required: true, unique: true, trim: true },
    purpose: { type: String, enum: ['setup', 'invite'], required: true },
    createdBy: { type: String, required: false, trim: true },
    createdAt: { type: Date, default: Date.now, required: true },
    expiresAt: { type: Date, required: false },
    usedAt: { type: Date, required: false },
    usedBy: { type: String, required: false, trim: true },
  },
  { timestamps: true }
);

InviteTokenSchema.index({ token: 1 }, { unique: true, name: 'invites_token_unique' });
InviteTokenSchema.index({ purpose: 1, usedAt: 1, createdAt: -1 }, { name: 'invites_lookup' });
InviteTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'invites_expires_at_ttl' }
);

export const InviteTokenModel =
  (mongoose.models.InviteToken as mongoose.Model<InviteTokenDocument> | undefined) ||
  mongoose.model<InviteTokenDocument>('InviteToken', InviteTokenSchema, 'invites');
