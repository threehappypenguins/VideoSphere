import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DraftPlatformToggles } from '@/components/drafts/DraftPlatformToggles';
import type { ConnectedAccountPlatform } from '@/types';

function getToggleLabelsInSection(sectionTitle: string): string[] {
  const section = screen.getByRole('heading', { name: sectionTitle, level: 3 }).closest('section');
  if (!section) {
    throw new Error(`Section not found for heading: ${sectionTitle}`);
  }

  return Array.from(section.querySelectorAll('input[type="checkbox"]'))
    .map((element) => element.getAttribute('aria-label'))
    .filter((label): label is string => Boolean(label?.startsWith('Toggle ')))
    .map((label) => label.replace(/^Toggle /, '').replace(/ platform$/, ''));
}

describe('DraftPlatformToggles', () => {
  const defaultProps = {
    selectedPlatforms: [] as ConnectedAccountPlatform[],
    connectedPlatforms: ['youtube', 'google_drive'] as ConnectedAccountPlatform[],
    connectionsResolved: true,
    onToggle: vi.fn(),
    onConnectClick: vi.fn(),
    youtubeIsShort: false,
    onYouTubeShortsToggle: vi.fn(),
  };

  it('renders Video Platforms and Backup sections in alphabetical order', () => {
    render(
      <DraftPlatformToggles
        {...defaultProps}
        availablePlatforms={[
          'youtube',
          'google_drive',
          'facebook',
          'vimeo',
          'sermon_audio',
          'sftp',
          'smb',
        ]}
      />
    );

    expect(screen.getByRole('heading', { name: 'Video Platforms', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Backup', level: 3 })).toBeInTheDocument();
    expect(getToggleLabelsInSection('Video Platforms')).toEqual([
      'Facebook',
      'SermonAudio',
      'Vimeo',
      'YouTube',
    ]);
    expect(getToggleLabelsInSection('Backup')).toEqual([
      'Google Drive',
      'SFTP Server',
      'SMB / Network Share',
    ]);
  });
});
