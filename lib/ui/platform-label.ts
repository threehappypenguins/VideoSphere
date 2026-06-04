import type { ConnectedAccountPlatform } from '@/types';

/**
 * Defines the PLATFORM_LABELS constant.
 */
export const PLATFORM_LABELS: Record<ConnectedAccountPlatform, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  google_drive: 'Google Drive',
  sftp: 'SFTP Server',
};

/**
 * Executes platform label.
 * @param platform - Input value for platform.
 * @returns The computed result.
 */
export function platformLabel(platform: ConnectedAccountPlatform): string {
  return PLATFORM_LABELS[platform];
}
