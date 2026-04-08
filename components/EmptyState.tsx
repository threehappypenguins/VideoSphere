import React from 'react';
import Link from 'next/link';

/**
 * EmptyState Component
 *
 * Reusable UI component displayed when a list or page has no data.
 * Supports an optional icon/illustration and an optional primary action
 * (navigation via href or callback via onClick).
 *
 * @example With navigation action
 * <EmptyState
 *   title="No videos yet"
 *   description="Upload your first video to get started."
 *   action={{ label: "Upload video", href: "/upload" }}
 * />
 *
 * @example With callback action
 * <EmptyState
 *   title="Something went wrong"
 *   description="We couldn't load the list."
 *   action={{ label: "Try again", onClick: () => refetch() }}
 * />
 *
 * @example With icon
 * <EmptyState
 *   icon={<InboxIcon className="h-12 w-12 text-muted-foreground" />}
 *   title="No messages"
 *   description="Your inbox is empty."
 * />
 */

export type ActionWithHref = { label: string; href: string };
/**
 * Defines an EmptyState action variant backed by a click callback.
 */
export type ActionWithOnClick = { label: string; onClick: () => void };
/**
 * Defines the EmptyStateAction type.
 */
export type EmptyStateAction = ActionWithHref | ActionWithOnClick;

/**
 * Defines the EmptyStateProps type.
 */
export type EmptyStateProps = {
  title: string;
  description?: string;
  /** Optional icon or illustration (e.g. SVG or icon component). */
  icon?: React.ReactNode;
  /** Optional primary action: provide either href (navigation) or onClick (callback), not both. */
  action?: EmptyStateAction;
};

function isInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

function isActionWithHref(action: EmptyStateAction): action is ActionWithHref {
  return 'href' in action;
}

/**
 * Renders the empty state component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export default function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  const buttonClass = 'mt-4 rounded-md bg-primary px-4 py-2 text-primary-foreground';

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center bg-background">
      {icon && (
        <div className="mb-4 flex justify-center text-muted-foreground" aria-hidden>
          {icon}
        </div>
      )}
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>

      {description && <p className="mt-2 text-muted-foreground">{description}</p>}

      {action &&
        (isActionWithHref(action) ? (
          isInternalHref(action.href) ? (
            <Link href={action.href} className={buttonClass}>
              {action.label}
            </Link>
          ) : (
            <a href={action.href} className={buttonClass}>
              {action.label}
            </a>
          )
        ) : (
          <button type="button" onClick={action.onClick} className={buttonClass}>
            {action.label}
          </button>
        ))}
    </div>
  );
}
