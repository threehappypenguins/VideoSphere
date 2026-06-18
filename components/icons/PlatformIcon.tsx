import type { FC, SVGProps } from 'react';
import type { ConnectedAccountPlatform } from '@/types';
import { platformLabel } from '@/lib/ui/platform-label';
import { cn } from '@/lib/utils';

import YoutubeIcon from '@/components/icons/platforms/youtube.svg';
import YoutubeShortsIcon from '@/components/icons/platforms/youtube-shorts.svg';
import VimeoIcon from '@/components/icons/platforms/vimeo.svg';
import SermonAudioIcon from '@/components/icons/platforms/sermon-audio.svg';
import FacebookIcon from '@/components/icons/platforms/facebook.svg';
import GoogleDriveIcon from '@/components/icons/platforms/google-drive.svg';

/** Platform identifier backed by a brand icon SVG. */
export type PlatformBrandIcon = (typeof PLATFORM_BRAND_ICONS)[number];

/** Platforms that have a dedicated brand icon asset in this app. */
export const PLATFORM_BRAND_ICONS = [
  'youtube',
  'vimeo',
  'google_drive',
  'sermon_audio',
  'facebook',
] as const;

type PlatformSvgComponent = FC<SVGProps<SVGSVGElement>>;

const PLATFORM_ICONS: Record<PlatformBrandIcon, PlatformSvgComponent> = {
  youtube: YoutubeIcon,
  vimeo: VimeoIcon,
  google_drive: GoogleDriveIcon,
  sermon_audio: SermonAudioIcon,
  facebook: FacebookIcon,
};

/** Emoji icons for platforms without a dedicated brand SVG (matches Connections page). */
const PLATFORM_EMOJI_ICONS: Partial<Record<ConnectedAccountPlatform, string>> = {
  sftp: '🖥️',
  smb: '🗄️',
};

/**
 * Returns whether a connected platform has a brand icon asset.
 * @param platform - Connected platform identifier.
 * @returns True when {@link PlatformIcon} can render for the platform.
 */
export function isPlatformBrandIcon(
  platform: ConnectedAccountPlatform
): platform is PlatformBrandIcon {
  return (PLATFORM_BRAND_ICONS as readonly string[]).includes(platform);
}

interface PlatformIconProps {
  /** Platform whose brand icon should be shown. */
  platform: PlatformBrandIcon;
  /** Rendered width and height in pixels. */
  size?: number;
  /** Optional class names for the icon image. */
  className?: string;
  /** When true, the icon is hidden from assistive technology. */
  decorative?: boolean;
  /** When true and platform is 'youtube', render the YouTube Shorts icon instead. */
  isShort?: boolean;
}

/**
 * Renders a platform brand icon from the shared SVG assets.
 * @param props - Component props.
 * @returns The platform icon image.
 */
export function PlatformIcon({
  platform,
  size = 28,
  className,
  decorative = true,
  isShort,
}: PlatformIconProps) {
  const Icon = platform === 'youtube' && isShort ? YoutubeShortsIcon : PLATFORM_ICONS[platform];

  return (
    <Icon
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      {...(decorative
        ? { 'aria-hidden': true as const }
        : { role: 'img' as const, 'aria-label': platformLabel(platform) })}
    />
  );
}

/**
 * Renders the human-readable platform name in a compact badge.
 * @param platform - Platform whose label should be shown.
 * @param className - Optional class names for the badge.
 * @returns Platform name badge element.
 */
function PlatformNameBadge({
  platform,
  className,
}: {
  platform: PlatformBrandIcon;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground',
        className
      )}
    >
      {platformLabel(platform)}
    </span>
  );
}

interface PlatformSectionHeaderProps {
  /** Platform whose section header icon should be shown. */
  platform: PlatformBrandIcon;
  /** Optional class names for the header wrapper. */
  className?: string;
  /** When true and platform is 'youtube', render the YouTube Shorts icon instead. */
  isShort?: boolean;
}

