# Stripe Webhook Testing Guide

This guide explains how to test the Stripe webhook integration locally using **Stripe CLI**.

## Overview

When a user completes a payment via Stripe Checkout, Stripe sends a webhook event (`checkout.session.completed`) to your application. The webhook handler verifies the event signature and updates the user's `isSupporter` status in Appwrite.

**Local Testing:** Use Stripe CLI to simulate webhook events without needing a public domain.
**Production:** Once deployed, register a permanent webhook endpoint in the Stripe Dashboard.

---

## Prerequisites

- Stripe CLI installed on your **host machine** (not inside the Docker container)
- A Stripe test account with API keys in `.env.local`:
  - `STRIPE_SECRET_KEY=sk_test_...`
  - `STRIPE_WEBHOOK_SECRET` (initially empty, will be set during testing)

## Installation

Choose your operating system below:

### Install Stripe CLI (Ubuntu/Debian)

```bash
# Add Stripe's GPG key
curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg

# Add Stripe's repository
echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/apt focal main" | sudo tee -a /etc/apt/sources.list.d/stripe.list

# Update and install
sudo apt update
sudo apt install stripe
```

### Install Stripe CLI (Windows)

#### Option 1: Using Scoop (Recommended)

If you have [Scoop](https://scoop.sh/) installed:

```powershell
scoop install stripe
```

#### Option 2: Using Chocolatey

If you have [Chocolatey](https://chocolatey.org/) installed:

```powershell
choco install stripe
```

#### Option 3: Manual Installation

1. Download the latest Windows binary from [Stripe CLI Releases](https://github.com/stripe/stripe-cli/releases)
2. Click the download link for `stripe_windows_x86_64.zip` (or `stripe_windows_arm64.zip` for ARM processors)
3. Extract the ZIP file to a folder (e.g., `C:\stripe`)
4. Add the folder to your system PATH:
   - Press `Win + X` and select **System**
   - Click **Advanced system settings** → **Environment Variables**
   - Under **System variables**, select **Path** and click **Edit**
   - Click **New** and add `C:\stripe` (or wherever you extracted it)
   - Click **OK** and restart PowerShell/CMD
5. Verify installation by opening a new PowerShell/CMD window and running:
   ```powershell
   stripe version
   ```

### Install Stripe CLI (macOS)

#### Using Homebrew (Recommended)

```bash
brew install stripe/stripe-cli/stripe
```

#### Using MacPorts

```bash
sudo port install stripe
```

### Verify Installation

On any operating system, verify the installation:

```bash
stripe version
# Output: stripe version 1.37.8 (or newer)
```

---

## Setup & Testing

### Step 1: Authenticate with Stripe

In your **host terminal** (NOT inside VS Code), run:

```bash
stripe login
```

This opens a browser window where you'll authenticate with your Stripe account. Once authorized, Stripe CLI stores credentials locally on your machine.

### Step 2: Start the Webhook Listener

In your **host terminal**, run:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

**Output:**
```
Ready! You are using Stripe API Version [2026-02-25.clover].
Your webhook signing secret is: whsec_test_3iXx...
```

**Keep this terminal open.** It will:
- Listen for all Stripe events
- Forward them to your local endpoint (`localhost:3000/api/webhooks/stripe`)
- Display each event received and whether it was successfully delivered

### Step 3: Copy the Webhook Secret

From the output above, **copy the `whsec_test_...` secret** and add it to `.env.local`:

```bash
STRIPE_WEBHOOK_SECRET=whsec_test_3iXx...
```

### Step 4: Restart Your Dev Server

In **VS Code's integrated terminal**, restart your dev server so it picks up the new environment variable:

```bash
pnpm dev
```

You should see:
```
- Ready in 1.2s
```

### Step 5: Trigger a Test Webhook

In a **third terminal** (or a new host terminal tab), trigger a `checkout.session.completed` event:

```bash
stripe trigger checkout.session.completed
```

**Output:**
```
Setting up fixture for: product
Setting up fixture for: price
Setting up fixture for: checkout_session
...
Trigger succeeded! Check dashboard for event details.
```

### Step 6: Verify the Webhook Was Processed

Check three places:

1. **Stripe Listener Terminal** - Should show:
   ```
   2026-03-18 19:45:23   --> checkout.session.completed [evt_3Jx...]
   2026-03-18 19:45:23   <-- [200] POST http://localhost:3000/api/webhooks/stripe
   ```

2. **Dev Server Terminal** (`pnpm dev`) - Should show:
   ```
   [POST /api/webhooks/stripe] Received event type: checkout.session.completed
   [POST /api/webhooks/stripe] checkout.session.completed: Set isSupporter=true for userId=user_xxx
   ```

3. **Appwrite Console** - Check if the test user's `isSupporter` field was updated to `true` in the `user_profiles` collection.

---

## Important Notes

### Webhook Signing Secret is Temporary

Each time you run `stripe listen`, you get a **new** temporary signing secret. This is only valid while the listener is running.

**Do NOT use these temporary secrets in production.** They're for local testing only.

**Workflow:**
1. Stop listener (Ctrl+C)
2. All webhooks for the old secret are rejected ❌
3. Restart listener
4. Get a **new** secret
5. Update `.env.local` with the new secret
6. Restart `pnpm dev`

### Permanent Webhooks (Production)

Once deployed to a domain:

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Enter your domain: `https://yourdomain.com/api/webhooks/stripe`
4. Select event: `checkout.session.completed`
5. Create endpoint
6. Copy the **permanent** signing secret (`whsec_live_...` or `whsec_...`)
7. Add to production `.env` or secrets manager
8. Never use test secrets in production

---

## Common Issues

### "command not found: stripe"

**Cause:** Stripe CLI is not installed or not in your PATH.

**Solution:**
```bash
# Verify installation
which stripe

# If not found, reinstall:
sudo apt install stripe

# If still not found, verify it's in /usr/bin:
ls -la /usr/bin/stripe
```

### Webhook Returns 400 (Bad Signature)

**Cause:** The `STRIPE_WEBHOOK_SECRET` is missing or incorrect.

**Check:**
1. Verify `.env.local` has the secret from `stripe listen` output
2. Restart `pnpm dev` to pick up the new env var
3. Make sure the secret matches exactly (copy-paste carefully)

### Webhook Returns 403 (Secret Not Configured)

**Cause:** `STRIPE_WEBHOOK_SECRET` is not set in `.env.local`.

**Solution:**
1. Copy the `whsec_test_...` from `stripe listen` output
2. Add to `.env.local`: `STRIPE_WEBHOOK_SECRET=whsec_test_...`
3. Restart `pnpm dev`

### Listener Shows Event But Dev Server Has No Logs

**Cause:** The dev server didn't pick up the environment variable.

**Solution:**
1. Stop `pnpm dev` (Ctrl+C)
2. Confirm `.env.local` has `STRIPE_WEBHOOK_SECRET=whsec_test_...`
3. Clear the `.next` cache: `rm -rf .next`
4. Restart `pnpm dev`
5. Trigger the webhook again

---

## Testing the Full Checkout Flow

To test end-to-end (checkout creation + webhook):

### Option 1: Via Browser (Recommended)

1. Start `pnpm dev` and `stripe listen` (as above)
2. Navigate to your pricing page: `http://localhost:3000/pricing`
3. Click **Upgrade to Supporter**
4. You're redirected to Stripe Checkout
5. Use test card: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., `12/25`)
   - CVC: Any 3 digits (e.g., `123`)
6. Click **Pay**
7. On success, you're redirected to `/profile?upgrade=success`
8. Check webhook logs (both terminals)
9. Verify user `isSupporter` was set to `true` in Appwrite

### Option 2: Via API (For Automation)

```bash
# 1. Get an authenticated session cookie (manual step with browser login first)
# 2. Call POST /api/payments/checkout
curl -X POST http://localhost:3000/api/payments/checkout \
  -H "Cookie: a_session_YOUR_PROJECT_ID=YOUR_SESSION" \
  -H "Content-Type: application/json"

# 3. Open the returned checkout URL in a browser
# 4. Complete payment with test card
# 5. Check webhook logs
```

---

## Summary

| Step | Terminal | Command |
|------|----------|---------|
| 1 | Host | `stripe login` |
| 2 | Host | `stripe listen --forward-to localhost:3000/api/webhooks/stripe` |
| 3 | Editor | Update `.env.local` with `STRIPE_WEBHOOK_SECRET` |
| 4 | VS Code | `pnpm dev` |
| 5 | Host (new tab) | `stripe trigger checkout.session.completed` |
| 6 | Check | Verify logs in all three places |

When you restart `stripe listen`, repeat steps 2-4.

---

## References

- [Stripe CLI Documentation](https://stripe.com/docs/stripe-cli)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
- [Stripe Test Mode Cards](https://stripe.com/docs/testing)
