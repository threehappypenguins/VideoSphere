'use client';

import { useId, useMemo } from 'react';
import { PlatformIcon, isPlatformBrandIcon } from '@/components/icons/PlatformIcon';
import type { ConnectedAccountPlatform } from '@/types';
import { platformLabel } from '@/lib/ui/platform-label';
import { groupPlatformsBySection } from '@/lib/ui/platform-sections';

interface DraftPlatformTogglesProps {
  availablePlatforms: ConnectedAccountPlatform[];
  selectedPlatforms: ConnectedAccountPlatform[];
  connectedPlatforms: ConnectedAccountPlatform[];
  connectionsResolved: boolean;
  onToggle: (platform: ConnectedAccountPlatform) => void;
  onConnectClick: () => void;
  youtubeIsShort: boolean;
  onYouTubeShortsToggle: (value: boolean) => void;
}

interface PlatformToggleRowProps {
  platform: ConnectedAccountPlatform;
  instanceId: string;
  isConnected: boolean;
  isSelected: boolean;
  canToggle: boolean;
  youtubeIsShort: boolean;
  onToggle: (platform: ConnectedAccountPlatform) => void;
  onConnectClick: () => void;
  onYouTubeShortsToggle: (value: boolean) => void;
}

/**
 * Renders a single platform toggle row in the draft editor.
 * @param props - Row props.
 * @returns Platform toggle row UI.
 */
function PlatformToggleRow({
  platform,
  instanceId,
  isConnected,
  isSelected,
  canToggle,
  youtubeIsShort,
  onToggle,
  onConnectClick,
  onYouTubeShortsToggle,
}: PlatformToggleRowProps) {
  const switchId = `${instanceId}-platform-toggle-${platform}`;
  const youtubeShortsToggleId = `${switchId}-shorts`;

  return (
    <div
      className={`flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 ${
        canToggle ? '' : 'opacity-80'
      }`}
    >
      <span className="inline-flex flex-wrap items-center gap-2 text-sm text-foreground">
        {isPlatformBrandIcon(platform) ? (
          <PlatformIcon platform={platform} isShort={platform === 'youtube' && youtubeIsShort} />
        ) : null}
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
        {platform === 'youtube' && isSelected ? (
          <>
            <span className="mx-0.5 hidden h-4 w-px bg-border sm:inline" aria-hidden />
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
              Shorts
            </span>
            <label
              htmlFor={youtubeShortsToggleId}
              className="relative inline-flex cursor-pointer items-center"
            >
              <input
                id={youtubeShortsToggleId}
                type="checkbox"
                aria-label="Upload as YouTube Short"
                checked={youtubeIsShort}
                onChange={(e) => onYouTubeShortsToggle(e.target.checked)}
                className="peer sr-only"
              />
              <span className="h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-primary" />
              <span className="pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-4" />
            </label>
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
  youtubeIsShort,
  onYouTubeShortsToggle,
}: DraftPlatformTogglesProps) {
  const instanceId = useId();
  const connectedSet = useMemo(() => new Set(connectedPlatforms), [connectedPlatforms]);
  const { videoPlatforms, backupPlatforms } = useMemo(
    () => groupPlatformsBySection(availablePlatforms),
    [availablePlatforms]
  );

  const renderPlatformRow = (platform: ConnectedAccountPlatform) => {
    const isConnected = !connectionsResolved || connectedSet.has(platform);
    const isSelected = selectedPlatforms.includes(platform);
    const canToggle = isConnected || isSelected;

    return (
      <PlatformToggleRow
        key={platform}
        platform={platform}
        instanceId={instanceId}
        isConnected={isConnected}
        isSelected={isSelected}
        canToggle={canToggle}
        youtubeIsShort={youtubeIsShort}
        onToggle={onToggle}
        onConnectClick={onConnectClick}
        onYouTubeShortsToggle={onYouTubeShortsToggle}
      />
    );
  };

  return (
    <div className="space-y-6">
      {videoPlatforms.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-foreground">Video Platforms</h3>
          <div className="mt-2 space-y-2">{videoPlatforms.map(renderPlatformRow)}</div>
        </section>
      ) : null}

      {backupPlatforms.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-foreground">Backup</h3>
          <div className="mt-2 space-y-2">{backupPlatforms.map(renderPlatformRow)}</div>
        </section>
      ) : null}
    </div>
  );
}
