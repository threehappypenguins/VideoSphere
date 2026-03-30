import { describe, it, expect } from 'vitest';
import { latestPlatformUploadsPerPlatform } from '@/lib/utils/platform-uploads';

describe('latestPlatformUploadsPerPlatform', () => {
  it('keeps the row with the greatest $updatedAt per platform', () => {
    const rows = [
      { platform: 'youtube' as const, $updatedAt: '2026-01-01T00:00:00.000Z', n: 1 },
      { platform: 'youtube' as const, $updatedAt: '2026-01-03T00:00:00.000Z', n: 2 },
      { platform: 'vimeo' as const, $updatedAt: '2026-01-02T00:00:00.000Z', n: 3 },
    ];
    const latest = latestPlatformUploadsPerPlatform(rows);
    expect(latest).toHaveLength(2);
    expect(latest.find((r) => r.platform === 'youtube')?.n).toBe(2);
    expect(latest.find((r) => r.platform === 'vimeo')?.n).toBe(3);
  });

  it('replaces an unparseable incumbent only when the challenger has a parseable $updatedAt', () => {
    const rows = [
      { platform: 'youtube' as const, $updatedAt: 'not-a-date', n: 1 },
      { platform: 'youtube' as const, $updatedAt: '2026-01-05T00:00:00.000Z', n: 2 },
    ];
    const latest = latestPlatformUploadsPerPlatform(rows);
    expect(latest.find((r) => r.platform === 'youtube')?.n).toBe(2);
  });

  it('keeps the first row when both $updatedAt values are unparseable', () => {
    const rows = [
      { platform: 'youtube' as const, $updatedAt: 'not-a-date', n: 1 },
      { platform: 'youtube' as const, $updatedAt: 'also-bad', n: 2 },
    ];
    const latest = latestPlatformUploadsPerPlatform(rows);
    expect(latest.find((r) => r.platform === 'youtube')?.n).toBe(1);
  });

  it('keeps a parseable row when the challenger $updatedAt is unparseable', () => {
    const rows = [
      { platform: 'youtube' as const, $updatedAt: '2026-01-05T00:00:00.000Z', n: 1 },
      { platform: 'youtube' as const, $updatedAt: 'not-a-date', n: 2 },
    ];
    const latest = latestPlatformUploadsPerPlatform(rows);
    expect(latest.find((r) => r.platform === 'youtube')?.n).toBe(1);
  });
});
