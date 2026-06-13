import { describe, it, expect } from 'vitest';
import {
  MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS,
  platformUploadDocumentFromRow,
  serializePlatformUploadDocumentForStorage,
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
      vimeoCategoryUris: ['/categories/animation'],
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

  it('serializePlatformUploadDocumentForStorage keeps JSON within storage max', () => {
    const huge = 'x'.repeat(20_000);
    const json = serializePlatformUploadDocumentForStorage({
      title: 't',
      description: huge,
      tags: ['a'],
      visibility: 'public',
      draftYoutube: { playlistTitles: [huge.slice(0, 5000)] },
    });
    expect(json.length).toBeLessThanOrEqual(MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS);
    const parsed = JSON.parse(json) as { __documentStorageTruncated?: boolean };
    expect(parsed.__documentStorageTruncated).toBe(true);
  });

  it('parse ignores __documentStorageTruncated helper key from stored JSON', () => {
    const json = serializePlatformUploadDocumentForStorage({
      title: 'ok',
      description: 'x'.repeat(25_000),
      tags: [],
      visibility: 'public',
    });
    const row = { document: json };
    const parsed = platformUploadDocumentFromRow(row);
    expect(parsed.title).toBe('ok');
    expect(parsed.description.length).toBeLessThan(25_000);
  });

  it('serializePlatformUploadDocumentForStorage retains sermonAudioAutoPublishOnProcessed when truncating', () => {
    const huge = 'x'.repeat(25_000);
    const json = serializePlatformUploadDocumentForStorage({
      title: 'Sermon title',
      description: huge,
      tags: ['faith', 'hope'],
      visibility: 'public',
      draftYoutube: { playlistTitles: [huge.slice(0, 5000)] },
      sermonAudioAutoPublishOnProcessed: true,
    });

    expect(json.length).toBeLessThanOrEqual(MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS);
    const parsed = platformUploadDocumentFromRow({ document: json });
    expect(parsed.sermonAudioAutoPublishOnProcessed).toBe(true);
  });
});
