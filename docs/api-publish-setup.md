# Auto-publish to the Chrome Web Store

This repo can fully auto-publish to the Chrome Web Store on every `git tag`. The first publish is a one-time setup; afterwards every tagged version goes live (after Google's review) without any clicks.

## One-time setup

### 1. Google Cloud project + OAuth client

1. Create a project: https://console.cloud.google.com/projectcreate (any name, e.g. `auto-unmute-publish`).
2. Enable the API: https://console.cloud.google.com/apis/library/chromewebstore.googleapis.com → **Enable**.
3. Configure the OAuth consent screen: https://console.cloud.google.com/apis/credentials/consent
   - User type: **External**
   - App name: `Auto Unmute Publisher`
   - Add your own Google account (the one that owns the Web Store developer account) under **Test users**
   - Leave it in "Testing" mode — that's fine.
4. Create credentials: https://console.cloud.google.com/apis/credentials → **Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Save the **client ID** and **client secret** somewhere temporarily.

### 2. Get a refresh token

From your local clone of this repo:

```bash
CLIENT_ID=<your-client-id> \
CLIENT_SECRET=<your-client-secret> \
node scripts/get-refresh-token.mjs
```

Your browser will open the Google consent screen. Sign in with the Google account that owns your Chrome Web Store developer account, accept (you'll see an "unverified app" warning — that's fine for a personal app, click **Advanced → Go to … (unsafe)**), and the script will print a refresh token in the terminal.

### 3. First-time item creation

The Web Store API can update an existing item but the very first item still needs an extension ID. Create it once:

```bash
# This uses the chrome-webstore-upload-cli's "insert" path:
npx chrome-webstore-upload-cli@3 upload \
  --source dist/auto_unmute-1.0.0.zip \
  --client-id <your-client-id> \
  --client-secret <your-client-secret> \
  --refresh-token <refresh-token>
```

It prints the new **extension ID** (32-char string). Save it.

> Alternative: upload `dist/auto_unmute-1.0.0.zip` once via the dashboard at https://chrome.google.com/webstore/devconsole — the extension ID then appears in the URL of the item's edit page. Either way works.

### 4. Fill the listing form (one time only)

Open the item in the dashboard: https://chrome.google.com/webstore/devconsole

Listing fields (description, screenshots, category, privacy policy URL, etc.) **cannot be set via API** — fill them in once. Copy/paste from `docs/store-listing.md`. After this, every API-driven update inherits these settings.

### 5. Add GitHub secrets

In this repo: **Settings → Secrets and variables → Actions → New repository secret**. Add four:

| Name | Value |
|---|---|
| `CWS_EXTENSION_ID` | The 32-char extension ID from step 3 |
| `CWS_CLIENT_ID` | OAuth client ID from step 1 |
| `CWS_CLIENT_SECRET` | OAuth client secret from step 1 |
| `CWS_REFRESH_TOKEN` | Refresh token from step 2 |

## Day-to-day publishing

Once the secrets are in place, every push of a `v*` tag will:

1. Build `dist/auto_unmute-<version>.zip`
2. Attach it to a GitHub Release
3. Upload it to the Chrome Web Store
4. Submit it for review

```bash
# bump manifest version, commit, then:
git tag v1.0.1
git push --tags
```

You can also trigger a publish manually without tagging via **Actions → Build & publish → Run workflow** with `publish: true`. Set `target: trustedTesters` to ship to your tester group instead of the public.

## Notes

- The `publish` workflow job is gated on the secrets existing — it'll skip with a warning if any are missing, so the build still works for forks.
- Refresh tokens issued by an OAuth app in **Testing** mode expire after 7 days. To avoid this, click **Publish App** on the OAuth consent screen → "In production". You don't need Google's verification for an internal-only token; the unverified-app warning only affects new sign-ins.
- The `chrome-webstore-upload-cli` package is the underlying tool ([docs](https://github.com/fregante/chrome-webstore-upload-cli)).
