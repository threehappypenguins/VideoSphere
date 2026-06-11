import { forwardRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Shared surface styles for grouped sections in the draft metadata modal. */
export const draftModalCardClassName = 'rounded-lg border border-border bg-muted/30 p-4';

interface DraftModalCardProps {
  /** Plain-text card heading. Ignored when `header` is set. */
  title?: string;
  /** Custom card heading (for example, a platform icon and badge). */
  header?: ReactNode;
  /** Card body content. */
  children: ReactNode;
  /** Optional class names merged onto the card container. */
  className?: string;
  /** Optional id for the card section element. */
  id?: string;
  /** Optional data-tour attribute for onboarding. */
  'data-tour'?: string;
  /** Optional tab index for programmatic focus (for example, after file picker). */
  tabIndex?: number;
}

/**
 * Groups draft modal content in a card matching AI metadata, thumbnail, and upload sections.
 * @param props - Component props.
 * @param ref - Ref forwarded to the card section element.
 * @returns Card section wrapper.
 */
export const DraftModalCard = forwardRef<HTMLElement, DraftModalCardProps>(function DraftModalCard(
  { title, header, children, className, id, 'data-tour': dataTour, tabIndex },
  ref
) {
  const heading =
    header ?? (title ? <p className="text-sm font-medium text-foreground">{title}</p> : null);

  return (
    <section
      ref={ref}
      id={id}
      data-tour={dataTour}
      tabIndex={tabIndex}
      className={cn(draftModalCardClassName, className)}
    >
      {heading}
      <div className={cn(heading ? 'mt-3 space-y-4' : 'space-y-4')}>{children}</div>
    </section>
  );
});

DraftModalCard.displayName = 'DraftModalCard';
