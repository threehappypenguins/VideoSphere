'use client';

import type { ReactNode } from 'react';
import { Copy, Loader2, Trash2 } from 'lucide-react';
import type { Livestream, LivestreamStatus } from '@/types';

/** Maximum streamed livestreams shown on the main livestreams page before linking to history. */
export const STREAMED_LIVESTREAM_PREVIEW_LIMIT = 4;

/**
 * Formats a scheduled start time for display in livestream lists.
 * @param iso - ISO-8601 timestamp, if any.
 * @returns Localized date/time string or an em dash when missing.
 */
export function formatScheduledDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Returns the display title for a livestream row.
 * @param livestream - Livestream row.
 * @returns Trimmed title or a fallback label.
 */
export function displayTitle(livestream: Livestream): string {
  return livestream.title.trim() || 'Untitled livestream';
}

/**
 * Maps a livestream status to a short badge label.
 * @param status - Livestream lifecycle status.
 * @returns Human-readable status label.
 */
export function statusBadgeLabel(status: LivestreamStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'scheduled':
      return 'Scheduled';
    case 'live':
      return 'Live';
    case 'ended':
      return 'Ended';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

/**
 * Builds an optional key-slot note for a livestream row.
 * @param livestream - Livestream row.
 * @returns Key-slot note text, or null when not applicable.
 */
export function formatKeySwapNote(livestream: Livestream): string | null {
  if (livestream.keySlotStaleAt) {
    return `Key: main → stale (never went live) at ${formatScheduledDateTime(livestream.keySlotStaleAt)}`;
  }
  if (livestream.keySwapPromotedAt && livestream.status === 'scheduled') {
    return `Key: temp → promoted to main at ${formatScheduledDateTime(livestream.keySwapPromotedAt)}`;
  }
  if (livestream.keySlot === 'temp' && livestream.status === 'scheduled') {
    return 'Key: temp (queued)';
  }
  return null;
}

interface LivestreamActionsProps {
  livestream: Livestream;
  onDelete: (livestream: Livestream) => void;
  onDuplicate: (livestream: Livestream) => void;
  isDeletingId: string | null;
  isDuplicatingId: string | null;
}

const livestreamActionIconButtonClassName =
  'pointer-events-auto inline-flex shrink-0 h-12 w-12 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-muted disabled:opacity-60';

function LivestreamActions({
  livestream,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
}: LivestreamActionsProps) {
  const isDuplicating = isDuplicatingId === livestream.id;

  return (
    <div className="inline-flex shrink-0 items-center gap-3">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDuplicate(livestream);
        }}
        disabled={isDuplicating}
        className={livestreamActionIconButtonClassName}
        aria-label={isDuplicating ? 'Copying livestream' : 'Duplicate livestream'}
      >
        {isDuplicating ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(livestream);
        }}
        disabled={isDeletingId === livestream.id}
        className={livestreamActionIconButtonClassName}
        aria-label="Delete livestream"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Renders a compact status badge for a livestream row.
 * @param props - Component props.
 * @param props.status - Livestream lifecycle status.
 * @returns Status badge element.
 */
