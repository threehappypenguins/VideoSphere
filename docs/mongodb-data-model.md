# MongoDB Data Model

VideoSphere stores application data in MongoDB via Mongoose models in [lib/models](../lib/models).

## Collections

- `user_profiles`
- `drafts`
- `upload_jobs`
- `platform_uploads`
- `connected_accounts`
- `upload_usage`
- `processed_webhook_events`

## ID and Timestamp Conventions

- Document IDs are strings (`_id: String`) to match existing app-level IDs.
- Mongoose `timestamps: true` provides `createdAt` and `updatedAt`.
- Shared API/repository output continues to expose `$createdAt` and `$updatedAt` as ISO strings for compatibility.

## Draft and Platform Upload Document Payloads

- `drafts.document` stores JSON string payload for draft metadata.
- `platform_uploads.document` stores JSON snapshot captured at distribution time.

See [docs/draft-document-and-upload-testing.md](/draft-document-and-upload-testing) for full payload shape and manual upload flow.

## Encryption at Rest for OAuth Tokens

Connected account tokens are encrypted before persistence.

- Key env var: `TOKEN_ENCRYPTION_KEY`
- Algorithm: AES-256-GCM
- Implementation: [lib/crypto/token-encryption.ts](../lib/crypto/token-encryption.ts)

## Migration Notes

If you are migrating existing datasets, keep the same string IDs and unique constraints used by the models so route/repository behavior remains unchanged.
