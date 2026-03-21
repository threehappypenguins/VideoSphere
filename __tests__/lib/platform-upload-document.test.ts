import { describe, it, expect } from 'vitest';
import {
  platformUploadDocumentFromRow,
  stringifyPlatformUploadDocumentForStorage,
} from '@/lib/platform-upload-document';

describe('platform-upload-document', () => {
  it('stringify and parse round-trip', () => {
    const doc = {
      title: 'T',
      description: 'D',
      tags: ['a', 'b'],
      visibility: 'unlisted' as const,
    };
    const s = stringifyPlatformUploadDocumentForStorage(doc);
    const row = { document: s };
    const parsed = platformUploadDocumentFromRow(row);
    expect(parsed).toEqual({ ...doc, tags: ['a', 'b'] });
  });

  it('round-trip includes optional YouTube and Vimeo fields', () => {
    const yt = {
      title: 'T',
      description: 'D',
      tags: [] as string[],
      visibility: 'public' as const,
      categoryId: '22',
      madeForKids: true,
    };
    const ytParsed = platformUploadDocumentFromRow({
      document: stringifyPlatformUploadDocumentForStorage(yt),
    });
    expect(ytParsed).toEqual(yt);

    const vm = {
      title: 'T',
      description: 'D',
      tags: ['x'],
      visibility: 'private' as const,
      vimeoCategoryUri: '/categories/animation',
    };
    expect(
      platformUploadDocumentFromRow({ document: stringifyPlatformUploadDocumentForStorage(vm) })
    ).toEqual(vm);
  });

  it('returns empty defaults when document missing', () => {
    expect(platformUploadDocumentFromRow({})).toMatchObject({
      title: '',
      description: '',
      tags: [],
    });
  });
});
