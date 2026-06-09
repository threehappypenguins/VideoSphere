import { PlatformIcon, isPlatformBrandIcon } from '@/components/icons/PlatformIcon';
import type { ConnectedAccountPlatform } from '@/types';
import { platformLabel } from '@/lib/ui/platform-label';

interface DraftPlatformTogglesProps {
  availablePlatforms: ConnectedAccountPlatform[];
  selectedPlatforms: ConnectedAccountPlatform[];
  connectedPlatforms: ConnectedAccountPlatform[];
  connectionsResolved: boolean;
  onToggle: (platform: ConnectedAccountPlatform) => void;
  onConnectClick: () => void;
}

/**
 * Renders the draft platform toggles component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export function DraftPlatformToggles({
  availablePlatforms,
  selectedPlatforms,
  connectedPlatforms,
  connectionsResolved,
  onToggle,
  onConnectClick,
}: DraftPlatformTogglesProps) {
  const connectedSet = new Set(connectedPlatforms);

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {availablePlatforms.map((platform) => {
          const isConnected = !connectionsResolved || connectedSet.has(platform);
          const isSelected = selectedPlatforms.includes(platform);
          const canToggle = isConnected || isSelected;
          const switchId = `draft-platform-toggle-${platform}`;
          return (
            <div
              key={platform}
              className={`flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 ${
                canToggle ? '' : 'opacity-80'
              }`}
            >
              <span className="inline-flex items-center gap-2 text-sm text-foreground">
                {isPlatformBrandIcon(platform) ? <PlatformIcon platform={platform} /> : null}
                {platformLabel(platform)}
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
              <label
                htmlFor={switchId}
                className={`relative inline-flex items-center ${canToggle ? 'cursor-pointer' : 'cursor-not-allowed'}`}
              >
                <input
                  id={switchId}
                  type="checkbox"
                  aria-label={`Toggle ${platformLabel(platform)} platform`}
                  checked={isSelected}
                  disabled={!canToggle}
                  onChange={() => {
                    if (canToggle) onToggle(platform);
                  }}
                  className="peer sr-only"
                />
                <span className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary" />
                <span className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-5" />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
