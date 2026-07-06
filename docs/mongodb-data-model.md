# MongoDB Data Model

VideoSphere stores application data in MongoDB via Mongoose models in `lib/models/`.

## Collections

| Collection | Model | Purpose |
| ---------- | ----- | ------- |
| `user_profiles` | `UserProfile` | Accounts, roles, preferences |
| `drafts` | `Draft` | Upload metadata drafts (`document` JSON string) |
| `upload_jobs` | `UploadJob` | R2 staging upload jobs linked to drafts |
| `platform_uploads` | `PlatformUpload` | Per-platform distribution attempts and snapshots |
| `connected_accounts` | `ConnectedAccount` | OAuth tokens and backup credentials (encrypted) |
| `livestreams` | `Livestream` | Scheduled YouTube/Facebook livestream metadata |
| `youtube_import_jobs` | `YoutubeImportJob` | YouTube URL import jobs (yt-dlp → R2 → distribute) |
| `invites` | `InviteToken` | Admin invite tokens for signup |
| `password_reset_tokens` | `PasswordResetToken` | Password reset links |

## ID and Timestamp Conventions

- Document IDs are strings (`_id: String`) to match existing app-level IDs.
- Mongoose `timestamps: true` provides `createdAt` and `updatedAt`.
- Shared API/repository output continues to expose `$createdAt` and `$updatedAt` as ISO strings for compatibility.

## Draft and Platform Upload Document Payloads

- `drafts.document` stores JSON string payload for draft metadata.
- `platform_uploads.document` stores JSON snapshot captured at distribution time.

See [draft-document-and-upload-testing.md](./draft-document-and-upload-testing.md) for full payload shape and manual upload flow.

## Encryption at Rest for Connected Account Secrets

Connected account tokens, SFTP credentials, SMB credentials, and SermonAudio API keys are encrypted before persistence.

- Key env var: `TOKEN_ENCRYPTION_KEY`
- Algorithm: AES-256-GCM
- Implementation: [lib/crypto/token-encryption.ts](../lib/crypto/token-encryption.ts)

Supported `connected_accounts.platform` values:

| Platform | Connect method |
| -------- | -------------- |
| `youtube` | OAuth |
| `vimeo` | OAuth |
| `google_drive` | OAuth |
| `facebook` | OAuth (page/profile selection) |
| `sftp` | Form (host, user, key or password) |
| `smb` | Form (host, share, domain, credentials) |
| `sermon_audio` | Form (API key) |

## Migration Notes

If you are migrating existing datasets, keep the same string IDs and unique constraints used by the models so route/repository behavior remains unchanged.
