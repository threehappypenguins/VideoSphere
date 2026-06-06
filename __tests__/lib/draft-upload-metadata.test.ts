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
  parseDraftPlatformsPatchBody,
  parsePlatformsFromRequestBody,
  parseTagsFromRequestBody,
  stringifyDraftDocumentForStorage,
  visibilityFromRow,
} from '@/lib/draft-upload-metadata';
import type { Draft, DraftPlatforms } from '@/types';

describe('draft-upload-metadata', () => {
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
      platforms: { vimeo: { categoryUri: '/categories/1' } },
    });
    const row = { document: doc };
    expect(draftDocumentFromRow(row)).toEqual({
      targets: ['youtube', 'vimeo'],
      title: 'T',
      description: 'D',
      visibility: 'unlisted',
      tags: ['a', 'b'],
      platforms: { vimeo: { categoryUri: '/categories/1' } },
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
        'targets must include at least one of: youtube, vimeo, google_drive, sftp, smb, sermon_audio',
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
    expect(parseDraftPlatformsPatchBody({ vimeo: { categoryUri: '' } })).toEqual({
      ok: true,
      value: { vimeo: { categoryUri: '' } },
    });
    expect(parsePlatformsFromRequestBody({ vimeo: { categoryUri: '' } })).toEqual({
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
      vimeo: { categoryUri: '/categories/a' },
    };
    const patch: DraftPlatforms = {
      youtube: { categoryId: '10' },
    };
    expect(mergeDraftPlatforms(base, patch)).toEqual({
      youtube: { categoryId: '10', madeForKids: false },
      vimeo: { categoryUri: '/categories/a' },
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

  it('mergeDraftPlatformsPatch can clear categoryUri with empty string', () => {
    const base: Draft['platforms'] = {
      vimeo: { categoryUri: '/categories/x' },
    };
    expect(mergeDraftPlatformsPatch(base, { vimeo: { categoryUri: '' } })).toEqual({
      vimeo: { categoryUri: undefined },
    });
  });

  it('buildMetadataForPlatform copies shared tags to each platform', () => {
    const draft: Draft = {
      id: 'd1',
      userId: 'u1',
      targets: ['youtube', 'vimeo'],
      title: 'T',
      description: 'D',
      tags: ['  shared  ', 'b'],
      visibility: 'unlisted',
      platforms: {
        youtube: { categoryId: '99', madeForKids: false },
        vimeo: { categoryUri: '/categories/1' },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };
    const yt = buildMetadataForPlatform(draft, 'youtube');
    expect(yt.tags).toEqual(['shared', 'b']);
    expect(yt.categoryId).toBe('99');
    expect(yt.madeForKids).toBe(false);
    expect(yt.visibility).toBe('unlisted');

    const vm = buildMetadataForPlatform(draft, 'vimeo');
    expect(vm.tags).toEqual(['shared', 'b']);
    expect(vm.vimeoCategoryUri).toBe('/categories/1');
    expect(vm.vimeo).toEqual({ categoryUri: '/categories/1' });
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
          titleOverride: '  SA Title  ',
          descriptionOverride: ' SA Desc ',
          tagsOverride: ['  holy ', 'day'],
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
        titleOverride: 'SA Title',
        descriptionOverride: 'SA Desc',
        tagsOverride: ['holy', 'day'],
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
});
