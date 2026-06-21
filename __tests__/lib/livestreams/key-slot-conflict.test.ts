import { describe, expect, it } from 'vitest';

import {
  findLivestreamKeySlotConflict,
  livestreamKeySlotConflictWarning,
} from '@/lib/livestreams/key-slot-conflict';
import type { Livestream } from '@/types';

function armedRow(
  overrides: Partial<Livestream> & Pick<Livestream, 'id' | 'status' | 'keySlot'>
): Pick<Livestream, 'id' | 'title' | 'keySlot' | 'status'> {
  return {
    title: 'Sunday Service',
    ...overrides,
  };
}

describe('findLivestreamKeySlotConflict', () => {
  it('returns null when no other armed livestream uses the slot', () => {
    const armed = [
      armedRow({ id: 'a', status: 'scheduled', keySlot: 'main' }),
      armedRow({ id: 'b', status: 'ended', keySlot: 'temp' }),
    ];

    expect(findLivestreamKeySlotConflict(armed, 'temp', 'current')).toBeNull();
  });

  it('detects another scheduled livestream on the target slot', () => {
    const armed = [
      armedRow({ id: 'other', status: 'scheduled', keySlot: 'temp', title: 'Youth Night' }),
    ];

    expect(findLivestreamKeySlotConflict(armed, 'temp', 'current')).toEqual({
      id: 'other',
      title: 'Youth Night',
      keySlot: 'temp',
    });
  });

  it('detects live livestreams and excludes the current row', () => {
    const armed = [
      armedRow({ id: 'self', status: 'live', keySlot: 'main' }),
      armedRow({ id: 'other', status: 'live', keySlot: 'main', title: '  ' }),
    ];

    expect(findLivestreamKeySlotConflict(armed, 'main', 'self')).toEqual({
      id: 'other',
      title: 'Untitled livestream',
      keySlot: 'main',
    });
  });
});

describe('livestreamKeySlotConflictWarning', () => {
  it('uses YouTube-style multiple-streams wording for the main key', () => {
    expect(
      livestreamKeySlotConflictWarning({
        id: 'x',
        title: 'Morning Worship',
        keySlot: 'main',
      })
    ).toBe(
      '"Morning Worship" is already scheduled with the main stream key. YouTube may detect multiple streams using the same stream key.'
    );
  });

  it('uses temporary label for the temp key', () => {
    expect(
      livestreamKeySlotConflictWarning({
        id: 'x',
        title: 'Evening Service',
        keySlot: 'temp',
      })
    ).toContain('temporary stream key');
  });
});
