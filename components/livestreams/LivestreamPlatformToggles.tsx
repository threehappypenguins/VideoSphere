'use client';

import { useId, useMemo } from 'react';
import { PlatformTargetIcon } from '@/components/icons/PlatformIcon';
import type { ConnectedAccountPlatform } from '@/types';
import { platformLabel } from '@/lib/ui/platform-label';

interface LivestreamPlatformTogglesProps {
  /** Livestream distribution platforms to show (typically {@link LIVESTREAM_PLATFORMS}). */
  availablePlatforms: readonly ConnectedAccountPlatform[];
  /** Currently selected platform targets. */
  selectedPlatforms: ConnectedAccountPlatform[];
  /** Platforms with an active OAuth connection for this user. */
  connectedPlatforms: ConnectedAccountPlatform[];
  /** True once the connections request has settled (success or failure). */
  connectionsResolved: boolean;
  /** Called when the user toggles a platform on or off. */
  onToggle: (platform: ConnectedAccountPlatform) => void;
  /** Called when the user clicks Connect on a disconnected platform row. */
  onConnectClick: () => void;
}

/**
 * Renders platform target toggles for the livestream metadata editor.
 * @param props - Component props.
 * @returns Platform toggle list for livestream targets.
 */
export function LivestreamPlatformToggles({
  availablePlatforms,
  selectedPlatforms,
  connectedPlatforms,
  connectionsResolved,
  onToggle,
  onConnectClick,
}: LivestreamPlatformTogglesProps) {
  const instanceId = useId();
  const connectedSet = useMemo(() => new Set(connectedPlatforms), [connectedPlatforms]);

  return (
    <div className="space-y-2">
      {availablePlatforms.map((platform) => {
        const isConnected = !connectionsResolved || connectedSet.has(platform);
        const isSelected = selectedPlatforms.includes(platform);
        const canToggle = isConnected || isSelected;
        const switchId = `${instanceId}-livestream-platform-toggle-${platform}`;

        return (
          <div
            key={platform}
            className={`flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 ${
              canToggle ? '' : 'opacity-80'
            }`}
          >
            <span className="inline-flex flex-wrap items-center gap-2 text-sm text-foreground">
              <PlatformTargetIcon platform={platform} />
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
              className={`relative ml-3 inline-flex shrink-0 items-center ${canToggle ? 'cursor-pointer' : 'cursor-not-allowed'}`}
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
  );
}
