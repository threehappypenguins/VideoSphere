# Draft `document` JSON, platform upload `document`, and manual upload testing

This guide covers:

1. How **Appwrite** stores draft and platform-upload payloads in the **`document`** column (stringified JSON).
2. The **draft JSON shape** for frontend and API use, with a **short** sample for quick tests and a **long** sample for full UI wiring.
3. **Field reference** (YouTube / Vimeo / OAuth).
4. **End-to-end manual steps**: presign → PUT to R2 with `curl` → complete → distribute.

Canonical TypeScript types live in [`types/index.ts`](../types/index.ts) (`Draft`, `DraftPlatforms`, `YouTubeDraftFields`, `VimeoDraftFields`). Parsing and merge helpers live in [`lib/draft-upload-metadata.ts`](../lib/draft-upload-metadata.ts).

---

## `document` in Appwrite

### `drafts` table

- Each row includes a **`document`** column: a **single JSON string** (max length enforced by Appwrite column size).
- That string must deserialize to an object with at least:
  - **`targets`**: `["youtube"]`, `["vimeo"]`, or both (order preserved, deduped by the API when saving).
  - **`title`**, **`description`**, **`visibility`** (`public` | `unlisted` | `private`).
  - **`tags`**: string array — **one shared list** for every platform (not per-platform).
  - **`platforms`**: object with optional **`youtube`** and **`vimeo`** nested objects (platform-only fields).

The app’s draft APIs (`POST/PATCH /api/drafts`, `GET /api/drafts`, …) read and write this structure; the repository persists it as **`document`** on the `drafts` table.

### `platform_uploads` table

- Each row has a **`document`** column: JSON string snapshot **at distribution time**.
- Typical contents: `title`, `description`, `tags`, `visibility`, optional `categoryId` / `madeForKids` (YouTube), `vimeoCategoryUri`, and optional audit copies **`draftYoutube`** / **`draftVimeo`** (the `platforms.youtube` / `platforms.vimeo` slices from the draft when distribute ran).
- Purpose: debugging, support, and correlating what was sent to each platform without re-reading the draft.

See [`lib/platform-upload-document.ts`](../lib/platform-upload-document.ts) for the stored shape and size limit (`MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS`).

---

## Frontend: wiring the editor to the draft

1. **Load**: `GET /api/drafts` or `GET /api/drafts/[id]` returns a `Draft` with **`targets`**, **`title`**, **`description`**, **`tags`**, **`visibility`**, and **`platforms`** already parsed from `document` (you do not manually parse the Appwrite row in the client if you use these routes).
2. **Save**: `POST /api/drafts` or `PATCH /api/drafts/[id]` with a JSON body using the **same keys** as the stored document: `targets`, `title`, `description`, `visibility`, `tags`, `platforms` (partial updates on PATCH merge per server rules).
3. **Validate in UI** using the types in `types/index.ts` so `platforms.youtube` / `platforms.vimeo` stay consistent with the server.

---

## Short draft JSON (smoke / manual testing)

Use this when you only need minimal fields; adjust `draftId` in the upload flow to match a draft saved with this content.

```json
{
  "targets": ["youtube", "vimeo"],
  "title": "Example video title (max 100 chars for YouTube snippet)",
  "description": "Shared description for every platform. Can include links and longer copy.",
  "visibility": "private",
  "tags": ["example", "smoke-test", "multi-platform"],
  "platforms": {
    "youtube": {
      "categoryId": "22",
      "madeForKids": true
    },
    "vimeo": {
      "categoryUri": "/categories/animation"
    }
  }
}
```

---

## Long draft JSON (fuller frontend / API example)

Valid for `drafts.document` and for `POST /api/drafts` / `PATCH /api/drafts/[id]` bodies (with the usual required fields on POST). Omit any optional key you do not need.

