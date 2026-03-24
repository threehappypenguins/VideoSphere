# Draft Wizard Component Integration Guide

## Overview

The `DraftWizard` component implements Issue #76 — a multi-step guided flow for creating and uploading new video drafts with platform selection, metadata entry, AI-assisted metadata generation, and direct-to-Cloudflare R2 video upload.

## Features

- **Step 1: Platform Selection**
  - Displays connected platforms as selectable cards
  - Shows disabled cards with "Connect" links for unconnected platforms
  - Visual highlighting for selected platforms
  - "Next" button disabled until at least one platform is selected

- **Step 2: Metadata & AI Generation**
  - AI prompt text bar with "Generate with AI" button
  - Loading skeletons while waiting for AI response
  - Editable form fields (title, description, tags)
  - Error handling with toast notifications
  - Visibility selector per platform
  - Character count indicators with platform-specific limits
  - Real-time validation for title length

- **Step 3: Upload Video**
  - Drag-and-drop zone for video files
  - "Select Video File" button with file picker
  - Supported formats: MP4, MOV, AVI, MKV, WebM (up to 5 GB)
  - Real-time upload progress bar
  - Direct browser-to-R2 upload via presigned URLs
  - File validation (MIME type + extension + size)
  - Visual feedback: filename, file size, upload percentage

- **Navigation & State Management**
  - Step indicator showing "Step X of 3"
  - "Back" button returns to previous step with state preserved
  - "Save Draft" on Step 2 saves metadata without uploading; redirects to draft page
  - "Next: Upload Video" on Step 2 saves draft and advances to Step 3
  - "Upload Video" on Step 3 triggers presign → R2 PUT → complete workflow
  - Confirmation dialog on dismissal if any fields are dirty
  - Inline validation errors

## Installation

### 1. Ensure Dependencies Are Installed

The component uses shadcn/ui components. Make sure you have these in your project:

```bash
npx shadcn-ui@latest add dialog
npx shadcn-ui@latest add button
npx shadcn-ui@latest add input
npx shadcn-ui@latest add textarea
npx shadcn-ui@latest add label
npx shadcn-ui@latest add card
npx shadcn-ui@latest add badge
npx shadcn-ui@latest add select
npx shadcn-ui@latest add alert-dialog
npx shadcn-ui@latest add progress
npx shadcn-ui@latest add sonner
```

### 2. Import the Components

```typescript
import { DraftWizard } from '@/components/DraftWizard';
import { useDraftWizard } from '@/hooks/use-draft-wizard';
```

## Usage Example

### Basic Usage - Dashboard Page

Here's how to integrate the wizard on `/app/(dashboard)/drafts/page.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { DraftWizard } from '@/components/DraftWizard';
import { useDraftWizard } from '@/hooks/use-draft-wizard';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function DraftsPage() {
  const { isOpen, openWizard, closeWizard } = useDraftWizard();
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDrafts = async () => {
      try {
        const response = await fetch('/api/drafts');
        if (response.ok) {
          const data = await response.json();
          setDrafts(data.data || []);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchDrafts();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">My Drafts</h1>
        <Button onClick={openWizard} size="lg">
          + New Draft
        </Button>
      </div>

      {loading ? (
        <p>Loading drafts...</p>
      ) : drafts.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-gray-600">No drafts yet. Create one to get started!</p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {drafts.map((draft) => (
            <Card key={draft.id} className="p-4">
              <h3 className="font-semibold">{draft.title}</h3>
              <p className="text-sm text-gray-600">{draft.description}</p>
            </Card>
          ))}
        </div>
      )}

      <DraftWizard isOpen={isOpen} onClose={closeWizard} />
    </div>
  );
}
```

## Component Props

```typescript
interface DraftWizardProps {
  /** Whether the wizard dialog is open */
  isOpen: boolean;
  
