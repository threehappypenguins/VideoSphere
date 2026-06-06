'use client';

import {
  SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS,
  SERMON_AUDIO_CROSS_PUBLISH_YOUTUBE_PRIVACY_OPTIONS,
} from '@/lib/platforms/sermon-audio-cross-publish';
import type {
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
  const nextPlatform = { ...current?.[platform], ...patch };
  return { ...current, [platform]: nextPlatform };
}

interface CrossPublishToggleRowProps {
  /** Stable id for the switch input. */
  id: string;
  /** Visible label for the option. */
  label: string;
  /** Whether the switch is on. */
  checked: boolean;
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
  onCheckedChange,
}: CrossPublishToggleRowProps) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-background px-2.5 py-1.5"
    >
      <span className="relative inline-flex shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-label={label}
          checked={checked}
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
                ...crossPublish,
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
          <p className="text-xs text-muted-foreground">
            Optional posts to social platforms connected in your SermonAudio dashboard. SermonAudio
            will error if a selected platform is not linked there.
          </p>
          {SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS.map((destination) => {
            const platformSettings = crossPublish?.[destination.id];
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
                className="space-y-2 rounded-md border border-border/80 bg-muted/20 p-3"
              >
                <p className="text-sm font-medium text-foreground">{destination.label}</p>
                <div className="space-y-2">
                  {destination.options.map((option) => {
                    const optionSwitchId = `draft-sa-cross-publish-${destination.id}-${option.id}`;
                    const checked = platformSettings?.[option.id] === true;

                    return (
                      <CrossPublishToggleRow
                        key={option.id}
                        id={optionSwitchId}
                        label={option.label}
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          onChange(
                            patchCrossPublishPlatform(crossPublish, destination.id, {
                              [option.id]: nextChecked,
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
                  {destination.supportsVideoMetadata && uploadFullVideo ? (
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
                  {destination.supportsPrivacy && uploadFullVideo ? (
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
                  {destination.supportsLinkMessage && postLink ? (
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
