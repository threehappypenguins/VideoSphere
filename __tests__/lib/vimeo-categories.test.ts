import { describe, it, expect } from 'vitest';
import {
  addVimeoCategoryUri,
  countVimeoCategoryBatchEntries,
  isVimeoCategoryBatchAtLimit,
  isVimeoSubcategoryUri,
  parseVimeoCategorySlugs,
  removeVimeoCategoryUri,
  vimeoCategoryChipLabelForUri,
  vimeoCategoryLabelForUri,
  wouldAddingVimeoCategoryExceedLimit,
  type VimeoCategoryOption,
} from '@/lib/platforms/vimeo-categories';

const categories: VimeoCategoryOption[] = [
  {
    uri: '/categories/animation',
    name: 'Animation',
    subcategories: [{ uri: '/categories/animation/subcategories/2d', name: '2D' }],
  },
  {
    uri: '/categories/music',
    name: 'Music',
    subcategories: [],
  },
];

describe('vimeoCategoryLabelForUri', () => {
  it('returns top-level category names', () => {
    expect(vimeoCategoryLabelForUri('/categories/music', categories)).toBe('Music');
  });

  it('returns parent and subcategory labels', () => {
    expect(vimeoCategoryLabelForUri('/categories/animation/subcategories/2d', categories)).toBe(
      'Animation › 2D'
    );
  });

  it('falls back to slug parsing for unknown URIs', () => {
    expect(vimeoCategoryLabelForUri('/categories/documentary', categories)).toBe('documentary');
  });
});

describe('countVimeoCategoryBatchEntries', () => {
  it('counts top-level categories as one slot each', () => {
    expect(countVimeoCategoryBatchEntries(['/categories/music', '/categories/animation'])).toBe(2);
  });

  it('counts subcategories as parent plus subcategory slots', () => {
    expect(countVimeoCategoryBatchEntries(['/categories/animation/subcategories/2d'])).toBe(2);
  });

  it('deduplicates shared parent slugs across subcategories', () => {
    expect(
      countVimeoCategoryBatchEntries([
        '/categories/animation/subcategories/2d',
        '/categories/animation/subcategories/3d',
      ])
    ).toBe(3);
  });
});

describe('wouldAddingVimeoCategoryExceedLimit', () => {
  it('blocks selections that would exceed six batch slots', () => {
    const current = [
      '/categories/a/subcategories/1',
      '/categories/b/subcategories/2',
      '/categories/c/subcategories/3',
    ];
    expect(
      wouldAddingVimeoCategoryExceedLimit(current, '/categories/d/subcategories/4', categories)
    ).toBe(true);
  });

  it('counts auto-added parent tags when checking subcategory limits', () => {
    expect(
      wouldAddingVimeoCategoryExceedLimit(
        [
          '/categories/a',
          '/categories/a/subcategories/1',
          '/categories/b',
          '/categories/b/subcategories/2',
          '/categories/c',
          '/categories/c/subcategories/3',
        ],
        '/categories/animation/subcategories/2d',
        categories
      )
    ).toBe(true);
  });

  it('allows deselecting an already selected category', () => {
    expect(
      wouldAddingVimeoCategoryExceedLimit(['/categories/music'], '/categories/music', categories)
    ).toBe(false);
  });
});

describe('parseVimeoCategorySlugs', () => {
  it('parses short-form subcategory URIs without /subcategories/ in the path', () => {
    expect(parseVimeoCategorySlugs('/categories/brandedcontent/brandeddoc')).toEqual([
      'brandedcontent',
      'brandeddoc',
    ]);
    expect(isVimeoSubcategoryUri('/categories/brandedcontent/brandeddoc')).toBe(true);
  });
});

describe('addVimeoCategoryUri', () => {
  it('adds separate parent and subcategory tags when selecting a subcategory', () => {
    expect(addVimeoCategoryUri([], '/categories/animation/subcategories/2d', categories)).toEqual([
      '/categories/animation',
      '/categories/animation/subcategories/2d',
    ]);
  });
});

describe('removeVimeoCategoryUri', () => {
  it('removes a parent category and all of its subcategory tags', () => {
    expect(
      removeVimeoCategoryUri(
        ['/categories/animation', '/categories/animation/subcategories/2d', '/categories/music'],
        '/categories/animation',
        categories
      )
    ).toEqual(['/categories/music']);
  });

  it('removes only one subcategory tag when its chip is dismissed', () => {
    expect(
      removeVimeoCategoryUri(
        ['/categories/animation', '/categories/animation/subcategories/2d'],
        '/categories/animation/subcategories/2d',
        categories
      )
    ).toEqual(['/categories/animation']);
  });
});

describe('vimeoCategoryChipLabelForUri', () => {
  it('returns separate parent and subcategory chip labels', () => {
    expect(vimeoCategoryChipLabelForUri('/categories/animation', categories)).toBe('Animation');
    expect(vimeoCategoryChipLabelForUri('/categories/animation/subcategories/2d', categories)).toBe(
      '2D'
    );
  });
});

describe('isVimeoCategoryBatchAtLimit', () => {
  it('returns true when six slots are used', () => {
    expect(
      isVimeoCategoryBatchAtLimit([
        '/categories/a/subcategories/1',
        '/categories/b/subcategories/2',
        '/categories/c/subcategories/3',
      ])
    ).toBe(true);
  });
});