  /** Callback fired when the wizard should close (user clicks cancel or successfully saves) */
  onClose: () => void;
}
```

## Hook Usage

The `useDraftWizard` hook provides a simple state management interface:

```typescript
const { isOpen, openWizard, closeWizard } = useDraftWizard();
```

### Hook Methods

- **`openWizard()`** — Opens the wizard dialog
- **`closeWizard()`** — Closes the wizard dialog and resets internal state
- **`isOpen`** — Boolean state of the dialog

## API Dependencies

The component makes requests to the following endpoints:

### 1. `GET /api/platforms/connections`

**Response:**
```json
{
  "data": [
    {
      "id": "acc_123",
      "platform": "youtube",
      "platformName": "My Channel"
    },
    {
      "id": "acc_456",
      "platform": "vimeo",
      "platformName": "My Videos"
    }
  ]
}
```

### 2. `POST /api/ai/generate`

**Request:**
```json
{
  "prompt": "A tutorial on making coffee",
  "platforms": ["youtube", "vimeo"]
}
```

**Response:**
```json
{
  "data": {
    "title": "How to Make Perfect Coffee at Home",
    "description": "Learn the best techniques for brewing coffee...",
    "tags": ["coffee", "tutorial", "diy", "home-brewing"]
  }
}
```

### 3. `POST /api/drafts`

**Request:**
```json
{
  "title": "My Video Title",
  "description": "Video description...",
  "tags": ["tag1", "tag2"],
  "targets": ["youtube", "vimeo"],
  "visibility": "public",
  "platforms": {
    "youtube": {
      "visibility": "public"
    },
    "vimeo": {
      "visibility": "public"
    }
  }
}
```

**Response:**
```json
{
  "data": {
    "id": "draft_789",
    "userId": "user_123",
    "title": "My Video Title",
    "description": "Video description...",
    "tags": ["tag1", "tag2"],
    "targets": ["youtube", "vimeo"],
    "visibility": "public",
    "platforms": { ... },
    "$createdAt": "2026-03-23T10:30:00Z",
    "$updatedAt": "2026-03-23T10:30:00Z"
  }
}
```

### 4. `POST /api/uploads/presign`

**Request:**
```json
{
  "fileName": "my-video.mp4",
  "contentType": "video/mp4",
  "fileSize": 1073741824,
  "draftId": "draft_789"
}
```

**Response (200 OK):**
```json
{
  "uploadUrl": "https://r2-signed-url-expires-in-15-minutes.example.com/...",
  "key": "temp/uploads/user_123/1711273800000-abc123/my-video.mp4",
  "bucketName": "videosphere-staging",
  "expiresIn": 900,
  "uploadJobId": "job_456",
  "isSupporter": false
}
```

**Error Responses:**
- `400` — Missing/invalid fields, unsupported format, or file exceeds 5 GB
- `401` — Not authenticated
- `403` — Free-tier monthly upload quota reached or draft not owned by user
- `404` — Draft not found

### 5. `PUT` (Direct to R2)

Use the `uploadUrl` from presign response to PUT the file directly.

**Request Example:**
```bash
curl -X PUT "$uploadUrl" \
  -H "Content-Type: video/mp4" \
  -H "Content-Length: 1073741824" \
  --data-binary @my-video.mp4
```

The presigned URL enforces:
- Exact Content-Type match
- Exact Content-Length match (no streaming)
- 15-minute expiry

### 6. `POST /api/uploads/[jobId]/complete`

**Request:** (no body)
```json
{}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Details:**
- Verifies actual object size on R2 via HEAD request
- Confirms file does not exceed 5 GB (server-side enforcement layer 2)
- Deletes oversized files from R2
- Transitions upload job status from `pending` → `uploading`

**Error Responses:**
- `400` — Object exceeds 5 GB or object not found
- `401` — Not authenticated
- `403` — Upload job not owned by user
- `404` — Upload job not found
- `409` — Upload job not in `pending` state (already completed, distributing, or failed)

## Key Features Explained

### Platform Selection (Step 1)

- **Connected Platforms:** Rendered as interactive cards with checkboxes
- **Unconnected Platforms:** Shown as disabled cards with a "Connect" button that navigates to the connections page
- **Selection Validation:** "Next" button is disabled until at least one platform is selected
- **Visual Feedback:** Selected platforms have blue background and ring styling

### Metadata Entry (Step 2)

