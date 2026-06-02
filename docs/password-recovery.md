# Password Recovery

VideoSphere is designed for homelab and self-hosted deployments where SMTP is not required. Password recovery uses shell access, server logs, admin-generated reset links, or a CLI tool instead of email.

## Reset a password from the shell (CLI)

Use `scripts/reset-admin-password.js` when you have shell or container access and want to set a new password directly in MongoDB—without a reset link or SMTP. This works for any account that supports password login, not only admins.

```bash
docker exec -it videosphere node scripts/reset-admin-password.js
```

With no arguments, the script targets the **first admin** account (by `createdAt`). That default is convenient when the initial admin is locked out; use `--email` to reset a specific account instead:

```bash
docker exec -it videosphere node scripts/reset-admin-password.js --email user@example.com
```

The script:

- Reads `MONGODB_URI` from the environment (or `.env.local` when run locally)
- Prompts for a new password interactively (input is not echoed and is never passed as a CLI argument)
- Applies the same password rules as registration and the reset-password page (minimum length, strength, common-password denylist)
- Refuses Google OAuth-only accounts (no local password to set)
- Updates `passwordHash` in MongoDB

Example success output:

```text
✅ Password updated for user@example.com (user).
You can now log in with the new password.
```

For local development without Docker:

```bash
node scripts/reset-admin-password.js
node scripts/reset-admin-password.js --email user@example.com
```

## Forgot password (UI / log-based token)

Use the **Forgot password?** link on the login page.

1. Open `/forgot-password` and submit the account email.
2. After a valid submission, the UI shows a generic confirmation message — it does not reveal whether the email exists.
3. Malformed submissions (invalid email format, etc.) show a validation error instead.
4. When the email matches a registered password-capable user, the reset URL is written to **container stdout only** (never returned in the HTTP response).

Retrieve the token from Docker logs:

```bash
docker logs videosphere | grep "PASSWORD RESET TOKEN"
```

Example log line:

```text
⚠️  PASSWORD RESET TOKEN for admin@example.com — expires in 15 min
URL: http://localhost:3000/reset-password?token=<token>
```

Open the URL, set a new password, and log in. Forgot-password tokens expire in **15 minutes** and are **single-use**.

Rate limiting: at most **3** forgot-password requests per account per 15 minutes.

## Resetting another user's password (admin)

From **Dashboard → Users**, click **Reset Password** on any user row (including other admins).

The app opens a modal with:

- The full reset URL in a read-only field
- A **Copy to clipboard** button
- A note that the link expires in 24 hours and can only be used once

The modal stays open until you dismiss it explicitly so the URL is not lost.

Admin-generated links use the same `/reset-password?token=…` page as the forgot-password flow, but expire in **24 hours** instead of 15 minutes.

Send the link to the user through your own channel (chat, in person, etc.).

## Reset completion: why not MongoDB transactions?

**Do not replace this flow with `session.withTransaction()` unless the deployment runs MongoDB as a replica set (or sharded cluster).** The default homelab stack does not meet that requirement.

| Topic | Detail |
| --- | --- |
| **MongoDB constraint** | [Multi-document transactions](https://www.mongodb.com/docs/manual/core/transactions/) are supported on **replica sets and sharded clusters only**. **Standalone** deployments (including the default `mongo:8` service in `docker-compose.yml`, with no `--replSet` / `rs.initiate()`) **do not** support them. |
| **What broke before** | An earlier implementation claimed the token inside a transaction, then updated the password. That was correct for atomicity but **failed at runtime on standalone** with a transaction-related error, breaking forgot-password and admin reset. |
| **Intentional fix** | `completePasswordResetWithPasswordHash` (see `lib/repositories/password-reset-tokens.ts`) runs **without** multi-document transactions: validate token → **write password hash** → **atomically claim** token (`findOneAndUpdate`) → invalidate other pending tokens for the user. Claiming stays a single atomic write; only cross-collection steps are ordered instead of transactional. |
| **Primary guarantee** | If the password update throws (profile missing, transient DB error), the token is **not** claimed and the same link can be retried. |
| **Accepted trade-off** | If the password update succeeds but claim fails (concurrent use of the same link, expiry in a narrow window), the API may return failure while the password is already changed; the user can log in with the new password. Sibling-token invalidation is skipped when claim fails. This is rare and preferable to requiring a replica set for homelab installs. |
| **If you need full ACID across collections** | Run MongoDB as a replica set (or shard) and only then consider wrapping the same steps in a transaction; that is an **ops/deployment** change, not something this repo’s default Compose file provides. |

## Security notes

- Reset tokens are cryptographically random, single-use, and short-lived. Only a SHA-256 hash of each token is stored in MongoDB.
- Reset links in logs and the admin modal use **`NEXT_PUBLIC_APP_URL`** only (not the request `Host` header). Set it to your public URL in `.env.local` / Docker env so links work behind TLS and stay trustworthy.
- The forgot-password API returns `{ ok: true }` for every well-formed email without revealing account existence; malformed requests receive 400 validation errors. Tokens appear in server logs only.
- **Google OAuth-only accounts cannot use password reset.** They have no local password; use Google sign-in instead. Admin reset links, forgot-password log tokens, and the CLI script all refuse OAuth-only accounts.
- The CLI script requires host- or container-level access and updates passwords directly in MongoDB.
- Using a reset link invalidates any other pending reset tokens for that user.
- Reset completion uses **password write → token claim → sibling invalidation** without multi-document transactions; see [Reset completion: why not MongoDB transactions?](#reset-completion-why-not-mongodb-transactions) above.
- Choose strong passwords (minimum 8 characters with mixed character types; common passwords like `password` are rejected).

## Related pages

- Login: `/login`
- Forgot password: `/forgot-password`
- Reset password: `/reset-password?token=…`
