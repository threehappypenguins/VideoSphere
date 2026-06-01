import Link from 'next/link';

/**
 * Props for the first-run setup callout shown on the marketing home page.
 */
export interface FirstRunSetupBannerProps {
  /** Path to the first-run setup page, including the setup token query param. */
  setupHref: string;
}

/**
 * Banner prompting the instance owner to complete first-run admin setup.
 * @param props - Banner props.
 * @returns The first-run setup callout UI.
 */
export function FirstRunSetupBanner({ setupHref }: FirstRunSetupBannerProps) {
  return (
    <div
      role="status"
      className="border-b border-primary/30 bg-primary/10 px-4 py-4 sm:px-6 lg:px-8"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">First-run setup required</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This VideoSphere instance has no accounts yet. Create the initial admin account to get
            started.
          </p>
        </div>
        <Link
          href={setupHref}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Set up VideoSphere
        </Link>
      </div>
    </div>
  );
}