export function StatusBadge({ status }: { status: LivestreamStatus }) {
  const label = statusBadgeLabel(status);
  const className =
    status === 'draft'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100'
      : status === 'scheduled'
        ? 'border-sky-500/30 bg-sky-500/10 text-sky-950 dark:text-sky-100'
        : status === 'live'
          ? 'border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-100'
          : status === 'failed'
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-muted-foreground/30 bg-muted/40 text-muted-foreground';

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-center text-[11px] font-medium leading-snug ${className}`}
    >
      {label}
    </span>
  );
}

interface LivestreamSectionProps {
  title: string;
  description: string;
  live?: boolean;
  streamed?: boolean;
  children: ReactNode;
}

/**
 * Renders a grouped section on the livestreams dashboard list.
 * @param props - Section props.
 * @returns Section container with heading and content.
 */
export function LivestreamSection({
  title,
  description,
  live = false,
  streamed = false,
  children,
}: LivestreamSectionProps) {
  const sectionClassName = live
    ? 'border-amber-500/40 bg-amber-500/10'
    : streamed
      ? 'border-muted-foreground/30 bg-muted/20'
      : 'border-border bg-background';

  return (
    <section className={`space-y-3 rounded-xl border p-4 sm:p-5 ${sectionClassName}`}>
      <header className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}

export interface LivestreamsTableContentProps {
  livestreams: Livestream[];
  showScheduledColumn: boolean;
  onEdit: (livestream: Livestream) => void;
  onDelete: (livestream: Livestream) => void;
  onDuplicate: (livestream: Livestream) => void;
  isDeletingId: string | null;
  isDuplicatingId: string | null;
  dimStreamedRows?: boolean;
}

function LivestreamMobileRow({
  livestream,
  showScheduledColumn,
  dimStreamedRows = false,
  onEdit,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
}: Omit<LivestreamsTableContentProps, 'livestreams'> & { livestream: Livestream }) {
  const title = displayTitle(livestream);
  const keySwapNote = formatKeySwapNote(livestream);

  return (
    <article className={`relative px-3 py-3 sm:px-4 ${dimStreamedRows ? 'bg-muted/20' : ''}`}>
      <button
        type="button"
        onClick={() => onEdit(livestream)}
        aria-label={`Edit livestream "${title}"`}
        className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />
      <div className="relative z-0">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {keySwapNote ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{keySwapNote}</span>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          {showScheduledColumn ? (
            <span className="text-xs text-muted-foreground">
              {formatScheduledDateTime(livestream.scheduledStartTime)}
            </span>
          ) : null}
          <StatusBadge status={livestream.status} />
          <div className="relative z-20 ml-auto pointer-events-auto">
            <LivestreamActions
              livestream={livestream}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              isDeletingId={isDeletingId}
              isDuplicatingId={isDuplicatingId}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Renders a responsive table of livestreams for dashboard list pages.
 * @param props - Table props and row action handlers.
 * @returns Livestream list table UI.
 */
export function LivestreamsTableContent({
  livestreams,
  showScheduledColumn,
  onEdit,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
  dimStreamedRows = false,
}: LivestreamsTableContentProps) {
  return (
    <>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background md:hidden">
        {livestreams.map((livestream) => (
          <LivestreamMobileRow
            key={livestream.id}
            livestream={livestream}
            showScheduledColumn={showScheduledColumn}
            dimStreamedRows={dimStreamedRows}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isDeletingId={isDeletingId}
            isDuplicatingId={isDuplicatingId}
          />
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-background md:block">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th
                scope="col"
                className={`px-4 py-3 text-left ${showScheduledColumn ? 'w-[30%]' : 'w-[40%]'}`}
              >
                Title
              </th>
              {showScheduledColumn ? (
                <th scope="col" className="w-[22%] px-4 py-3 text-left">
                  Scheduled
                </th>
              ) : null}
              <th
                scope="col"
                className={`px-4 py-3 text-left ${showScheduledColumn ? 'w-[18%]' : 'w-[24%]'}`}
              >
                Status
              </th>
              <th
                scope="col"
                className={`px-4 py-3 text-right ${showScheduledColumn ? 'w-[30%]' : 'w-[36%]'}`}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {livestreams.map((livestream) => {
              const title = displayTitle(livestream);
              const keySwapNote = formatKeySwapNote(livestream);
              return (
                <tr
                  key={livestream.id}
                  className={`border-b border-border transition-colors hover:bg-muted/40 ${
                    dimStreamedRows ? 'bg-muted/20' : ''
                  }`}
                >
                  <td className="p-0 align-middle">
                    <button
                      type="button"
                      onClick={() => onEdit(livestream)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onEdit(livestream);
                        }
                      }}
                      aria-label={`Edit livestream "${title}"`}
                      className="flex min-h-12 w-full flex-col justify-center px-4 py-3 text-left"
                    >
                      <span className="block max-w-full truncate text-foreground">{title}</span>
                      {keySwapNote ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {keySwapNote}
                        </span>
                      ) : null}
                    </button>
                  </td>
                  {showScheduledColumn ? (
                    <td className="p-0 align-middle text-muted-foreground">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => onEdit(livestream)}
                        aria-label={`Edit livestream "${title}"`}
                        className="flex min-h-12 w-full items-center px-4 py-3 text-left"
                      >
                        <span className="block truncate">
                          {formatScheduledDateTime(livestream.scheduledStartTime)}
                        </span>
                      </button>
                    </td>
                  ) : null}
                  <td className="p-0 align-middle">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onEdit(livestream)}
                      aria-label={`Edit livestream "${title}"`}
                      className="flex min-h-12 w-full items-center px-4 py-3 text-left"
                    >
                      <StatusBadge status={livestream.status} />
                    </button>
                  </td>
                  <td className="p-0 align-middle text-right">
                    <div className="relative">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => onEdit(livestream)}
                        aria-label={`Edit livestream "${title}"`}
                        className="absolute inset-0 z-0"
                      />
                      <div
                        className="relative z-10 flex min-h-12 items-center justify-end px-4 py-3"
                        role="button"
                        tabIndex={0}
                        aria-label={`Edit livestream "${title}"`}
                        onClick={() => onEdit(livestream)}
                        onKeyDown={(event) => {
                          const target = event.target as HTMLElement | null;
                          if (
                            target &&
                            target.closest('button') &&
                            target !== event.currentTarget
                          ) {
                            return;
                          }
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onEdit(livestream);
                          }
                        }}
                      >
                        <LivestreamActions
                          livestream={livestream}
                          onDelete={onDelete}
                          onDuplicate={onDuplicate}
                          isDeletingId={isDeletingId}
                          isDuplicatingId={isDuplicatingId}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
