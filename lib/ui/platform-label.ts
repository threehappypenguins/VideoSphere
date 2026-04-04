import type { ConnectedAccountPlatform } from '@/types';

export const PLATFORM_LABELS: Record<ConnectedAccountPlatform, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  google_drive: 'Google Drive',
};

export function platformLabel(platform: ConnectedAccountPlatform): string {
  return PLATFORM_LABELS[platform];
}
