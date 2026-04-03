'use client';

interface ConnectButtonProps {
  href: string;
  label: string;
  className?: string;
  'data-tour'?: string;
}

/**
 * Renders a Connect / Reconnect anchor that forces a hard browser navigation
 * to the OAuth initiation route. A plain <a> tag on the same origin can be
 * intercepted by Next.js App Router's client-side fetch, which then follows
 * the server-side 307 redirect to the external OAuth provider — a cross-origin
 * fetch that CORS blocks, leaving async message-channel listeners unresolved.
 * Using window.location.assign() bypasses the router entirely.
 */
export function ConnectButton({
  href,
  label,
  className,
  'data-tour': dataTour,
}: ConnectButtonProps) {
  return (
    <a
      href={href}
      {...(dataTour ? { 'data-tour': dataTour } : {})}
      onClick={(e) => {
        // Only override unmodified left-clicks; let the browser handle
        // modified clicks (cmd/ctrl/middle-click, etc.) normally.
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.altKey ||
          e.shiftKey
        ) {
          return;
        }
        e.preventDefault();
        window.location.assign(href);
      }}
      className={
        className ??
        'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
      }
    >
      {label}
    </a>
  );
}