- **Title Field:** Required field with character count indicator based on selected platforms
  - YouTube: max 100 characters
  - Vimeo: max 128 characters
  - If selection spans platforms, uses the minimum limit
  - Over-limit titles are highlighted in red

- **Description Field:** Optional, max 5000 characters with live counter

- **Tags Field:** Comma-separated input, auto-trimmed and counted

- **Visibility Selector:** Per-platform dropdown with options:
  - Public
  - Unlisted
  - Private

### AI Metadata Generation

- **Trigger:** "Generate with AI" button in blue info box
- **Input:** Optional prompt from user describing the video
- **Loading State:** Shows "Generating..." with spinner; form fields disabled
- **Success:** Auto-populate title, description, and tags
- **Error:** Toast notification with "Failed to generate metadata"
- **Regenerate:** User can click the button again for a fresh suggestion

### State Preservation

- **Back Navigation:** "Back" button returns to previous step with most state intact (except file selection which is cleared)
- **Dirty Tracking:** Form detects any changes made by user
- **Confirmation Dialog:** If user tries to close or cancel with unsaved changes, shows: "Discard Changes? You have unsaved changes. Are you sure you want to close without saving?"
- **Draft Saved Before Upload:** Draft is persisted to database after Step 2 completes, so file upload is optional

### Video Upload (Step 3)

