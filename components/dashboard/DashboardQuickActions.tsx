'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ApiResponse, Draft } from '@/types';

export function DashboardQuickActions() {
  const router = useRouter();
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);

  const handleCreateDraft = async () => {
    if (isCreatingDraft) return;

    setIsCreatingDraft(true);
    try {
      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minimal: true }),
      });

      if (!response.ok) {
        const err = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? 'Failed to create draft');
      }

      const payload = (await response.json()) as ApiResponse<Draft>;
      const draft = payload.data;
      if (!draft?.id) {
        throw new Error('Failed to create draft');
      }

      router.push(`/dashboard/drafts?createDraftId=${draft.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create draft');
    } finally {
      setIsCreatingDraft(false);
    }
  };

  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold text-foreground text-shadow-bg">Quick actions</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          data-tour="go-to-drafts-help"
          onClick={() => {
            void handleCreateDraft();
          }}
          disabled={isCreatingDraft}
          className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {isCreatingDraft ? 'Creating…' : 'New draft'}
        </button>
        <Link
          href="/dashboard/drafts"
          data-tour="ai-metadata-hint"
          className="rounded-lg border border-border px-6 py-2 text-sm font-medium text-foreground transition-colors bg-background/70 hover:bg-muted"
        >
          View drafts
        </Link>
        <Link
          href="/profile/connections"
          data-tour="connected-accounts-link"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Connected accounts
        </Link>
      </div>
    </div>
  );
}