```json
{
  "targets": ["youtube", "vimeo"],
  "title": "Example video title (max 100 chars for YouTube snippet)",
  "description": "Shared description for every platform. Can include links and longer copy.",
  "visibility": "private",
  "tags": ["example", "smoke-test", "multi-platform"],
  "platforms": {
    "youtube": {
      "categoryId": "22",
      "madeForKids": false,
      "defaultLanguage": "en",
      "defaultAudioLanguage": "en",
      "embeddable": true,
      "license": "youtube",
      "publicStatsViewable": true,
      "containsSyntheticMedia": false,
      "playlistTitles": ["Example playlist title"],
      "playlistIds": []
    },
    "vimeo": {
      "categoryUri": "/categories/animation",
      "license": "by",
      "locale": "en-US",
      "reviewPage": { "active": false },
      "privacy": {
        "comments": "anybody",
        "embed": "public",
        "add": true
      },
      "embed": {
        "playbar": true,
        "volume": true,
        "buttons": {
          "like": true,
          "share": true,
          "embed": true,
          "fullscreen": true,
          "hd": true,
          "watchlater": true,
          "scaling": true
        },
        "title": {
          "name": "user",
          "owner": "user",
          "portrait": "user"
        }
      }
    }
  }
}
```

---

## Field reference: `platforms.youtube`

Mapped to YouTube Data API v3 **`videos.insert`** resumable init (`part=snippet,status`) plus post-upload playlist steps.

