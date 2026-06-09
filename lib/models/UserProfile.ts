import mongoose, { Schema } from 'mongoose';
import type { PlatformDefaults, UserAuthProvider, UserRole } from '@/types';

/**
 * Raw MongoDB document shape for the `user_profiles` collection.
 */
export interface UserProfileDocument {
  _id: string;
  userId: string;
  email: string;
  name?: string;
  passwordHash?: string;
  hasCompletedOnboarding: boolean;
  role: UserRole;
  /** Sign-in method; required on every profile at creation. */
  authProvider: UserAuthProvider;
  /** AES-256-GCM encrypted Google login refresh token for revoke-on-delete. */
  googleRefreshToken?: string;
  /** AES-256-GCM encrypted TOTP secret when two-factor auth is configured. */
  totpSecret?: string;
  /** Whether TOTP second factor is required at login. */
  totpEnabled: boolean;
  /** Per-platform upload default settings for new drafts. */
  platformDefaults?: PlatformDefaults;
  createdAt: Date;
  updatedAt: Date;
}

const UserProfileSchema = new Schema<UserProfileDocument>(
  {
    _id: { type: String },
    userId: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: false, trim: true },
    passwordHash: { type: String, required: false },
    hasCompletedOnboarding: { type: Boolean, default: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    authProvider: {
      type: String,
      enum: ['google', 'password'],
      required: true,
      default: 'password',
    },
    googleRefreshToken: { type: String, required: false },
    totpSecret: { type: String, required: false },
    totpEnabled: { type: Boolean, default: false },
    platformDefaults: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const UserProfileModel =
  (mongoose.models.UserProfile as mongoose.Model<UserProfileDocument> | undefined) ||
  mongoose.model<UserProfileDocument>('UserProfile', UserProfileSchema, 'user_profiles');
