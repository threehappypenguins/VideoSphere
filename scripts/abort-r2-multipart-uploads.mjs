#!/usr/bin/env node
'use strict';

/**
 * Aborts incomplete R2 multipart uploads that the dashboard shows as greyed-out
 * "Ongoing Multipart Upload" rows (they are not normal objects and cannot be deleted
 * from the object list or by "Empty bucket").
 *
 * Usage:
 *   node scripts/abort-r2-multipart-uploads.mjs
 *   node scripts/abort-r2-multipart-uploads.mjs --prefix temp/uploads/
 *   node scripts/abort-r2-multipart-uploads.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');

/**
 * Loads key/value pairs from `.env.local` when variables are not already set.
 */
function loadEnvLocal() {
  const envPath = path.join(APP_ROOT, '.env.local');
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

function parseArgs(argv) {
  let prefix = '';
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--prefix') {
      prefix = argv[++i] ?? '';
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: node scripts/abort-r2-multipart-uploads.mjs [--prefix <key-prefix>] [--dry-run]`
      );
      process.exit(0);
    }
  }

  return { prefix, dryRun };
}

async function main() {
  loadEnvLocal();

  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Error: ${key} is not set. Configure it in .env.local or the environment.`);
      process.exit(1);
    }
  }

  const { prefix, dryRun } = parseArgs(process.argv.slice(2));
  const bucket = process.env.R2_BUCKET_NAME;
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const uploads = [];
  let keyMarker;
  let uploadIdMarker;

  for (;;) {
    const response = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        Prefix: prefix || undefined,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      })
    );

    for (const upload of response.Uploads ?? []) {
      if (upload.Key && upload.UploadId) {
        uploads.push({ key: upload.Key, uploadId: upload.UploadId, initiated: upload.Initiated });
      }
    }

    if (!response.IsTruncated) break;

    keyMarker = response.NextKeyMarker;
    uploadIdMarker = response.NextUploadIdMarker;
  }

  if (uploads.length === 0) {
    console.log(
      prefix
        ? `No incomplete multipart uploads found under prefix "${prefix}" in bucket "${bucket}".`
        : `No incomplete multipart uploads found in bucket "${bucket}".`
    );
    return;
  }

  console.log(`Found ${uploads.length} incomplete multipart upload(s) in "${bucket}":`);
  for (const upload of uploads) {
    console.log(`  - ${upload.key} (uploadId=${upload.uploadId})`);
  }

  if (dryRun) {
    console.log('Dry run only — nothing aborted.');
    return;
  }

  let aborted = 0;
  for (const upload of uploads) {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: upload.key,
        UploadId: upload.uploadId,
      })
    );
    aborted += 1;
    console.log(`Aborted: ${upload.key}`);
  }

  console.log(`Done. Aborted ${aborted} multipart upload(s). Refresh the R2 dashboard to confirm.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
