import type { ConnectedAccountPlatform } from '@/types';

interface DraftPlatformTogglesProps {
  availablePlatforms: ConnectedAccountPlatform[];
  selectedPlatforms: ConnectedAccountPlatform[];
  connectedPlatforms: ConnectedAccountPlatform[];
  connectionsResolved: boolean;
  onToggle: (platform: ConnectedAccountPlatform) => void;
  onConnectClick: () => void;
}

export function DraftPlatformToggles({
  availablePlatforms,
  selectedPlatforms,
  connectedPlatforms,
  connectionsResolved,
  onToggle,
  onConnectClick,
}: DraftPlatformTogglesProps) {
  const labelForPlatform = (platform: ConnectedAccountPlatform) =>
    platform.charAt(0).toUpperCase() + platform.slice(1);
  const connectedSet = new Set(connectedPlatforms);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Target platforms</p>
      <div className="space-y-2">
        {availablePlatforms.map((platform) => {
          const isConnected = !connectionsResolved || connectedSet.has(platform);
          const isSelected = selectedPlatforms.includes(platform);
          const switchId = `draft-platform-toggle-${platform}`;
          return (
            <div
              key={platform}
              role="button"
              tabIndex={isConnected ? 0 : -1}
              onClick={() => {
                if (isConnected) onToggle(platform);
              }}
              onKeyDown={(event) => {
                if (!isConnected) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onToggle(platform);
                }
              }}
              className={`flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 ${
                isConnected ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'
              }`}
            >
              <span className="inline-flex items-center gap-2 text-sm text-foreground">
                {labelForPlatform(platform)}
                {!isConnected ? (
                  <>
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Disconnected
                    </span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onConnectClick();
                      }}
                      className="text-xs font-medium text-foreground underline underline-offset-2"
                    >
                      Connect
                    </button>
                  </>
                ) : null}
              </span>
              <span className="relative inline-flex items-center">
                <input
                  id={switchId}
                  type="checkbox"
                  aria-label={`Toggle ${labelForPlatform(platform)} platform`}
                  checked={isConnected && isSelected}
                  disabled={!isConnected}
                  onChange={() => onToggle(platform)}
                  className="peer sr-only"
                />
                <span className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary" />
                <span className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-5" />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
