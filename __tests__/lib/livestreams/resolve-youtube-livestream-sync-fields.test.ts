import { describe, expect, it } from 'vitest';

import { resolveYouTubeCategoryIdForLivestreamSync } from '@/lib/livestreams/resolve-youtube-livestream-sync-fields';

describe('resolveYouTubeCategoryIdForLivestreamSync', () => {
  it('prefers the livestream platform category over profile defaults', () => {
    expect(
      resolveYouTubeCategoryIdForLivestreamSync({ categoryId: '22' }, { categoryId: '24' })
    ).toBe('22');
  });

  it('falls back to profile defaults when the livestream row has no category', () => {
    expect(resolveYouTubeCategoryIdForLivestreamSync({}, { categoryId: '22' })).toBe('22');
  });

  it('falls back to People & Blogs when nothing is configured', () => {
    expect(resolveYouTubeCategoryIdForLivestreamSync(undefined, undefined)).toBe('22');
  });
});
