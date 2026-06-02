#!/usr/bin/env node
'use strict';

/**
 * Standalone admin password reset script for shell access recovery.
 *
 * Usage:
 *   node scripts/reset-admin-password.js
 *   node scripts/reset-admin-password.js --email admin@example.com
 *
 * In Docker:
 *   docker exec -it videosphere node scripts/reset-admin-password.js
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MIN_PASSWORD_LENGTH = 8;
const MIN_PASSWORD_STRENGTH_SCORE = 3;
const OAUTH_PASSWORD_RESET_MESSAGE =
  'This account uses Google sign-in and does not have a password to reset.';

const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'password12',
  'password123',
  'qwerty123',
  'admin123',
  'letmein1',
  'welcome1',
  'iloveyou',
]);

const UserProfileSchema = new mongoose.Schema(
  {
    _id: { type: String },
    userId: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    authProvider: { type: String, enum: ['google', 'password'], required: false },
  },
  { timestamps: true, collection: 'user_profiles' }
);

const UserProfileModel =
  mongoose.models.UserProfile || mongoose.model('UserProfile', UserProfileSchema);

/**
 * Loads key/value pairs from `.env.local` when variables are not already set.
 */
function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

/**
 * Parses `--email` from argv.
 * @returns Target email when provided; otherwise null.
 */
function parseEmailArg() {
  const emailFlagIndex = process.argv.indexOf('--email');
  if (emailFlagIndex === -1) return null;

  const email = process.argv[emailFlagIndex + 1];
  if (!email || email.startsWith('--')) {
    console.error('Error: --email requires a value.');
    process.exit(1);
  }

  return email.trim().toLowerCase();
}

/**
 * Prompts for a password on non-TTY stdin (input may be visible).
 * @param prompt - Prompt text shown to the operator.
 * @returns Entered password string.
 */
function promptVisiblePassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${prompt} (input may be visible in non-interactive mode): `, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Reads a hidden password using raw TTY mode when available.
 * @param prompt - Prompt text shown to the operator.
 * @returns Entered password string.
 */
async function readPassword(prompt) {
  if (!process.stdin.isTTY) {
    return promptVisiblePassword(prompt);
  }

  process.stdout.write(prompt);

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.removeListener('data', onData);
      stdin.pause();
      process.stdout.write('\n');
    };

    const onData = (char) => {
      if (char === '\u0003') {
        cleanup();
        process.exit(1);
      }

      if (char === '\r' || char === '\n' || char === '\u0004') {
        cleanup();
        resolve(password);
        return;
      }

      if (char === '\u007f' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
        }
        return;
      }

      password += char;
    };

    stdin.on('data', onData);
  });
}

/**
 * Validates and confirms a new password interactively.
 * @returns The confirmed plaintext password.
 */
async function promptForNewPassword() {
  while (true) {
    const password = await readPassword('New password: ');
    const passwordError = validatePassword(password);
    if (passwordError) {
      console.error(`Error: ${passwordError}`);
      continue;
    }

    const confirm = await readPassword('Confirm new password: ');
    if (password !== confirm) {
      console.error('Error: Passwords do not match.');
      continue;
    }

    return password;
  }
}

/**
 * Scores password strength on a 0–5 scale (matches `lib/auth/password.ts`).
 * @param password - Plaintext password.
 * @returns Strength score.
 */
function scorePasswordStrength(password) {
  if (!password) return 0;

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

/**
 * Validates password length against application requirements.
 * @param password - Plaintext password.
 * @returns Error message or null when valid.
 */
function validatePassword(password) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Password is too common. Choose a stronger password.';
  }

  if (scorePasswordStrength(password) < MIN_PASSWORD_STRENGTH_SCORE) {
    return 'Password is too weak. Use a mix of letters, numbers, and symbols.';
  }

  return null;
}

/**
 * Returns whether the profile supports password reset.
 * @param user - Mongo user profile document.
 * @returns True when a local password can be set or reset.
 */
function userSupportsPasswordReset(user) {
  if (typeof user.passwordHash === 'string' && user.passwordHash.length > 0) {
    return true;
  }

  return user.authProvider === 'password';
}

/**
 * Finds the admin account to reset.
 * @param email - Optional explicit email target.
 * @returns Matching user profile document.
 */
async function findTargetUser(email) {
  if (email) {
    const user = await UserProfileModel.findOne({ email }).lean();
    if (!user) {
      throw new Error(`No user found with email ${email}.`);
    }
    return user;
  }

  const admin = await UserProfileModel.findOne({ role: 'admin' }).sort({ createdAt: 1 }).lean();
  if (!admin) {
    throw new Error('No admin user found. Use --email to target a specific account.');
  }
  return admin;
}

async function main() {
  loadEnvLocal();

  const mongodbUri = process.env.MONGODB_URI;
  if (!mongodbUri) {
    console.error('Error: MONGODB_URI is not set. Configure it in .env.local or the environment.');
    process.exit(1);
  }

  const targetEmail = parseEmailArg();

  await mongoose.connect(mongodbUri, { bufferCommands: false });

  try {
    const user = await findTargetUser(targetEmail);
    if (!userSupportsPasswordReset(user)) {
      throw new Error(OAUTH_PASSWORD_RESET_MESSAGE);
    }

    const password = await promptForNewPassword();
    const passwordHash = await bcrypt.hash(password, 10);

    await UserProfileModel.updateOne({ _id: user._id }, { $set: { passwordHash } });

    console.log('');
    console.log(`✅ Password updated for ${user.email} (${user.role}).`);
    console.log('You can now log in with the new password.');
    console.log('');
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    void mongoose.disconnect().finally(() => {
      process.exit(1);
    });
  });
