/**
 * EmptyState Component
 *
 * Reusable UI component displayed when a list or page has no data.
 *
 * Example usage:
 *
 * <EmptyState
 *   title="No videos yet"
 *   description="Upload your first video to get started."
 *   actionLabel="Upload video"
 *   actionHref="/upload"
 * />
 */
type EmptyStateProps = {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
};

export default function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center bg-background">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>

      {description && <p className="mt-2 text-muted-foreground">{description}</p>}

      {actionLabel && actionHref && (
        <a
          href={actionHref}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          {actionLabel}
        </a>
      )}
    </div>
  );
}