- **Drag-and-Drop Zone:** Full-height interactive area; highlights on dragover
- **Keyboard Accessible:** Standard file picker button; zone has `role="button"` with keyboard support
- **File Validation:**
  - MIME types checked: `video/mp4`, `video/quicktime`, `video/x-msvideo`, `video/x-matroska`, `video/webm`
  - Extensions checked: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`
  - File size: 0 → 5 GB (enforced client-side; server validates again)
- **Selected File Display:** Shows filename + human-readable file size (KB, MB, GB)
- **Upload Progress:**
  - Real-time progress bar via `XMLHttpRequest.upload`
  - Displays percentage (0–100%)
  - "Upload Video" button shows live percentage during transfer
  - Disabled until file selected
- **Upload Flow:**
  1. Step 2 → Step 3: Saves draft, stores `draftId` in state
  2. User selects video file
  3. Click "Upload Video" triggers:
     - `POST /api/uploads/presign` with draft metadata
     - `PUT` to presigned URL (direct R2)
     - `POST /api/uploads/[jobId]/complete` (server confirms)
  4. Success: Redirects to draft detail page at `/dashboard/drafts/[draftId]`
- **Error Handling:** Toast notifications for unsupported format, oversized file, upload failures

## Styling

The component uses Tailwind CSS and is designed to work with shadcn/ui theming. It respects your project's color scheme and dark mode settings.

### Key Classes Used

- `max-w-2xl` — Modal width constraint
- `max-h-[90vh]` — Modal height constraint with scrolling
- `ring-2 ring-blue-500` — Selected platform highlight
- `bg-blue-50` — AI section background
- `bg-amber-50` — Warning section background

## Error Handling

The wizard handles several error scenarios:

### Platform & Metadata Steps

1. **Failed to fetch connected accounts** → Toast: "Failed to load connected accounts"
2. **No platforms selected when clicking "Generate with AI"** → Toast: "Please select at least one platform first"
3. **AI generation failure** → Toast: "Failed to generate metadata. Please try again."
4. **Empty title on save** → Toast: "Title is required"
5. **Draft creation failure** → Toast: "Failed to save draft. Please try again."

### Upload Step

6. **Unsupported video format** → Toast: "Unsupported format. Accepted: MP4, MOV, AVI, MKV, WebM"
7. **File exceeds 5 GB** → Toast: "File exceeds the 5 GB maximum size"
8. **Failed to get presigned URL** → Toast: "Failed to get upload URL" + error details
9. **Network error during upload** → Toast: "Upload failed — network error"
10. **Server failed to confirm upload** → Toast: "Failed to confirm upload"
11. **Free-tier quota reached at presign time** → Toast: "Upload limit reached" + monthly usage info

## Accessibility

- All form inputs have associated labels (`<Label>` components)
- Buttons have proper `disabled` states
- Form validation provides clear error messages
- Loading states use spinner icons with text feedback
- Dialog is keyboard accessible via shadcn/ui Dialog
- AlertDialog for confirmations is accessible

## Performance Considerations

- Connected accounts are fetched only when the wizard opens
- AI generation is debounced via button click (no automatic triggers)
- Form state is managed efficiently with single `setState` call
- No unnecessary re-renders due to proper dependency arrays

## Known Limitations & Future Enhancements

1. **Per-platform metadata overrides** — Currently Step 2 shows only global visibility selector. Per-platform overrides (different titles/descriptions per platform) could be added as an expandable section (relates to Issue #50)

2. **Thumbnail upload** — Not included in this wizard (relates to Issue #51, requires file upload integration)

3. **Scheduled publishing** — No date/time picker for scheduling (relates to Issue #47)

4. **Distribution workflow** — This wizard creates and uploads drafts. Distribution to platforms happens later on the draft detail page (`/dashboard/drafts/[id]`) via the "Distribute" button (Issue #49)

## Testing the Component

### Manual Testing Checklist

#### Step 1: Platform Selection

- [ ] Open wizard by clicking "New Draft"
- [ ] All connected platforms visible as cards
- [ ] Unconnected platforms show "Not connected" warning
- [ ] Can toggle platforms on/off with click
- [ ] Selected platforms highlight in blue with checkmark
- [ ] "Next" button disabled when no platforms selected
- [ ] "Next" button enabled when 1+ platforms selected
- [ ] Step indicator shows "Step 1 of 3"

#### Step 2: Metadata & AI Generation

- [ ] Step indicator shows "Step 2 of 3"
- [ ] Shows selected platforms as badges
- [ ] "Back" returns to Step 1 with selections preserved
- [ ] Can type AI prompt and click "Generate with AI"
- [ ] Loading spinner shows during generation; form fields disabled
- [ ] Metadata auto-populates correctly (title, description, tags)
- [ ] Can edit all fields (title, description, tags)
- [ ] Title character count updates live
- [ ] Title turns red when exceeding limit
- [ ] Can select visibility per platform
- [ ] "Save Draft" button saves without uploading; redirects to draft page
- [ ] "Next: Upload Video" button saves draft and advances to Step 3
- [ ] Both buttons require non-empty title

#### Step 3: Upload Video

- [ ] Step indicator shows "Step 3 of 3"
- [ ] Drag-and-drop zone visible with Film icon
- [ ] Zone highlights blue when dragging file over it
- [ ] "Select Video File" button opens file picker
- [ ] File picker filters to video formats only
- [ ] Can select video file (MP4, MOV, AVI, MKV, WebM)
- [ ] Selected file shows in card with filename + size (KB/MB/GB)
- [ ] Can remove selected file via ✗ button
- [ ] Unsupported format shows error toast
- [ ] File exceeding 5 GB shows error toast
- [ ] "Upload Video" button disabled until file selected
- [ ] Click "Upload Video" shows live progress bar
- [ ] Progress bar shows percentage (0–100%)
- [ ] Button text updates: "Uploading X%..." → "Uploaded!"
- [ ] On success: Redirects to `/dashboard/drafts/[draftId]`
- [ ] On error: Toast shows error message; file remains selected for retry
- [ ] "Back" button clears file selection and returns to Step 2
- [ ] "Cancel" button on Step 1 closes wizard

#### State & Dismissal

- [ ] Close wizard without changes → no confirmation
- [ ] Close wizard with changes on Step 1/2 → shows confirmation dialog
- [ ] Confirm close → returns to drafts list; state reset
- [ ] Unsaved changes include: platform selection, metadata edits, file selection
- [ ] Saved draft (Step 2 complete) is persisted; can close safely after Step 2

## Related Issues & PRD References

- **Issue #76** — This component (New Draft Wizard — Multi-Step Modal/Page)
- **Issue #20** — Draft CRUD API (dependency)
- **Issue #21** — Draft Creation & Edit UI (foundation)
- **Issue #37** — AI Metadata Endpoint (dependency)
- **PRD DM-01 through DM-12** — Draft & Metadata Management requirements
- **PRD AI-01 through AI-03** — AI-Powered Metadata Generation

