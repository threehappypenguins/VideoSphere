import { describe, it, expect } from 'vitest';
import { nextYouTubeChunkSize } from '@/lib/platforms/youtube';

describe('nextYouTubeChunkSize', () => {
  it('returns remaining when smaller than 256 KiB (last chunk)', () => {
    expect(nextYouTubeChunkSize(100)).toBe(100);
    expect(nextYouTubeChunkSize(256 * 1024 - 1)).toBe(256 * 1024 - 1);
  });

  it('aligns to 256 KiB multiples up to 8 MiB target', () => {
    expect(nextYouTubeChunkSize(256 * 1024)).toBe(256 * 1024);
    expect(nextYouTubeChunkSize(8 * 1024 * 1024)).toBe(8 * 1024 * 1024);
    expect(nextYouTubeChunkSize(8 * 1024 * 1024 + 100)).toBe(8 * 1024 * 1024);
  });
});
