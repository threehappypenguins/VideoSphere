'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import type {
  ApiResponse,
  ConnectedAccountPlatform,
  PlatformUploadStatus,
  UploadJobStatus,
} from '@/types';

interface UploadHistoryPlatformItem {
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
  updatedAt: string;
  errorMessage: string | null;
  retryable: boolean;
  retryReason: string;
}

interface UploadHistoryJobItem {
  uploadJobId: string;
  draftId: string | null;
  draftTitle: string | null;
  status: UploadJobStatus;
  createdAt: string;
  updatedAt: string;
  r2FileAvailable: boolean | null;
  platforms: UploadHistoryPlatformItem[];
}

interface UploadHistoryResponse extends ApiResponse<UploadHistoryJobItem[]> {
  meta?: {
    total: number;
    limit: number;
    offset: number;
  };
}

function isJobActive(job: UploadHistoryJobItem): boolean {
  return (
    job.status === 'pending' ||
    job.status === 'uploading' ||
    job.status === 'distributing' ||
    job.platforms.some((p) => p.status === 'pending' || p.status === 'uploading')
  );
}

export function UploadHistoryClient() {
  const [jobs, setJobs] = useState<UploadHistoryJobItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());
  const [limit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch(`/api/uploads/jobs?limit=${limit}&offset=${offset}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'Failed to load upload history');
      }
      const payload = (await response.json()) as UploadHistoryResponse;
      setJobs(Array.isArray(payload.data) ? payload.data : []);
      setTotal(payload.meta?.total ?? 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load upload history');
    } finally {
      setIsLoading(false);
    }
  }, [limit, offset]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const hasActiveJobs = useMemo(() => jobs.some(isJobActive), [jobs]);

  useEffect(() => {
    if (!hasActiveJobs) return;
    const id = window.setInterval(() => {
      void loadHistory();
    }, 3000);
    return () => window.clearInterval(id);
  }, [hasActiveJobs, loadHistory]);

  useEffect(() => {
    setExpandedJobIds(new Set());
  }, [offset]);

  const retryJob = async (jobId: string) => {
    setRetryingJobId(jobId);
    try {
      const response = await fetch(`/api/uploads/jobs/${jobId}/retry`, { method: 'POST' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Retry failed');
      }
      toast.success('Retry started');
      await loadHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Retry failed');
    } finally {
      setRetryingJobId(null);
    }
  };

  const toggleExpanded = (jobId: string) => {
    setExpandedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const expandAllVisible = () => {
    setExpandedJobIds(new Set(jobs.map((job) => job.uploadJobId)));
  };

  const collapseAllVisible = () => {
    setExpandedJobIds(new Set());
  };

  const canPrev = offset > 0;
  const canNext = offset + jobs.length < total;

  if (isLoading) {
    return <p className="mt-8 text-sm text-muted-foreground">Loading upload history...</p>;
  }

  if (jobs.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-border bg-muted/50 p-12 text-center">
        <p className="font-medium text-foreground">No upload history yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Your upload history will appear here once you have distributed videos.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Showing {jobs.length === 0 ? 0 : offset + 1}-{offset + jobs.length} of {total}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={expandAllVisible}
            disabled={jobs.length === 0}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAllVisible}
            disabled={jobs.length === 0}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
          >
            Collapse all
          </button>
        </div>
      </div>

      {jobs.map((job) => {
        const jobExpanded = expandedJobIds.has(job.uploadJobId);
        const jobPanelId = `upload-history-job-panel-${job.uploadJobId}`;
        const jobAriaExpanded: 'true' | 'false' = jobExpanded ? 'true' : 'false';
        return (
          <div
            key={job.uploadJobId}
            className="rounded-xl border border-border bg-background p-4"
            title={
              job.draftTitle && job.draftTitle.trim() !== '' ? job.draftTitle : '(Deleted draft)'
            }
          >
            <button
              type="button"
              onClick={() => toggleExpanded(job.uploadJobId)}
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={jobAriaExpanded}
              aria-controls={jobPanelId}
            >
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-foreground">
                  {job.draftTitle && job.draftTitle.trim() !== ''
                    ? job.draftTitle
                    : '(Deleted draft)'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Upload: {new Date(job.createdAt).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Job status: {job.status}</p>
              </div>
              {jobExpanded ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </button>

            <div id={jobPanelId} hidden={!jobExpanded} className="mt-3 space-y-2">
              {job.platforms.map((platform) => {
                const showRetry = platform.status === 'failed' && platform.retryable;
                const isExpired = platform.status === 'failed' && job.r2FileAvailable === false;
                return (
                  <div
                    key={`${job.uploadJobId}-${platform.platform}`}
                    className="rounded-md border border-border bg-muted/30 p-3"
                  >
                    <p className="text-sm text-foreground">
                      <span className="font-medium">{platform.platform}</span>: {platform.status}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Updated: {new Date(platform.updatedAt).toLocaleString()}
                    </p>
                    {platform.errorMessage ? (
                      <p className="mt-1 text-xs text-red-600">{platform.errorMessage}</p>
                    ) : null}
                    {isExpired ? (
                      <p className="mt-2 text-xs font-medium text-amber-600">
                        Video file expired — please re-upload
                      </p>
                    ) : null}
                    {showRetry && job.r2FileAvailable !== false ? (
                      <button
                        type="button"
                        onClick={() => {
                          void retryJob(job.uploadJobId);
                        }}
                        disabled={retryingJobId === job.uploadJobId}
                        className="mt-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
                      >
                        {retryingJobId === job.uploadJobId ? 'Retrying...' : 'Retry'}
                      </button>
                    ) : null}
                    {platform.status === 'failed' && !showRetry && !isExpired ? (
                      <p className="mt-2 text-xs text-muted-foreground">{platform.retryReason}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
          disabled={!canPrev}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => setOffset((prev) => prev + limit)}
          disabled={!canNext}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
        >
          Next
        </button>
      </div>
    </div>
  );
}
