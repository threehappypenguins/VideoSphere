import { Info } from 'lucide-react';

/**
 * Inline callout for YouTube fields that cannot be applied automatically via the Data API.
 * @returns Info note explaining YouTube Studio follow-up is required.
 */
export function YouTubeStudioNote() {
  return (
    <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        This setting can&apos;t be applied automatically. You&apos;ll need to set it in YouTube
        Studio after upload.
      </span>
    </p>
  );
}