| Field | Role |
|--------|------|
| `categoryId` | `snippet.categoryId` (e.g. `"22"` = People & Blogs; use [Google’s category list](https://developers.google.com/youtube/v3/docs/videoCategories/list)). |
| `madeForKids` | `status.selfDeclaredMadeForKids` |
| `defaultLanguage` | `snippet.defaultLanguage` (BCP-47, e.g. `en`) |
| `defaultAudioLanguage` | `snippet.defaultAudioLanguage` |
| `embeddable` | `status.embeddable` |
| `license` | `status.license`: `youtube` \| `creativeCommon` |
| `publicStatsViewable` | `status.publicStatsViewable` |
| `publishAt` | `status.publishAt` (ISO 8601). Usually used with `visibility` private until publish time. |
| `containsSyntheticMedia` | `status.containsSyntheticMedia` |
| `playlistTitles` | Playlist **titles** (`snippet.title`). Same idea as [porjo/youtubeuploader](https://github.com/porjo/youtubeuploader) `-metaJSON` `playlistTitles`. Server: [`playlists.list`](https://developers.google.com/youtube/v3/docs/playlists/list) (`mine=true`, paginated) → case-insensitive title match → else [`playlists.insert`](https://developers.google.com/youtube/v3/docs/playlists/insert) (privacy follows draft `visibility`) → [`playlistItems.insert`](https://developers.google.com/youtube/v3/docs/playlistItems/insert). Duplicate strings in the array are deduped case-insensitively (first wins). |
| `playlistIds` | Optional playlist **ids** from `playlist?list=…` in the URL; each gets `playlistItems.insert`. |

**Not implemented** (would need more API parts or endpoints): `recordingDetails`, `localizations`, thumbnails, captions, monetization, `liveStreamingDetails`, and post-upload-only `videos.update` fields.

---

## Field reference: `platforms.vimeo`

Sent on Vimeo **`POST /me/videos`** using **snake_case** on the wire where the API expects it (handled in [`lib/platforms/vimeo.ts`](../lib/platforms/vimeo.ts)).

| Field | Role |
|--------|------|
| `categoryUri` | Parsed into batch `[{ "category": "<slug>" }]` for `PUT …/videos/{id}/categories`. Use `/categories/animation`, slug `animation`, or a vimeo.com category URL — not a fake numeric path. |
| `license` | Creative Commons codes: `by` \| `by-nc` \| `by-nc-nd` \| `by-nc-sa` \| `by-nd` \| `by-sa` \| `cc0` |
| `locale` | e.g. `en-US` (see Vimeo `GET /languages?filter=texttracks`) |
| `contentRating` | Optional `string[]`; valid tokens from `GET https://api.vimeo.com/contentratings` |
| `password` | Required when `privacy.view` is `password` |
| `reviewPage` | `{ "active": true \| false }` → API `review_page` |
| `privacy` | Merged after mapping draft `visibility` → `privacy.view` (`anybody` \| `unlisted` \| `nobody`, etc.). Optional: `view`, `comments`, `embed`, `add`. **Do not set `download`: `false`** — Vimeo often rejects `privacy.download` on create (e.g. HTTP 2204) even when `false`. Omit `download` unless you need it; we do not send `privacy.download` on Vimeo video **create** in this app. |
| `embed` | Player chrome: `playbar`, `volume`, `buttons.*`, `title.name` \| `owner` \| `portrait`: `hide` \| `show` \| `user` |

**Not implemented**: spatial/360 payloads, full embed logos/color, showcase/folder membership, custom domain whitelist bodies.

---

## OAuth scopes (YouTube)

Connect flow: [`app/api/platforms/connect/youtube/route.ts`](../app/api/platforms/connect/youtube/route.ts).

Requested scopes (space-separated in the consent URL):

- `https://www.googleapis.com/auth/youtube.upload` — resumable upload (`videos.insert`); **does not** cover `playlists.insert` by itself.
- `https://www.googleapis.com/auth/youtube.readonly` — channel info; playlist listing.
- `https://www.googleapis.com/auth/youtube.force-ssl` — listed for various write operations.
- `https://www.googleapis.com/auth/youtube` — broad account management, including **`playlists.insert`** (avoids `insufficientPermissions` when creating playlists by title).

If playlist creation fails with **`insufficientPermissions`**, disconnect and reconnect YouTube after scope changes so the stored refresh token was issued with the current consent.

Vimeo: connect still requires upload + edit-related scopes for tags/categories (see Vimeo connect route).

---

## Manual testing: presign → R2 → complete → distribute

**Prerequisites**

- Dev server running (`pnpm dev`) and you are **logged in** in the browser (session cookie sent with `fetch`).
- A draft row whose **`document`** matches one of the JSON samples above; note its **`draftId`** (Appwrite `$id` / API `id`).

### 1. Presign (browser DevTools → Console)

Set variables, then run:

```javascript
const draftId = 'YOUR_DRAFT_ID';
const fileName = 'my-video.mp4';
const contentType = 'video/mp4';
const fileSize = 217281388; // actual bytes of the file you will upload

const p = await fetch('/api/uploads/presign', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ draftId, fileName, contentType, fileSize }),
}).then((r) => r.json());

p;
```

The last line prints **`p`**, which should include:

- **`uploadUrl`** — presigned **PUT** URL (expires, typically 15 minutes).
- **`key`** — R2 object key (pass to distribute as `r2ObjectKey`).
- **`uploadJobId`** — upload job id for **complete**.

**Copying `uploadUrl` for curl**

- After `p` is printed, expand the object in the console.
- **Option A:** Right‑click the **`uploadUrl`** property → **Copy string value** (wording varies by browser).
- **Option B:** Right‑click the logged object → **Copy object** (or store `copy(p)` if you use a helper), paste into a text editor, and copy the **`uploadUrl`** string (including `https://…`) for step 2.

Replace `YOUR_PRESIGNED_URL_FROM_DEVTOOLS` below with that full URL.

### 2. Upload file to R2 (terminal)

Use the **same** `Content-Type` you sent to presign (`video/mp4` in the example):

```bash
curl -v "YOUR_PRESIGNED_URL_FROM_DEVTOOLS" \
  -H "content-type: video/mp4" \
  --upload-file /path/to/my-video.mp4
```

Wait for a successful response (HTTP 200 from R2).

### 3. Complete the upload job (browser console)

Uses **`p.uploadJobId`** from step 1:

```javascript
await fetch(`/api/uploads/${p.uploadJobId}/complete`, { method: 'POST' }).then((r) =>
  r.json()
);
```

### 4. Distribute (browser console)

Uses **`draftId`**, **`p.key`**, and the platforms you want (subset of draft `targets` is allowed per API rules):

```javascript
const d = await fetch('/api/uploads/distribute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    draftId,
    r2ObjectKey: p.key,
    platforms: ['youtube', 'vimeo'],
  }),
}).then((r) => r.json());

d;
```

You should get **`202`** with a **`jobId`** while distribution runs asynchronously. Check platform upload rows and logs if a platform fails.

---

## Related code

| Area | Location |
|------|-----------|
| Draft `document` parse / merge | `lib/draft-upload-metadata.ts` |
| Platform upload `document` | `lib/platform-upload-document.ts` |
| Presign | `app/api/uploads/presign/route.ts` |
| Complete | `app/api/uploads/[jobId]/complete/route.ts` |
| Distribute | `app/api/uploads/distribute/route.ts` |
| YouTube upload + playlists | `lib/platforms/youtube.ts` |
| Vimeo upload | `lib/platforms/vimeo.ts` |
| Appwrite schema notes | `docs/appwrite-databases.md` |
