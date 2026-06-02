# Password Recovery

VideoSphere is designed for homelab and self-hosted deployments where SMTP is not required. Password recovery uses shell access, server logs, or admin-generated reset links instead of email.

## If the admin is locked out (shell access)

Use the CLI reset script when you have shell access to the host or container.

```bash
docker exec -it videosphere node scripts/reset-admin-password.js
```

To target a specific account instead of the first admin:

```bash
docker exec -it videosphere node scripts/reset-admin-password.js --email admin@example.com
```

The script:

- Reads `MONGODB_URI` from the environment (or `.env.local` when run locally)
- Prompts for a new password interactively (input is not echoed and is never passed as a CLI argument)
- Requires at least 8 characters
- Updates `passwordHash` in MongoDB

Example success output:

```text
✅ Password updated for admin@example.com (admin).
You can now log in with the new password.
```

For local development without Docker:

```bash
node scripts/reset-admin-password.js
```

## If the admin is locked out (UI / no direct DB access)

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

## Security notes

- Reset tokens are cryptographically random, single-use, and short-lived. Only a SHA-256 hash of each token is stored in MongoDB.
- The forgot-password API returns `{ ok: true }` for every well-formed email without revealing account existence; malformed requests receive 400 validation errors. Tokens appear in server logs only.
- **Google OAuth-only accounts cannot use password reset.** They have no local password; use Google sign-in instead. Admin reset links, forgot-password log tokens, and the CLI script all refuse OAuth-only accounts.
- The CLI script requires host- or container-level access and updates passwords directly in MongoDB.
- Using a reset link invalidates any other pending reset tokens for that user.
- Choose strong passwords (minimum 8 characters with mixed character types; common passwords like `password` are rejected).

## Related pages

- Login: `/login`
- Forgot password: `/forgot-password`
- Reset password: `/reset-password?token=…`
