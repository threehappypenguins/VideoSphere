import { describe, expect, it } from 'vitest';
import { formatVideoDuration } from '@/lib/format-video-duration';

describe('formatVideoDuration', () => {
  it('formats sub-hour durations as M:SS', () => {
    expect(formatVideoDuration(0)).toBe('0:00');
    expect(formatVideoDuration(45)).toBe('0:45');
    expect(formatVideoDuration(125)).toBe('2:05');
    expect(formatVideoDuration(3599)).toBe('59:59');
  });

  it('formats hour-plus durations as H:MM:SS', () => {
    expect(formatVideoDuration(3600)).toBe('1:00:00');
    expect(formatVideoDuration(3661)).toBe('1:01:01');
    expect(formatVideoDuration(6667)).toBe('1:51:07');
  });

  it('floors fractional seconds', () => {
    expect(formatVideoDuration(125.9)).toBe('2:05');
  });
});
