'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB
const FREE_TIER_LIMIT = 10;

const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
]);

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
}

function validateFile(file: File): string | null {
  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME_TYPES.has(file.type)) {
    return 'Unsupported format. Accepted: MP4, MOV, AVI, MKV, WebM.';
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File is too large (${formatBytes(file.size)}). Maximum size is 5 GB.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UploadState =
  | { phase: 'idle' }
  | { phase: 'quota-exceeded'; monthlyUsage: number }
  | { phase: 'selected'; file: File; error?: string }
  | { phase: 'uploading'; file: File; progress: number }
  | { phase: 'success'; file: File; uploadJobId: string; r2Key: string }
  | { phase: 'error'; message: string };

export interface UploadVideoFormProps {
  /** Draft ID to associate this upload with. */
  draftId: string;
  /** Where the "Back" link navigates — typically the draft edit page. */
  backHref: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UploadVideoForm({ draftId, backHref }: UploadVideoFormProps) {
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const [isSupporter, setIsSupporter] = useState<boolean | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // File selection
  // -------------------------------------------------------------------------

  const handleFilesChosen = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      // Ignore new file selections while an upload is already in progress
      if (state.phase === 'uploading') return;
      const file = files[0];
      const error = validateFile(file);
      setState({ phase: 'selected', file, error: error ?? undefined });
    },
    [state.phase]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFilesChosen(e.target.files);
  };

  // -------------------------------------------------------------------------
  // Drag and drop
  // -------------------------------------------------------------------------

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFilesChosen(e.dataTransfer.files);
  };

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  const handleUpload = async () => {
    if (state.phase !== 'selected' || state.error) return;
    const { file } = state;

    // 1. Request a presigned URL from the server, passing draftId to create UploadJob
    let presignData: { uploadUrl: string; key: string; uploadJobId: string };
    try {
      const res = await fetch('/api/uploads/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
          draftId,
        }),
      });

      const json = await res.json();

      if (res.status === 403 && typeof json.monthlyUsage === 'number') {
        // Quota-exceeded — the server includes monthlyUsage in the body
        setState({
          phase: 'quota-exceeded',
          monthlyUsage: json.monthlyUsage,
        });
        setIsSupporter(json.isSupporter ?? false);
        return;
      }

      if (!res.ok) {
        setState({ phase: 'error', message: json.error ?? 'Failed to start upload.' });
        return;
      }

      presignData = json as { uploadUrl: string; key: string; uploadJobId: string };
      setIsSupporter(json.isSupporter ?? null);
    } catch {
      setState({ phase: 'error', message: 'Network error. Check your connection and try again.' });
      return;
    }

    // 2. Upload directly to R2 using XHR for progress tracking
    setState({ phase: 'uploading', file, progress: 0 });

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setState({ phase: 'uploading', file, progress: pct });
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setState({
            phase: 'success',
            file,
            uploadJobId: presignData.uploadJobId,
            r2Key: presignData.key,
          });
        } else {
          setState({
            phase: 'error',
            message: `Upload failed (HTTP ${xhr.status}). Please try again.`,
          });
        }
        xhrRef.current = null;
        resolve();
      });

      xhr.addEventListener('error', () => {
        setState({ phase: 'error', message: 'Network error during upload. Please try again.' });
        xhrRef.current = null;
        resolve();
      });

      xhr.addEventListener('abort', () => {
        setState({ phase: 'idle' });
        xhrRef.current = null;
        resolve();
      });

      xhr.open('PUT', presignData.uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.send(file);
    });
  };

  const handleCancel = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
    }
  };

  const handleReset = () => {
    setState({ phase: 'idle' });
    if (inputRef.current) inputRef.current.value = '';
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Quota-exceeded banner */}
      {state.phase === 'quota-exceeded' && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-5 text-center space-y-3">
          <p className="font-semibold text-destructive">Monthly upload limit reached</p>
          <p className="text-sm text-muted-foreground">
            You have used {state.monthlyUsage} of {FREE_TIER_LIMIT} free uploads this month.
          </p>
          <Link
            href="/pricing"
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Upgrade to Supporter
          </Link>
          <p className="text-xs text-muted-foreground">Supporter plan: unlimited uploads.</p>
        </div>
      )}

      {/* Success state */}
      {state.phase === 'success' && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-5 space-y-3">
          <p className="font-semibold text-green-700 dark:text-green-400">Upload complete!</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{state.file.name}</span> has been uploaded successfully.
          </p>
          <dl className="text-xs font-mono break-all text-muted-foreground space-y-1">
            <div>
              <dt className="inline font-sans font-medium not-italic">Upload job: </dt>
              <dd className="inline">{state.uploadJobId}</dd>
            </div>
            <div>
              <dt className="inline font-sans font-medium not-italic">R2 key: </dt>
              <dd className="inline">{state.r2Key}</dd>
            </div>
          </dl>
          <div className="flex gap-3">
            <Link
              href={backHref}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Back to draft
            </Link>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Upload another
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {state.phase === 'error' && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-5 space-y-3">
          <p className="font-semibold text-destructive">Upload failed</p>
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md border border-border px-4 py-1.5 text-sm font-medium hover:bg-muted"
          >
            Try again
          </button>
        </div>
      )}

      {/* Upload area — shown when not in terminal states */}
      {state.phase !== 'success' && state.phase !== 'quota-exceeded' && state.phase !== 'error' && (
        <>
          {/* Drop zone */}
          <div
            role="button"
            tabIndex={state.phase === 'uploading' ? -1 : 0}
            aria-label="Click or drag a video file here to upload"
            aria-disabled={state.phase === 'uploading'}
            onClick={() => state.phase !== 'uploading' && inputRef.current?.click()}
            onKeyDown={(e) => {
              if (state.phase !== 'uploading' && (e.key === 'Enter' || e.key === ' '))
                inputRef.current?.click();
            }}
            onDragOver={state.phase !== 'uploading' ? handleDragOver : undefined}
            onDragLeave={state.phase !== 'uploading' ? handleDragLeave : undefined}
            onDrop={state.phase !== 'uploading' ? handleDrop : undefined}
            className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
              state.phase === 'uploading'
                ? 'cursor-not-allowed border-border bg-muted opacity-50'
                : isDragging
                  ? 'cursor-pointer border-primary bg-primary/5'
                  : 'cursor-pointer border-border bg-muted hover:border-primary/50'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".mp4,.mov,.avi,.mkv,.webm,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
              className="sr-only"
              onChange={handleInputChange}
              aria-hidden="true"
            />
            {state.phase === 'idle' ? (
              <>
                <p className="text-lg font-medium">Drag &amp; drop your video here</p>
                <p className="mt-1 text-sm text-muted-foreground">or click to browse files</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  MP4, MOV, AVI, MKV, WebM · Up to 5 GB
                </p>
              </>
            ) : (
              <>
                <p className="font-medium truncate max-w-xs mx-auto">
                  {(state as { file: File }).file.name}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatBytes((state as { file: File }).file.size)}
                  {' · '}
                  <span className="underline">Change file</span>
                </p>
              </>
            )}
          </div>

          {/* Validation error */}
          {state.phase === 'selected' && state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          {/* Progress bar */}
          {state.phase === 'uploading' && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Uploading…</span>
                <span className="font-medium">{state.progress}%</span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                style={{ ['--upload-progress' as string]: `${state.progress}%` }}
              >
                <div
                  className="upload-progress-fill"
                  role="progressbar"
                  aria-label={`Upload progress: ${state.progress}%`}
                  aria-valuenow={state.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            {state.phase === 'uploading' ? (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-destructive px-5 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={handleUpload}
                disabled={
                  state.phase !== 'selected' || Boolean((state as { error?: string }).error)
                }
                className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Upload
              </button>
            )}
          </div>

          {/* Supporter indicator */}
          {isSupporter === true && (
            <p className="text-xs text-muted-foreground">Supporter plan: unlimited uploads.</p>
          )}
        </>
      )}
    </div>
  );
}
