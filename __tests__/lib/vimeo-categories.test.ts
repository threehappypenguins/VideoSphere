import { describe, it, expect } from 'vitest';
import {
  vimeoCategoryLabelForUri,
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
