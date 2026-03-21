import { describe, it, expect } from 'vitest';
import { buildVimeoCategorySuggestBatchBody } from '@/lib/platforms/vimeo';

describe('buildVimeoCategorySuggestBatchBody', () => {
  it('parses /categories/{slug} into Vimeo batch format', () => {
    expect(buildVimeoCategorySuggestBatchBody('/categories/animation')).toEqual([
      { category: 'animation' },
    ]);
  });

  it('parses plain slug', () => {
    expect(buildVimeoCategorySuggestBatchBody('music')).toEqual([{ category: 'music' }]);
  });

  it('parses subcategory path as two batch entries', () => {
    expect(buildVimeoCategorySuggestBatchBody('/categories/animation/subcategories/2d')).toEqual([
      { category: 'animation' },
      { category: '2d' },
    ]);
  });

  it('parses https://vimeo.com/categories/...', () => {
    expect(buildVimeoCategorySuggestBatchBody('https://vimeo.com/categories/documentary')).toEqual([
      { category: 'documentary' },
    ]);
  });

  it('returns null for unrecognizable strings', () => {
    expect(buildVimeoCategorySuggestBatchBody('')).toBeNull();
    expect(buildVimeoCategorySuggestBatchBody('   ')).toBeNull();
    expect(buildVimeoCategorySuggestBatchBody('/foo/bar')).toBeNull();
  });
});
