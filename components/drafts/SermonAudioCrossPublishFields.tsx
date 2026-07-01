'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS,
  SERMON_AUDIO_CROSS_PUBLISH_YOUTUBE_PRIVACY_OPTIONS,
} from '@/lib/platforms/sermon-audio-cross-publish';
import {
  SERMONAUDIO_SOCIAL_CONNECTIONS_DASHBOARD_URL,
  type SermonAudioCrossPublishSocialConnections,
} from '@/lib/platforms/sermon-audio-social-connections';
import type {
  ApiResponse,
  SermonAudioCrossPublishPlatformSettings,
  SermonAudioCrossPublishSettings,
  SermonAudioCrossPublishTarget,
} from '@/types';
import { cn } from '@/lib/utils';

interface SermonAudioCrossPublishFieldsProps {
  /** Current Cross Publish settings from `platforms.sermon_audio.crossPublish`. */
  crossPublish: SermonAudioCrossPublishSettings | undefined;
  /** Draft title used to prefill Cross Publish text fields. */
  defaultVideoTitle?: string;
  /** Draft description used to prefill YouTube Cross Publish description. */
  defaultVideoDescription?: string;
  /** Called when Cross Publish settings change. */
  onChange: (next: SermonAudioCrossPublishSettings | undefined) => void;
}

function patchCrossPublishPlatform(
  current: SermonAudioCrossPublishSettings | undefined,
  platform: SermonAudioCrossPublishTarget,
  patch: Partial<SermonAudioCrossPublishPlatformSettings>
): SermonAudioCrossPublishSettings {
  const base = current ?? {};
  const nextPlatform = { ...base[platform], ...patch };
  return { ...base, [platform]: nextPlatform };
}

function stripDisconnectedCrossPublishPlatforms(
  current: SermonAudioCrossPublishSettings | undefined,
  connections: SermonAudioCrossPublishSocialConnections
): SermonAudioCrossPublishSettings | undefined {
  if (!current) return current;

  let changed = false;
  const next: SermonAudioCrossPublishSettings = { ...current };

  for (const destination of SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS) {
    if (connections[destination.id].connected || !next[destination.id]) continue;
    delete next[destination.id];
    changed = true;
  }

  return changed ? next : current;
}