/**
 * Renders a platform section divider header with brand icon and name badge.
 * @param props - Component props.
 * @returns Section header with icon and platform badge.
 */
export function PlatformSectionHeader({
  platform,
  className,
  isShort,
}: PlatformSectionHeaderProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <PlatformIcon platform={platform} size={36} isShort={isShort} />
      <PlatformNameBadge platform={platform} className="text-sm" />
    </div>
  );
}

interface PlatformOverrideLabelProps {
  /** Platform this per-platform field belongs to. */
  platform: PlatformBrandIcon;
  /** Optional suffix text shown after the icon (for example, " (hashtags)"). */
  suffix?: string;
  /** Optional class names for the label wrapper. */
  className?: string;
  /** When true and platform is 'youtube', render the YouTube Shorts icon instead. */
  isShort?: boolean;
}

/**
 * Renders an icon and platform badge for per-platform override fields (title, tags, etc.).
 * @param props - Component props.
 * @returns Label content with icon, platform badge, and optional suffix.
 */
export function PlatformOverrideLabel({
  platform,
  suffix,
  className,
  isShort,
}: PlatformOverrideLabelProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <PlatformIcon platform={platform} size={28} isShort={isShort} />
      <PlatformNameBadge platform={platform} />
      {suffix ? <span className="text-xs font-medium text-muted-foreground">{suffix}</span> : null}
    </span>
  );
}

interface PlatformTargetIconProps {
  /** Publish or backup platform whose icon should be shown. */
  platform: ConnectedAccountPlatform;
  /** Rendered width and height in pixels. */
  size?: number;
  /** When true and platform is `youtube`, render the YouTube Shorts icon instead. */
  isShort?: boolean;
  /** Optional class names for the icon wrapper. */
  className?: string;
}

/**
 * Renders a platform icon for lists and toggles: brand SVG when available, otherwise emoji (SFTP/SMB).
 * @param props - Component props.
 * @returns Platform icon element, or null when no icon is defined for the platform.
 */
export function PlatformTargetIcon({
  platform,
  size = 28,
  isShort,
  className,
}: PlatformTargetIconProps) {
  if (isPlatformBrandIcon(platform)) {
    return <PlatformIcon platform={platform} size={size} isShort={isShort} className={className} />;
  }

  const emoji = PLATFORM_EMOJI_ICONS[platform];
  if (emoji) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md bg-muted leading-none',
          className
        )}
        style={{ width: size, height: size, fontSize: Math.max(14, Math.round(size * 0.5)) }}
        aria-hidden
      >
        {emoji}
      </span>
    );
  }

  return null;
}

interface TitleTargetPlatformLabelProps {
  /** Platform this per-target title field belongs to (publish or backup). */
  platform: ConnectedAccountPlatform;
  /** When true and platform is `youtube`, render the YouTube Shorts icon instead. */
  isShort?: boolean;
  /** Optional class names for the label wrapper. */
  className?: string;
}

/**
 * Renders icon and platform badge for per-target title fields across publish and backup destinations.
 * @param props - Component props.
 * @returns Label content with brand SVG, emoji icon, or text fallback.
 */
export function TitleTargetPlatformLabel({
  platform,
  isShort,
  className,
}: TitleTargetPlatformLabelProps) {
  if (isPlatformBrandIcon(platform)) {
    return <PlatformOverrideLabel platform={platform} isShort={isShort} className={className} />;
  }

  const emoji = PLATFORM_EMOJI_ICONS[platform];
  if (emoji) {
    return (
      <span className={cn('inline-flex items-center gap-2', className)}>
        <PlatformTargetIcon platform={platform} />
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
          {platformLabel(platform)}
        </span>
      </span>
    );
  }

  return (
    <span className={cn('text-xs font-medium text-muted-foreground', className)}>
      {platformLabel(platform)}
    </span>
  );
}
