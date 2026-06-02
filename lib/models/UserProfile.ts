import mongoose, { Schema } from 'mongoose';
import type { UserAuthProvider, UserRole } from '@/types';

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
  /** Present when the profile was created or last signed in via Google OAuth login. */
  authProvider?: UserAuthProvider;
  /** AES-256-GCM encrypted Google login refresh token for revoke-on-delete. */
  googleRefreshToken?: string;
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
    authProvider: { type: String, enum: ['google', 'password'], required: false },
    googleRefreshToken: { type: String, required: false },
  },
  { timestamps: true }
);

export const UserProfileModel =
  (mongoose.models.UserProfile as mongoose.Model<UserProfileDocument> | undefined) ||
  mongoose.model<UserProfileDocument>('UserProfile', UserProfileSchema, 'user_profiles');