interface CrossPublishToggleRowProps {
  /** Stable id for the switch input. */
  id: string;
  /** Visible label for the option. */
  label: string;
  /** Whether the switch is on. */
  checked: boolean;
  /** When true, the switch cannot be toggled (SermonAudio dashboard constraint). */
  disabled?: boolean;
  /** Called when the switch value changes. */
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Single Cross Publish option row with label and switch toggle.
 * @param props - Toggle row props.
 * @returns A labeled switch row.
 */
function CrossPublishToggleRow({
  id,
  label,
  checked,
  disabled = false,
  onCheckedChange,
}: CrossPublishToggleRowProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-center gap-2.5 rounded-md border border-border bg-background px-2.5 py-1.5',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      )}
    >
      <span className="relative inline-flex shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="h-4 w-7 rounded-full bg-muted transition-colors peer-checked:bg-primary" />
        <span className="pointer-events-none absolute left-0.5 h-3 w-3 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-3" />
      </span>
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

/**
 * SermonAudio Cross Publish toggle and per-platform options for the draft editor.
 * Render only when auto-publish is enabled on the parent form.
 * @param props - Cross Publish settings and change handler.
 * @returns Cross Publish field group.
 */
export function SermonAudioCrossPublishFields({
  crossPublish,
  defaultVideoTitle = '',
  defaultVideoDescription = '',
  onChange,
}: SermonAudioCrossPublishFieldsProps) {
  const crossPublishEnabled = crossPublish?.enabled === true;
  const crossPublishSwitchId = 'draft-sa-cross-publish-enabled';
  const onChangeRef = useRef(onChange);
  const crossPublishRef = useRef(crossPublish);
  onChangeRef.current = onChange;
  crossPublishRef.current = crossPublish;

  const [connections, setConnections] = useState<SermonAudioCrossPublishSocialConnections | null>(
    null
  );
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsFailed, setConnectionsFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadConnections = async () => {
      setConnectionsLoading(true);
      setConnectionsFailed(false);

      try {
        const response = await fetch('/api/platforms/sermon-audio/social-connections', {
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error('Failed to load SermonAudio social connections');
        }
        const payload =
          (await response.json()) as ApiResponse<SermonAudioCrossPublishSocialConnections>;
        if (cancelled) return;

        const nextConnections = payload.data ?? null;
        setConnections(nextConnections);
        setConnectionsFailed(nextConnections === null);

        if (nextConnections) {
          const stripped = stripDisconnectedCrossPublishPlatforms(
            crossPublishRef.current,
            nextConnections
          );
          if (stripped !== crossPublishRef.current) {
            onChangeRef.current(stripped);
          }
        }
      } catch {
        if (!cancelled) {
          setConnections(null);
          setConnectionsFailed(true);
        }
      } finally {
        if (!cancelled) {
          setConnectionsLoading(false);
        }
      }
    };

    void loadConnections();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-3 rounded-md border border-border bg-background/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Cross Publish</span>
        <label
          htmlFor={crossPublishSwitchId}
          className="relative inline-flex cursor-pointer items-center"
        >
          <input
            id={crossPublishSwitchId}
            type="checkbox"
            role="switch"
            aria-label="Toggle Cross Publish"
            checked={crossPublishEnabled}
            onChange={(event) =>
              onChange({
                ...(crossPublish ?? {}),
                enabled: event.target.checked,
              })
            }
            className="peer sr-only"
          />
          <span className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary" />
          <span className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-5" />
        </label>
      </div>
      {crossPublishEnabled ? (
        <>
          {connectionsLoading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              Checking SermonAudio social connections…
            </p>
          ) : connectionsFailed ? (
            <p className="text-xs text-muted-foreground">
              Could not verify which social platforms are connected. Link platforms in your{' '}
              <a
                href={SERMONAUDIO_SOCIAL_CONNECTIONS_DASHBOARD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                SermonAudio Connections
              </a>{' '}
              dashboard before distributing.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Cross Publish posts to platforms connected in your{' '}
              <a
                href={SERMONAUDIO_SOCIAL_CONNECTIONS_DASHBOARD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                SermonAudio Connections
              </a>{' '}
              dashboard. Unconnected platforms are disabled below.
            </p>
          )}
          {SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS.map((destination) => {
            const platformSettings = crossPublish?.[destination.id];
            const connectionStatus = connections?.[destination.id];
            const platformConnected = connectionStatus?.connected === true;
            const platformDisconnected =
              !connectionsLoading &&
              !connectionsFailed &&
              connections !== null &&
              !platformConnected;
            const postLink = platformSettings?.postLink === true;
            const uploadFullVideo = platformSettings?.uploadFullVideo === true;
            const linkMessage = platformSettings?.linkMessage ?? '';
            const videoTitle = platformSettings?.title ?? '';
            const videoDescription = platformSettings?.description ?? '';
            const privacy = platformSettings?.privacy ?? 'public';
            const descriptionId = `draft-sa-cross-publish-${destination.id}-message`;
            const titleId = `draft-sa-cross-publish-${destination.id}-title`;
            const videoDescriptionId = `draft-sa-cross-publish-${destination.id}-video-description`;
            const privacyId = `draft-sa-cross-publish-${destination.id}-privacy`;

            return (
              <div
                key={destination.id}
                className={cn(
                  'space-y-2 rounded-md border border-border/80 bg-muted/20 p-3',
                  platformDisconnected && 'opacity-60'
                )}
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{destination.label}</p>
                  {connectionStatus?.connected && connectionStatus.displayName ? (
                    <p className="text-xs text-muted-foreground">
                      Connected as {connectionStatus.displayName}
                    </p>
                  ) : null}
                  {platformDisconnected ? (
                    <p className="text-xs text-muted-foreground">
                      Not connected.{' '}
                      <a
                        href={SERMONAUDIO_SOCIAL_CONNECTIONS_DASHBOARD_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2"
                      >
                        Connect in SermonAudio
                      </a>
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {destination.options.map((option) => {
                    const optionSwitchId = `draft-sa-cross-publish-${destination.id}-${option.id}`;
                    const checked = platformSettings?.[option.id] === true;
                    const requiresPostLink =
                      !postLink &&
                      ((destination.id === 'facebook' && option.id === 'uploadFullVideo') ||
                        ((destination.id === 'x' || destination.id === 'instagram') &&
                          option.id === 'uploadVideoPreview'));

                    return (
                      <CrossPublishToggleRow
                        key={option.id}
                        id={optionSwitchId}
                        label={option.label}
                        checked={checked}
                        disabled={platformDisconnected || requiresPostLink}
                        onCheckedChange={(nextChecked) =>
                          onChange(
                            patchCrossPublishPlatform(crossPublish, destination.id, {
                              [option.id]: nextChecked,
                              ...(option.id === 'postLink' && !nextChecked
                                ? destination.id === 'facebook'
                                  ? { uploadFullVideo: false }
                                  : destination.id === 'x' || destination.id === 'instagram'
                                    ? { uploadVideoPreview: false }
                                    : {}
                                : {}),
                              ...(destination.supportsPrivacy &&
                              option.id === 'uploadFullVideo' &&
                              nextChecked &&
                              !platformSettings?.privacy
                                ? { privacy: 'public' as const }
                                : {}),
                              ...(destination.supportsVideoMetadata &&
                              option.id === 'uploadFullVideo' &&
                              nextChecked
                                ? {
                                    ...(platformSettings?.title === undefined && defaultVideoTitle
                                      ? { title: defaultVideoTitle }
                                      : {}),
                                    ...(platformSettings?.description === undefined &&
                                    defaultVideoDescription
                                      ? { description: defaultVideoDescription }
                                      : {}),
                                  }
                                : {}),
                              ...(destination.supportsLinkMessage &&
                              option.id === 'postLink' &&
                              nextChecked &&
                              platformSettings?.linkMessage === undefined &&
                              defaultVideoTitle
                                ? { linkMessage: defaultVideoTitle }
                                : {}),
                            })
                          )
                        }
                      />
                    );
                  })}
                  {destination.supportsVideoMetadata && uploadFullVideo && !platformDisconnected ? (
                    <>
                      <div>
                        <label htmlFor={titleId} className="text-sm font-medium text-foreground">
                          Title
                        </label>
                        <input
                          id={titleId}
                          type="text"
                          value={videoTitle}
                          onChange={(event) =>
                            onChange(
                              patchCrossPublishPlatform(crossPublish, destination.id, {
                                title: event.target.value,
                              })
                            )
                          }
                          placeholder="YouTube video title"
                          className={cn(
                            'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground'
                          )}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={videoDescriptionId}
                          className="text-sm font-medium text-foreground"
                        >
                          Description
                        </label>
                        <textarea
                          id={videoDescriptionId}
                          rows={3}
                          value={videoDescription}
                          onChange={(event) =>
                            onChange(
                              patchCrossPublishPlatform(crossPublish, destination.id, {
                                description: event.target.value,
                              })
                            )
                          }
                          placeholder="YouTube video description"
                          className={cn(
                            'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground'
                          )}
                        />
                      </div>
                    </>
                  ) : null}
                  {destination.supportsPrivacy && uploadFullVideo && !platformDisconnected ? (
                    <div>
                      <label htmlFor={privacyId} className="text-sm font-medium text-foreground">
                        Visibility
                      </label>
                      <select
                        id={privacyId}
                        value={privacy}
                        onChange={(event) =>
                          onChange(
                            patchCrossPublishPlatform(crossPublish, destination.id, {
                              privacy: event.target.value as typeof privacy,
                            })
                          )
                        }
                        className={cn(
                          'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground'
                        )}
                      >
                        {SERMON_AUDIO_CROSS_PUBLISH_YOUTUBE_PRIVACY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {destination.supportsLinkMessage && postLink && !platformDisconnected ? (
                    <div>
                      <label
                        htmlFor={descriptionId}
                        className="text-sm font-medium text-foreground"
                      >
                        Description
                      </label>
                      <textarea
                        id={descriptionId}
                        rows={3}
                        value={linkMessage}
                        onChange={(event) =>
                          onChange(
                            patchCrossPublishPlatform(crossPublish, destination.id, {
                              linkMessage: event.target.value,
                            })
                          )
                        }
                        placeholder={`Message to include with the ${destination.label} link post`}
                        className={cn(
                          'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground'
                        )}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
