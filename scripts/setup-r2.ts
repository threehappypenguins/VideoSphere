/**
 * VideoSphere — R2 bucket setup script
 *
 * Configures the Cloudflare R2 bucket with the CORS rules required for
 * direct browser-to-R2 uploads via presigned PUT URLs.
 *
 * Without CORS, the browser's XHR preflight (OPTIONS) request is rejected
 * by R2, and the upload fails with a "network error" before any data is sent.
 *
 * Run after .env.local is configured:
 *   pnpm run setup:r2
 *
 * Required env vars (same as the main app):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *
 * NOTE: PutBucketCors requires an R2 API token with "Admin Read & Write"
 * permissions (not just "Object Read & Write"). If you see "Access Denied",
 * create a new R2 token with admin permissions in the Cloudflare Dashboard:
 *   Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token
 *   Permissions: Admin Read & Write → your bucket
 * Then temporarily replace R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in
 * .env.local, run this script, then switch back to your object-level token.
 *
 * Alternatively, configure CORS manually in the Cloudflare Dashboard:
 *   Dashboard → R2 → <your bucket> → Settings → CORS policy
 *   Use the JSON rules printed at the bottom of this script's output.
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
config({ path: resolve(root, '.env.local') });

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;

function log(msg: string) {
  console.log('[setup-r2]', msg);
}

const CORS_RULES = [
  {
    AllowedOrigins: [process.env.R2_ALLOWED_ORIGIN ?? '*'],
    AllowedMethods: ['GET', 'PUT', 'DELETE', 'HEAD'] as ('GET' | 'PUT' | 'DELETE' | 'HEAD')[],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  },
];

const MANUAL_CORS_JSON = JSON.stringify(
  {
    cors_rules: CORS_RULES.map((r) => ({
      allowed_origins: r.AllowedOrigins,
      allowed_methods: r.AllowedMethods,
      allowed_headers: r.AllowedHeaders,
      expose_headers: r.ExposeHeaders,
      max_age_seconds: r.MaxAgeSeconds,
    })),
  },
  null,
  2
);

if (!accountId || !accessKeyId || !secretKey || !bucketName) {
  console.error(
    '[setup-r2] Missing required env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME'
  );
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey: secretKey },
});

async function checkExistingCors(): Promise<boolean> {
  try {
    const res = await client.send(new GetBucketCorsCommand({ Bucket: bucketName! }));
    return (res.CORSRules?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function main() {
  log(`Configuring R2 bucket: ${bucketName}`);
  log(`Account:               ${accountId}`);

  const alreadyConfigured = await checkExistingCors();
  if (alreadyConfigured) {
    log('CORS rules already present — overwriting with updated rules.');
  }

  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucketName!,
        CORSConfiguration: { CORSRules: CORS_RULES },
      })
    );

    log('✓ CORS configured successfully!');
    log('');
    log('The R2 bucket now allows cross-origin PUT requests from the configured origin.');
    log(
      `Allowed origin: ${process.env.R2_ALLOWED_ORIGIN ?? '*'} (set R2_ALLOWED_ORIGIN in .env.local to restrict in production).`
    );
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };

    if (e.name === 'AccessDenied') {
      console.error('[setup-r2] ✗ Access Denied — the current API token lacks admin permissions.');
      console.error('');
      console.error('To fix this, choose one of:');
      console.error('');
      console.error('Option A — Create an admin R2 API token:');
      console.error('  1. Cloudflare Dashboard → R2 → Manage R2 API Tokens');
      console.error('  2. Create API Token → Admin Read & Write → your bucket');
      console.error('  3. Temporarily set R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in');
      console.error('     .env.local to the new admin token values');
      console.error('  4. Run: pnpm run setup:r2');
      console.error('  5. Restore your object-level token in .env.local');
      console.error('');
      console.error('Option B — Configure CORS manually in the Cloudflare Dashboard:');
      console.error('  1. Dashboard → R2 → <your bucket> → Settings → CORS policy');
      console.error('  2. Paste the following JSON and save:');
      console.error('');
      console.error(MANUAL_CORS_JSON);
      process.exit(1);
    }

    console.error('[setup-r2] ✗ Unexpected error:', e.message ?? err);
    process.exit(1);
  }
}

main();
