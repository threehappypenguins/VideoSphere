import mongoose, { Schema } from 'mongoose';

/**
 * Raw MongoDB document shape for the `password_reset_tokens` collection.
 */
export interface PasswordResetTokenDocument {
  _id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PasswordResetTokenSchema = new Schema<PasswordResetTokenDocument>(
  {
    _id: { type: String },
    token: { type: String, required: true, trim: true },
    userId: { type: String, required: true, trim: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, required: false },
  },
  { timestamps: true }
);

PasswordResetTokenSchema.index(
  { token: 1 },
  { unique: true, name: 'password_reset_tokens_token_unique' }
);
PasswordResetTokenSchema.index(
  { userId: 1, usedAt: 1, createdAt: -1 },
  { name: 'password_reset_tokens_user_lookup' }
);
PasswordResetTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'password_reset_tokens_expires_at_ttl' }
);

export const PasswordResetTokenModel =
  (mongoose.models.PasswordResetToken as mongoose.Model<PasswordResetTokenDocument> | undefined) ||
  mongoose.model<PasswordResetTokenDocument>(
    'PasswordResetToken',
    PasswordResetTokenSchema,
    'password_reset_tokens'
  );
