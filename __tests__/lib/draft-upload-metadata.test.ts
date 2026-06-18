import { describe, it, expect } from 'vitest';
import {
  assertDraftDocumentJsonWithinLimit,
  buildMetadataForPlatform,
  DraftDocumentTooLargeError,
  draftDocumentFromRow,
  MAX_DRAFT_DOCUMENT_CHARS,
  mergeDraftPlatforms,
  mergeDraftPlatformsPatch,
  normalizeDraftPlatforms,
  parseDraftTargetsAllowEmpty,
  parseDraftTargetsFromRequestBody,
  draftHasPersistableTitle,
  parseDraftPlatformsPatchBody,
  parsePlatformsFromRequestBody,
  parseTagsFromRequestBody,
  resolveDraftTitleForStorage,
  stringifyDraftDocumentForStorage,
  visibilityFromRow,
} from '@/lib/draft-upload-metadata';
import type { Draft, DraftPlatforms } from '@/types';

describe('draft-upload-metadata', () => {
  it('resolveDraftTitleForStorage prefers shared title when set', () => {
    expect(
      resolveDraftTitleForStorage({
        title: ' Shared ',
        targets: ['youtube', 'vimeo'],
        platforms: {
          youtube: { titleOverride: 'YouTube only' },
        },
      })
    ).toBe('Shared');
  });

  it('resolveDraftTitleForStorage uses first non-empty override when shared title is empty', () => {
    expect(
      resolveDraftTitleForStorage({
        title: '',
        targets: ['youtube', 'vimeo', 'sermon_audio'],
        platforms: {
          vimeo: { titleOverride: 'Vimeo Title' },
          youtube: { titleOverride: 'YouTube Title' },
          sermon_audio: { titleOverride: 'SA Title' },
        },
      })
    ).toBe('YouTube Title');
  });

  it('resolveDraftTitleForStorage skips empty overrides and unselected targets', () => {
    expect(
      resolveDraftTitleForStorage({
        title: '   ',
        targets: ['facebook'],
        platforms: {
          youtube: { titleOverride: 'YouTube Title' },
          facebook: { titleOverride: 'Facebook Title' },
        },
      })
    ).toBe('Facebook Title');

    expect(
      draftHasPersistableTitle({
        title: '',
        targets: ['youtube'],
        platforms: { youtube: { titleOverride: '   ' } },
      })
    ).toBe(false);
  });

  it('assertDraftDocumentJsonWithinLimit throws when JSON exceeds storage column max', () => {
    const huge = 'z'.repeat(MAX_DRAFT_DOCUMENT_CHARS + 1);
    expect(() => assertDraftDocumentJsonWithinLimit(huge)).toThrow(DraftDocumentTooLargeError);
  });

  it('draftDocumentFromRow parses document JSON with top-level tags', () => {
    const doc = stringifyDraftDocumentForStorage({
      targets: ['youtube', 'vimeo'],
      title: 'T',
      description: 'D',
      visibility: 'unlisted',
      tags: ['a', 'b'],
      platforms: { vimeo: { categoryUris: ['/categories/1'] } },
    });
    const row = { document: doc };
    expect(draftDocumentFromRow(row)).toEqual({
      targets: ['youtube', 'vimeo'],
      title: 'T',
      description: 'D',
      visibility: 'unlisted',
      tags: ['a', 'b'],
      platforms: { vimeo: { categoryUris: ['/categories/1'] } },
    });
  });

  it('draftDocumentFromRow ignores extra top-level row keys', () => {
    const doc = stringifyDraftDocumentForStorage({
      targets: ['youtube'],
      title: 'Only',
      description: '',
      visibility: 'private',
      tags: [],
      platforms: {},
    });
    expect(
      draftDocumentFromRow({
        document: doc,
        title: 'IGNORED',
        description: 'IGNORED',
      }).title
    ).toBe('Only');
  });

  it('normalizeDraftPlatforms dedupes vimeo categoryUris in first-seen order', () => {
    expect(
      normalizeDraftPlatforms({
        vimeo: {
          categoryUris: [
            '/categories/animation',
            ' /categories/animation ',
            '/categories/music',
            '/categories/animation',
          ],
        },
      })
    ).toEqual({
      vimeo: { categoryUris: ['/categories/animation', '/categories/music'] },
    });
  });

  it('draftDocumentFromRow uses defaults when missing or invalid', () => {
    expect(draftDocumentFromRow({})).toEqual({
      targets: [],
      title: '',
      description: '',
      visibility: 'public',
      tags: [],
      platforms: {},
    });
    expect(draftDocumentFromRow({ document: 'not-json' })).toEqual({
      targets: [],
      title: '',
      description: '',
      visibility: 'public',
      tags: [],
      platforms: {},
    });
  });

  it('draftDocumentFromRow migrates legacy per-platform tags to top-level tags', () => {
    const legacy = JSON.stringify({
      targets: ['youtube'],
      title: 'L',
      description: '',
      visibility: 'public',
      platforms: { youtube: { categoryId: '22', tags: ['legacy'] } },
    });
    expect(draftDocumentFromRow({ document: legacy }).tags).toEqual(['legacy']);
  });

  it('visibilityFromRow defaults invalid values to public', () => {
    expect(visibilityFromRow(undefined)).toBe('public');
    expect(visibilityFromRow('')).toBe('public');
    expect(visibilityFromRow('secret')).toBe('public');
    expect(visibilityFromRow('public')).toBe('public');
  });

  it('parseDraftTargetsFromRequestBody rejects invalid targets', () => {
    expect(parseDraftTargetsFromRequestBody('x')).toEqual({
      ok: false,
      error: 'targets must be a non-empty array of platform ids',
    });
    expect(parseDraftTargetsFromRequestBody([])).toEqual({
      ok: false,
      error:
        'targets must include at least one of: youtube, vimeo, google_drive, sftp, smb, sermon_audio, facebook',
    });
    expect(parseDraftTargetsFromRequestBody(['youtube', 'youtube'])).toEqual({
      ok: true,
      value: ['youtube'],
    });
  });

  it('parseDraftTargetsAllowEmpty rejects non-array values', () => {
    expect(parseDraftTargetsAllowEmpty('x')).toEqual({
      ok: false,
      error: 'targets must be an array of platform ids',
    });
  });

  it('parseDraftTargetsAllowEmpty rejects unknown platform ids', () => {
    expect(parseDraftTargetsAllowEmpty(['youtube', 'tiktok'])).toEqual({
      ok: false,
      error: 'targets contains unknown platform ids',
    });
  });

  it('parseDraftTargetsAllowEmpty dedupes and allows an empty list', () => {
    expect(parseDraftTargetsAllowEmpty(['youtube', 'youtube', 'vimeo'])).toEqual({
      ok: true,
      value: ['youtube', 'vimeo'],
    });
    expect(parseDraftTargetsAllowEmpty([])).toEqual({
      ok: true,
      value: [],
    });
  });

  it('parseTagsFromRequestBody', () => {
    expect(parseTagsFromRequestBody(undefined)).toEqual({ ok: true, value: [] });
    expect(parseTagsFromRequestBody('x')).toEqual({
      ok: false,
      error: 'tags must be an array of strings',
    });
    expect(parseTagsFromRequestBody(['a', 1, 'b'])).toEqual({ ok: true, value: ['a', 'b'] });
  });

  it('parsePlatformsFromRequestBody rejects non-objects', () => {
    expect(parsePlatformsFromRequestBody('x')).toEqual({
      ok: false,
      error: 'platforms must be a JSON object',
    });
    expect(parsePlatformsFromRequestBody(undefined)).toEqual({ ok: true, value: {} });
  });

  it('parseDraftPlatformsPatchBody keeps empty strings for merge/clear semantics', () => {
    expect(parseDraftPlatformsPatchBody({ vimeo: { categoryUris: [] } })).toEqual({
      ok: true,
      value: { vimeo: { categoryUris: [] } },
    });
    expect(parsePlatformsFromRequestBody({ vimeo: { categoryUris: [] } })).toEqual({
      ok: true,
      value: {},
    });
  });

  it('parseDraftPlatformsPatchBody accepts null as empty patch', () => {
    expect(parseDraftPlatformsPatchBody(null)).toEqual({ ok: true, value: {} });
    expect(parseDraftPlatformsPatchBody('x')).toEqual({
      ok: false,
      error: 'platforms must be a JSON object',
    });
  });

  it('mergeDraftPlatforms deep-merges per platform', () => {
    const base: DraftPlatforms = {
      youtube: { categoryId: '22', madeForKids: false },
      vimeo: { categoryUris: ['/categories/a'] },
    };
    const patch: DraftPlatforms = {
      youtube: { categoryId: '10' },
    };
    expect(mergeDraftPlatforms(base, patch)).toEqual({
      youtube: { categoryId: '10', madeForKids: false },
      vimeo: { categoryUris: ['/categories/a'] },
    });
  });

  it('mergeDraftPlatformsPatch updates only keys present in patch', () => {
    const base: Draft['platforms'] = {
      youtube: { categoryId: '22', madeForKids: true },
    };
    expect(
      mergeDraftPlatformsPatch(base, {
        youtube: { categoryId: '10' },
      })
    ).toEqual({
      youtube: { categoryId: '10', madeForKids: true },
    });
  });

  it('mergeDraftPlatformsPatch can clear categoryUris with empty array', () => {
    const base: Draft['platforms'] = {
      vimeo: { categoryUris: ['/categories/x'] },
    };
    expect(mergeDraftPlatformsPatch(base, { vimeo: { categoryUris: [] } })).toEqual({
      vimeo: { categoryUris: undefined },
    });
  });

  it('mergeDraftPlatformsPatch can clear contentRating with null', () => {
    const base: Draft['platforms'] = {
      vimeo: { contentRating: ['safe'] },
    };
    expect(mergeDraftPlatformsPatch(base, { vimeo: { contentRating: null } })).toEqual({
      vimeo: { contentRating: undefined },
    });
  });

  it('mergeDraftPlatformsPatch dedupes vimeo categoryUris in first-seen order', () => {
    expect(
      mergeDraftPlatformsPatch(
        { vimeo: {} },
        {
          vimeo: {
            categoryUris: [
              '/categories/animation',
              ' /categories/animation ',
              '/categories/music',
              '/categories/animation',
            ],
          },
        }
      )
    ).toEqual({
      vimeo: { categoryUris: ['/categories/animation', '/categories/music'] },
    });
  });

  it('buildMetadataForPlatform copies shared tags to each platform', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube', 'sermon_audio'],
      title: '  Shared Title  ',
      description: '  Shared Description  ',
      tags: [],
      visibility: 'public',
      platforms: {
        youtube: { categoryId: '22' },
        sermon_audio: { speakerName: 'Rev. Smith', preachDate: '2026-06-01' },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'youtube').title).toBe('Shared Title');
    expect(buildMetadataForPlatform(draft, 'youtube').description).toBe('Shared Description');

    const sa = buildMetadataForPlatform(draft, 'sermon_audio');
    expect(sa.title).toBe('Shared Title');
    expect(sa.fullTitle).toBe('Shared Title');
    expect(sa.description).toBe('Shared Description');
    expect(sa.moreInfoText).toBe('Shared Description');
  });

  it('buildMetadataForPlatform uses per-platform visibility overrides for YouTube and Vimeo', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube', 'vimeo'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      platforms: {
        youtube: { visibilityOverride: 'private' },
        vimeo: { visibilityOverride: 'unlisted' },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'youtube').visibility).toBe('private');
    expect(buildMetadataForPlatform(draft, 'vimeo').visibility).toBe('unlisted');
  });

  it('buildMetadataForPlatform uses per-platform thumbnail overrides when set', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube', 'vimeo'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      thumbnailR2Key: 'draft-thumbnails/u1/d1/shared.jpg',
      thumbnailContentType: 'image/jpeg',
      platforms: {
        youtube: {
          thumbnailR2KeyOverride: 'draft-thumbnails/u1/d1/youtube.jpg',
          thumbnailContentTypeOverride: 'image/png',
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'youtube').thumbnailR2Key).toBe(
      'draft-thumbnails/u1/d1/youtube.jpg'
    );
    expect(buildMetadataForPlatform(draft, 'youtube').thumbnailContentType).toBe('image/png');
    expect(buildMetadataForPlatform(draft, 'vimeo').thumbnailR2Key).toBe(
      'draft-thumbnails/u1/d1/shared.jpg'
    );
  });

  it('buildMetadataForPlatform does not fall back to shared thumbnail when override is explicitly empty', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube', 'vimeo'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      thumbnailR2Key: 'draft-thumbnails/u1/d1/shared.jpg',
      thumbnailContentType: 'image/jpeg',
      platforms: {
        youtube: { thumbnailR2KeyOverride: '' },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'youtube').thumbnailR2Key).toBeUndefined();
    expect(buildMetadataForPlatform(draft, 'vimeo').thumbnailR2Key).toBe(
      'draft-thumbnails/u1/d1/shared.jpg'
    );
  });

  it('buildMetadataForPlatform falls back to shared thumbnail when override is null', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube', 'vimeo'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      thumbnailR2Key: 'draft-thumbnails/u1/d1/shared.jpg',
      thumbnailContentType: 'image/jpeg',
      platforms: {
        youtube: {
          thumbnailR2KeyOverride: null,
          thumbnailContentTypeOverride: null,
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'youtube').thumbnailR2Key).toBe(
      'draft-thumbnails/u1/d1/shared.jpg'
    );
    expect(buildMetadataForPlatform(draft, 'youtube').thumbnailContentType).toBe('image/jpeg');
  });

  it('normalizeDraftPlatforms preserves explicit empty thumbnailR2KeyOverride', () => {
    expect(
      normalizeDraftPlatforms({
        youtube: { thumbnailR2KeyOverride: '' },
        facebook: {
          thumbnailR2KeyOverride: '',
          thumbnailContentTypeOverride: '',
        },
      })
    ).toEqual({
      youtube: { thumbnailR2KeyOverride: '' },
      facebook: {
        thumbnailR2KeyOverride: '',
        thumbnailContentTypeOverride: '',
      },
    });
  });

  it('draftDocumentFromRow preserves explicit empty thumbnailR2KeyOverride', () => {
    const doc = draftDocumentFromRow({
      document: JSON.stringify({
        targets: ['youtube'],
        title: 'T',
        description: 'D',
        visibility: 'public',
        tags: [],
        thumbnailR2Key: 'draft-thumbnails/u1/d1/shared.jpg',
        platforms: {
          youtube: { thumbnailR2KeyOverride: '' },
        },
      }),
    });

    expect(doc.platforms.youtube).toEqual({ thumbnailR2KeyOverride: '' });
    expect(doc.thumbnailR2Key).toBe('draft-thumbnails/u1/d1/shared.jpg');
  });

  it('mergeDraftPlatformsPatch preserves explicit empty thumbnailR2KeyOverride', () => {
    expect(
      mergeDraftPlatformsPatch(
        {
          youtube: {
            thumbnailR2KeyOverride: 'draft-thumbnails/u1/d1/youtube.jpg',
            thumbnailContentTypeOverride: 'image/jpeg',
          },
        },
        {
          youtube: {
            thumbnailR2KeyOverride: '',
            thumbnailContentTypeOverride: '',
          },
        }
      )
    ).toEqual({
      youtube: {
        thumbnailR2KeyOverride: '',
        thumbnailContentTypeOverride: '',
      },
    });
  });

  it('mergeDraftPlatformsPatch clears thumbnail overrides when patch sends null', () => {
    expect(
      mergeDraftPlatformsPatch(
        {
          youtube: {
            categoryId: '22',
            thumbnailR2KeyOverride: 'draft-thumbnails/u1/d1/youtube.jpg',
            thumbnailContentTypeOverride: 'image/jpeg',
          },
          facebook: {
            thumbnailR2KeyOverride: 'draft-thumbnails/u1/d1/fb.jpg',
          },
        },
        {
          youtube: {
            thumbnailR2KeyOverride: null,
            thumbnailContentTypeOverride: null,
          },
          facebook: {
            thumbnailR2KeyOverride: null,
            thumbnailContentTypeOverride: null,
          },
        }
      )
    ).toEqual({
      youtube: { categoryId: '22' },
      facebook: {},
    });
  });

  it('buildMetadataForPlatform passes playlistTitles and playlistIds for YouTube', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      platforms: {
        youtube: {
          playlistTitles: ['My Show', 'Dup', 'dup'],
          playlistIds: ['PLabc123'],
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };
    const meta = buildMetadataForPlatform(draft, 'youtube');
    expect(meta.playlistTitles).toEqual(['My Show', 'Dup']);
    expect(meta.playlistIds).toEqual(['PLabc123']);
  });

  it('buildMetadataForPlatform passes recordingDate for YouTube when set', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      platforms: {
        youtube: {
          recordingDate: '2025-06-08',
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'youtube').recordingDate).toBe('2025-06-08');
  });

  it('buildMetadataForPlatform omits recordingDate for YouTube when unset', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      platforms: {
        youtube: {},
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'youtube').recordingDate).toBeUndefined();
  });

  it('normalizeDraftPlatforms preserves YouTube recordingDate', () => {
    expect(
      normalizeDraftPlatforms({
        youtube: { recordingDate: '2025-06-08' },
      }).youtube?.recordingDate
    ).toBe('2025-06-08');
  });

  it('mergeDraftPlatformsPatch updates YouTube recordingDate', () => {
    expect(
      mergeDraftPlatformsPatch({ youtube: {} }, { youtube: { recordingDate: '2025-06-08' } })
        .youtube?.recordingDate
    ).toBe('2025-06-08');
  });

  it('mergeDraftPlatformsPatch clears YouTube recordingDate with empty string', () => {
    expect(
      mergeDraftPlatformsPatch(
        { youtube: { recordingDate: '2025-06-08' } },
        { youtube: { recordingDate: '' } }
      ).youtube?.recordingDate
    ).toBeUndefined();
  });

  it('mergeDraftPlatformsPatch persists YouTube isShort when true', () => {
    expect(
      mergeDraftPlatformsPatch({ youtube: {} }, { youtube: { isShort: true } }).youtube?.isShort
    ).toBe(true);
  });

  it('mergeDraftPlatformsPatch clears YouTube isShort when false', () => {
    expect(
      mergeDraftPlatformsPatch({ youtube: { isShort: true } }, { youtube: { isShort: false } })
        .youtube?.isShort
    ).toBeUndefined();
  });

  it('buildMetadataForPlatform passes isShort for YouTube when set', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      platforms: {
        youtube: {
          isShort: true,
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'youtube').isShort).toBe(true);
  });

  it('buildMetadataForPlatform passes notifySubscribers for YouTube when set false', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      platforms: {
        youtube: {
          notifySubscribers: false,
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'youtube').notifySubscribers).toBe(false);
  });

  it('buildMetadataForPlatform omits notifySubscribers for YouTube when unset', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      platforms: {
        youtube: {},
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'youtube').notifySubscribers).toBeUndefined();
  });

  it('buildMetadataForPlatform omits playlistTitles when none are set', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      platforms: { youtube: { categoryId: '22' } },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };
    expect(buildMetadataForPlatform(draft, 'youtube').playlistTitles).toBeUndefined();
  });

  it('normalizeDraftPlatforms trims YouTube playlistTitles and playlistIds', () => {
    const parsed = parsePlatformsFromRequestBody({
      youtube: {
        playlistTitles: ['  a  ', 'b'],
        playlistIds: [' PL1 ', 'PL2'],
      },
    });
    expect(parsed.ok && parsed.value.youtube).toEqual({
      playlistTitles: ['a', 'b'],
      playlistIds: ['PL1', 'PL2'],
    });
  });

  it('normalizeDraftPlatforms preserves platforms.smb as an empty object', () => {
    const parsed = parsePlatformsFromRequestBody({
      youtube: { categoryId: '22' },
      smb: {},
    });
    expect(parsed.ok && parsed.value).toEqual({
      youtube: { categoryId: '22' },
      smb: {},
    });
  });

  it('normalizeDraftPlatforms preserves platforms.sftp as an empty object', () => {
    const parsed = parsePlatformsFromRequestBody({
      youtube: { categoryId: '22' },
      sftp: {},
    });
    expect(parsed.ok && parsed.value).toEqual({
      youtube: { categoryId: '22' },
      sftp: {},
    });
  });

  it('mergeDraftPlatforms carries sftp through', () => {
    const base: DraftPlatforms = {
      youtube: { categoryId: '22' },
      sftp: {},
    };
    expect(mergeDraftPlatforms(base, { sftp: {} })).toEqual({
      youtube: { categoryId: '22' },
      sftp: {},
    });
  });

  it('mergeDraftPlatformsPatch preserves platforms.sftp', () => {
    const base: DraftPlatforms = { youtube: { categoryId: '22' } };
    expect(mergeDraftPlatformsPatch(base, { sftp: {} })).toEqual({
      youtube: { categoryId: '22' },
      sftp: {},
    });
  });

  it('draftDocumentFromRow round-trips platforms.sftp', () => {
    const doc = draftDocumentFromRow({
      document: JSON.stringify({
        targets: ['sftp'],
        title: 'Backup',
        description: '',
        visibility: 'private',
        tags: [],
        platforms: { sftp: {} },
      }),
    });
    expect(doc.platforms.sftp).toEqual({});
  });

  it('buildMetadataForPlatform uses empty tags when draft has none', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['vimeo'],
      title: 'T',
      description: 'D',
      tags: [],
      visibility: 'public',
      platforms: {},
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };
    const meta = buildMetadataForPlatform(draft, 'vimeo');
    expect(meta.tags).toEqual([]);
  });

  it('normalizeDraftPlatforms normalizes sermon_audio fields', () => {
    expect(
      normalizeDraftPlatforms({
        sermon_audio: {
          speakerName: '  Rev. Smith  ',
          speakerID: 42,
          preachDate: '2026-01-15',
          eventType: 'Sunday Service',
          subtitle: ' Faith & Works ',
          seriesID: 12,
          bibleText: 'John 3:16',
          displayTitle: ' Short ',
          languageCode: 'en',
          autoPublishOnProcessed: false,
          publishDate: ' 2026-07-01T09:00:00-04:00 ',
          titleOverride: '  SA Title  ',
          descriptionOverride: ' SA Desc ',
          tagsOverride: ['  holy ', 'day'],
          thumbnailR2KeyOverride: ' draft-thumbnails/u1/d1/sa.jpg ',
          thumbnailContentTypeOverride: ' image/png ',
        },
      })
    ).toEqual({
      sermon_audio: {
        speakerName: 'Rev. Smith',
        speakerID: 42,
        preachDate: '2026-01-15',
        eventType: 'Sunday Service',
        subtitle: 'Faith & Works',
        seriesID: 12,
        bibleText: 'John 3:16',
        displayTitle: 'Short',
        languageCode: 'en',
        autoPublishOnProcessed: false,
        publishDate: '2026-07-01T09:00:00-04:00',
        titleOverride: 'SA Title',
        descriptionOverride: 'SA Desc',
        tagsOverride: ['holy', 'day'],
        thumbnailR2KeyOverride: 'draft-thumbnails/u1/d1/sa.jpg',
        thumbnailContentTypeOverride: 'image/png',
      },
    });
  });

  it('normalizeDraftPlatforms drops visibilityOverride from sermon_audio', () => {
    expect(
      normalizeDraftPlatforms({
        sermon_audio: {
          speakerName: 'Rev. Smith',
          preachDate: '2026-01-15',
          eventType: 'Sunday Service',
          visibilityOverride: 'private',
        },
      })
    ).toEqual({
      sermon_audio: {
        speakerName: 'Rev. Smith',
        preachDate: '2026-01-15',
        eventType: 'Sunday Service',
      },
    });
  });

  it('normalizeDraftPlatforms normalizes sermon_audio crossPublish settings', () => {
    expect(
      normalizeDraftPlatforms({
        sermon_audio: {
          crossPublish: {
            enabled: true,
            facebook: {
              postLink: true,
              uploadFullVideo: true,
              linkMessage: ' Check this out ',
            },
          },
        },
      })
    ).toEqual({
      sermon_audio: {
        crossPublish: {
          enabled: true,
          facebook: {
            postLink: true,
            uploadFullVideo: true,
            linkMessage: 'Check this out',
          },
        },
      },
    });
  });

  it('buildMetadataForPlatform sermon_audio prefers overrides over shared values', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['sermon_audio'],
      title: 'Shared Title',
      description: 'Shared Description',
      tags: ['shared-tag'],
      visibility: 'public',
      platforms: {
        sermon_audio: {
          titleOverride: 'Override Title',
          descriptionOverride: 'Override Description',
          tagsOverride: ['override-tag'],
          speakerName: 'Rev. Smith',
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    const meta = buildMetadataForPlatform(draft, 'sermon_audio');
    expect(meta.title).toBe('Override Title');
    expect(meta.fullTitle).toBe('Override Title');
    expect(meta.description).toBe('Override Description');
    expect(meta.moreInfoText).toBe('Override Description');
    expect(meta.tags).toEqual(['override-tag']);
    expect(meta.speakerName).toBe('Rev. Smith');
  });

  it('buildMetadataForPlatform sermon_audio falls back to shared values when overrides are absent', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['sermon_audio'],
      title: 'Shared Title',
      description: 'Shared Description',
      tags: ['faith', 'hope'],
      visibility: 'public',
      platforms: {
        sermon_audio: {
          speakerName: 'Rev. Smith',
          speakerID: 77,
          preachDate: '2026-06-01',
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    const meta = buildMetadataForPlatform(draft, 'sermon_audio');
    expect(meta.title).toBe('Shared Title');
    expect(meta.fullTitle).toBe('Shared Title');
    expect(meta.description).toBe('Shared Description');
    expect(meta.moreInfoText).toBe('Shared Description');
    expect(meta.tags).toEqual(['faith', 'hope']);
    expect(meta.speakerName).toBe('Rev. Smith');
    expect(meta.speakerID).toBe(77);
    expect(meta.preachDate).toBe('2026-06-01');
  });

  it('buildMetadataForPlatform sermon_audio defaults autoPublishOnProcessed to true when unset', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['sermon_audio'],
      title: 'Title',
      description: 'Description',
      tags: [],
      visibility: 'public',
      platforms: {
        sermon_audio: {
          speakerName: 'Rev. Smith',
          preachDate: '2026-06-01',
          eventType: 'Sunday Service',
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'sermon_audio').autoPublishOnProcessed).toBe(true);
  });

  it('buildMetadataForPlatform sermon_audio respects autoPublishOnProcessed false', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['sermon_audio'],
      title: 'Title',
      description: 'Description',
      tags: [],
      visibility: 'public',
      platforms: {
        sermon_audio: {
          autoPublishOnProcessed: false,
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'sermon_audio').autoPublishOnProcessed).toBe(false);
  });

  it('buildMetadataForPlatform sermon_audio disables autoPublishOnProcessed when publishDate is set', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['sermon_audio'],
      title: 'Title',
      description: 'Description',
      tags: [],
      visibility: 'public',
      platforms: {
        sermon_audio: {
          publishDate: '2026-07-01T09:00:00-04:00',
          autoPublishOnProcessed: true,
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    const meta = buildMetadataForPlatform(draft, 'sermon_audio');
    expect(meta.autoPublishOnProcessed).toBe(false);
    expect(meta.publishDate).toBe('2026-07-01T09:00:00-04:00');
  });

  it('buildMetadataForPlatform sermon_audio includes crossPublish settings when set', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['sermon_audio'],
      title: 'Title',
      description: 'Description',
      tags: [],
      visibility: 'public',
      platforms: {
        sermon_audio: {
          crossPublish: {
            enabled: true,
            youtube: { uploadFullVideo: true, privacy: 'private' },
          },
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'sermon_audio').crossPublish).toEqual({
      enabled: true,
      youtube: { uploadFullVideo: true, privacy: 'private' },
    });
  });

  it('buildMetadataForPlatform sermon_audio includes series fields when set', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['sermon_audio'],
      title: 'Shared Title',
      description: 'Shared Description',
      tags: ['faith'],
      visibility: 'public',
      platforms: {
        sermon_audio: {
          subtitle: 'Romans',
          seriesID: 55,
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    const meta = buildMetadataForPlatform(draft, 'sermon_audio');
    expect(meta.subtitle).toBe('Romans');
    expect(meta.seriesID).toBe(55);
  });

  it('buildMetadataForPlatform sermon_audio joins tags as keywords', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['sermon_audio'],
      title: 'T',
      description: 'D',
      tags: ['faith', 'hope'],
      visibility: 'public',
      platforms: {
        sermon_audio: {
          speakerName: 'Rev. Smith',
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'sermon_audio').keywords).toBe('faith, hope');
  });

  it('buildMetadataForPlatform sermon_audio strips spaces and hash prefixes from keywords', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['sermon_audio'],
      title: 'T',
      description: 'D',
      tags: ['this is', '#faith'],
      visibility: 'public',
      platforms: {},
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    expect(buildMetadataForPlatform(draft, 'sermon_audio').keywords).toBe('thisis, faith');
  });

  it('normalizeDraftPlatforms normalizes facebook fields', () => {
    expect(
      normalizeDraftPlatforms({
        facebook: {
          videoState: 'SCHEDULED',
          scheduledPublishTime: 1_700_000_000.9,
          titleOverride: ' FB title ',
          thumbnailR2KeyOverride: ' draft-thumbnails/u1/d1/fb.jpg ',
          thumbnailContentTypeOverride: ' image/jpeg ',
        },
      })
    ).toEqual({
      facebook: {
        videoState: 'SCHEDULED',
        scheduledPublishTime: 1_700_000_000,
        titleOverride: 'FB title',
        thumbnailR2KeyOverride: 'draft-thumbnails/u1/d1/fb.jpg',
        thumbnailContentTypeOverride: 'image/jpeg',
      },
    });
  });

  it('mergeDraftPlatformsPatch handles facebook patch keys', () => {
    const base: Draft['platforms'] = {
      facebook: {
        videoState: 'PUBLISHED',
        titleOverride: 'Old title',
      },
    };
    expect(
      mergeDraftPlatformsPatch(base, {
        facebook: {
          videoState: 'SCHEDULED',
          scheduledPublishTime: 1_800_000_000,
        },
      })
    ).toEqual({
      facebook: {
        videoState: 'SCHEDULED',
        scheduledPublishTime: 1_800_000_000,
        titleOverride: 'Old title',
      },
    });
  });

  it('buildMetadataForPlatform returns facebook-specific metadata', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['facebook'],
      title: 'Shared',
      description: 'Desc',
      tags: ['a'],
      visibility: 'public',
      platforms: {
        facebook: {
          videoState: 'SCHEDULED',
          scheduledPublishTime: 1_800_000_000,
          titleOverride: 'FB title',
        },
      },
      thumbnailR2Key: 'thumb/key.jpg',
      thumbnailContentType: 'image/jpeg',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    const meta = buildMetadataForPlatform(draft, 'facebook');
    expect(meta.title).toBe('FB title');
    expect(meta.description).toBe('Desc');
    expect(meta.tags).toEqual([]);
    expect(meta.visibility).toBe('public');
    expect(meta.thumbnailR2Key).toBe('thumb/key.jpg');
    expect(meta.facebookVideoState).toBe('SCHEDULED');
    expect(meta.facebookScheduledPublishTime).toBe(1_800_000_000);
  });
});
