'use client';

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import Link from 'next/link';
import {
  cancelMultipartUploadJob,
  getPartByteRange,
  type CompletedMultipartPart,
  type MultipartPresignResponse,
  uploadPartWithRetry,
} from '@/lib/uploads/browser-multipart-upload';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB

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
  | { phase: 'selected'; file: File; error?: string }
  | { phase: 'uploading'; file: File; progress: number; uploadJobId: string }
  | { phase: 'finalizing'; file: File; uploadJobId: string; r2Key: string }
  | { phase: 'success'; file: File; uploadJobId: string; r2Key: string }
  | { phase: 'error'; message: string };

/**
 * Defines the shape of upload video form props.
 */
export interface UploadVideoFormProps {
  /** Draft ID to associate this upload with. */
  draftId: string;
  /** Where the "Back" link navigates — typically the draft edit page. */
  backHref: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the upload video form component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export default function UploadVideoForm({ draftId, backHref }: UploadVideoFormProps) {
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const uploadSessionRef = useRef<{ uploadJobId: string; uploadId: string } | null>(null);

  // -------------------------------------------------------------------------
  // File selection
  // -------------------------------------------------------------------------

  const handleFilesChosen = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      // Ignore new file selections while an upload or finalization is in progress
      if (state.phase === 'uploading' || state.phase === 'finalizing') return;
      const file = files[0];
      const error = validateFile(file);
      setState({ phase: 'selected', file, error: error ?? undefined });
    },
    [state.phase]
  );

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFilesChosen(e.target.files);
  };

  // -------------------------------------------------------------------------
  // Drag and drop
  // -------------------------------------------------------------------------

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
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

    let presignData: MultipartPresignResponse;
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

      if (!res.ok) {
        setState({ phase: 'error', message: json.error ?? 'Failed to start upload.' });
        return;
      }

      presignData = json as MultipartPresignResponse;
    } catch {
      setState({ phase: 'error', message: 'Network error. Check your connection and try again.' });
      return;
    }

    cancelledRef.current = false;
    uploadSessionRef.current = {
      uploadJobId: presignData.uploadJobId,
      uploadId: presignData.uploadId,
    };

    setState({
      phase: 'uploading',
      file,
      progress: 0,
      uploadJobId: presignData.uploadJobId,
    });

    const sortedParts = [...presignData.parts].sort((a, b) => a.partNumber - b.partNumber);
    const completedParts: CompletedMultipartPart[] = [];
    let completedBytes = 0;

    for (const part of sortedParts) {
      if (cancelledRef.current) {
        uploadSessionRef.current = null;
        return;
      }

      const { start, end } = getPartByteRange(part.partNumber, presignData.partSize, file.size);
      const partBlob = file.slice(start, end);
      const partByteLength = end - start;

      const eTag = await uploadPartWithRetry({
        url: part.url,
        blob: partBlob,
        contentType: file.type,
        onProgress: (loaded) => {
          const pct = Math.round(((completedBytes + loaded) / file.size) * 100);
          setState({
            phase: 'uploading',
            file,
            progress: pct,
            uploadJobId: presignData.uploadJobId,
          });
        },
        isCancelled: () => cancelledRef.current,
        setXhr: (xhr) => {
          xhrRef.current = xhr;
        },
      });

      if (cancelledRef.current) {
        uploadSessionRef.current = null;
        return;
      }

      if (!eTag) {
        await cancelMultipartUploadJob(presignData.uploadJobId, presignData.uploadId);
        uploadSessionRef.current = null;
        xhrRef.current = null;
        setState({
          phase: 'error',
          message:
            'Upload failed after multiple retries on one part. Please try again from the beginning.',
        });
        return;
      }

      completedParts.push({ partNumber: part.partNumber, eTag });
      completedBytes += partByteLength;
      setState({
        phase: 'uploading',
        file,
        progress: Math.round((completedBytes / file.size) * 100),
        uploadJobId: presignData.uploadJobId,
      });
    }

    xhrRef.current = null;
    uploadSessionRef.current = null;

    setState({
      phase: 'finalizing',
      file,
      uploadJobId: presignData.uploadJobId,
      r2Key: presignData.key,
    });

    try {
      const res = await fetch(`/api/uploads/${presignData.uploadJobId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: presignData.uploadId,
          parts: completedParts.sort((a, b) => a.partNumber - b.partNumber),
        }),
      });

      if (!res.ok) {
        void cancelMultipartUploadJob(presignData.uploadJobId, presignData.uploadId);
        const body = await res.json().catch(() => ({}));
        setState({
          phase: 'error',
          message:
            (body as { error?: string }).error ??
            'Upload could not be finalized. Please try again.',
        });
        return;
      }

      setState({
        phase: 'success',
        file,
        uploadJobId: presignData.uploadJobId,
        r2Key: presignData.key,
      });
    } catch {
      void cancelMultipartUploadJob(presignData.uploadJobId, presignData.uploadId);
      setState({
        phase: 'error',
        message: 'Network error while finalizing upload. Please try again.',
      });
    }
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    xhrRef.current?.abort();
    xhrRef.current = null;

    const session = uploadSessionRef.current;
    if (session) {
      void cancelMultipartUploadJob(session.uploadJobId, session.uploadId);
    }
    uploadSessionRef.current = null;

    setState({ phase: 'idle' });
    if (inputRef.current) inputRef.current.value = '';
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
      {state.phase !== 'success' && state.phase !== 'error' && (
        <>
          {/* Drop zone */}
          <div
            role="button"
            tabIndex={state.phase === 'uploading' || state.phase === 'finalizing' ? -1 : 0}
            aria-label="Click or drag a video file here to upload"
            aria-disabled={state.phase === 'uploading' || state.phase === 'finalizing'}
            onClick={() =>
              state.phase !== 'uploading' &&
              state.phase !== 'finalizing' &&
              inputRef.current?.click()
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (state.phase !== 'uploading' && state.phase !== 'finalizing')
                  inputRef.current?.click();
              }
            }}
            onDragOver={
              state.phase !== 'uploading' && state.phase !== 'finalizing'
                ? handleDragOver
                : undefined
            }
            onDragLeave={
              state.phase !== 'uploading' && state.phase !== 'finalizing'
                ? handleDragLeave
                : undefined
            }
            onDrop={
              state.phase !== 'uploading' && state.phase !== 'finalizing' ? handleDrop : undefined
            }
            className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
              state.phase === 'uploading' || state.phase === 'finalizing'
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

          {/* Finalizing indicator */}
          {state.phase === 'finalizing' && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Finalizing upload…
            </p>
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
            ) : state.phase === 'finalizing' ? (
              <button
                type="button"
                disabled
                className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Finalizing…
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
        </>
      )}
    </div>
  );
}
