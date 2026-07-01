import { describe, expect, it } from 'vitest';
import {
  draftLabelListIncludesEquivalent,
  draftLabelsRemovedFromLibrary,
  filterDraftLabelSuggestions,
  lookupDraftLabelColor,
  MAX_DRAFT_LABEL_LIBRARY_SIZE,
  MAX_DRAFT_LABEL_LENGTH,
  mergeDraftLabelLibraryEntries,
  mergeUniqueDraftLabels,
  normalizeDraftLabelColor,
  normalizeDraftLabelDefinition,
  normalizeDraftLabelLibrary,
  normalizeDraftLabelList,
  parseDraftLabelInput,
  parseDraftLabelLibraryFromRequestBody,
  parseDraftLabelsFromRequestBody,
  upsertDraftLabelNamesInLibrary,
} from '@/lib/draft-labels';

describe('parseDraftLabelInput', () => {
  it('splits on commas and normalizes whitespace', () => {
    expect(parseDraftLabelInput('Sunday,  Morning Service')).toEqual(['Sunday', 'Morning Service']);
  });
});

describe('mergeUniqueDraftLabels', () => {
  it('deduplicates case-insensitively', () => {
    expect(mergeUniqueDraftLabels(['Sunday'], ['sunday', 'Easter'])).toEqual(['Sunday', 'Easter']);
  });
});

describe('filterDraftLabelSuggestions', () => {
  it('filters library entries by query substring', () => {
    expect(
      filterDraftLabelSuggestions(
        [
          { name: 'Easter', color: '#6366f1' },
          { name: 'Sunday Morning', color: '#22c55e' },
          { name: 'Christmas', color: '#ef4444' },
        ],
        'sun'
      )
    ).toEqual([{ name: 'Sunday Morning', color: '#22c55e' }]);
  });
});

describe('parseDraftLabelsFromRequestBody', () => {
  it('rejects non-array values', () => {
    const result = parseDraftLabelsFromRequestBody('Sunday');
    expect(result).toEqual({ ok: false, error: 'labels must be an array of strings' });
  });

  it('rejects arrays containing non-string elements', () => {
    expect(parseDraftLabelsFromRequestBody(['Sunday', 42])).toEqual({
      ok: false,
      error: 'labels must be an array of strings',
    });
    expect(parseDraftLabelsFromRequestBody(['Sunday', { name: 'Easter' }])).toEqual({
      ok: false,
      error: 'labels must be an array of strings',
    });
  });

  it('accepts valid string arrays', () => {
    expect(parseDraftLabelsFromRequestBody([' Easter ', 'Sunday'])).toEqual({
      ok: true,
      value: ['Easter', 'Sunday'],
    });
  });

  it('rejects arrays that exceed per-draft limit', () => {
    const labels = Array.from({ length: 21 }, (_, index) => `Label ${index}`);
    const result = parseDraftLabelsFromRequestBody(labels);
    expect(result.ok).toBe(false);
  });
});

describe('parseDraftLabelLibraryFromRequestBody', () => {
  it('rejects arrays containing non-string, non-object entries', () => {
    expect(parseDraftLabelLibraryFromRequestBody([42])).toEqual({
      ok: false,
      error: 'labels must contain only strings or label objects',
    });
    expect(
      parseDraftLabelLibraryFromRequestBody([{ name: 'Sunday', color: '#6366f1' }, null])
    ).toEqual({
      ok: false,
      error: 'labels must contain only strings or label objects',
    });
    expect(parseDraftLabelLibraryFromRequestBody([['Sunday']])).toEqual({
      ok: false,
      error: 'labels must contain only strings or label objects',
    });
  });

  it('accepts string entries and label objects', () => {
    expect(
      parseDraftLabelLibraryFromRequestBody(['Sunday', { name: 'Easter', color: '#6366f1' }])
    ).toEqual({
      ok: true,
      value: [
        { name: 'Sunday', color: expect.any(String) },
        { name: 'Easter', color: '#6366f1' },
      ],
    });
  });

  it('rejects raw arrays that exceed the library size cap', () => {
    const labels = Array.from({ length: MAX_DRAFT_LABEL_LIBRARY_SIZE + 1 }, (_, index) =>
      String(index)
    );
    const result = parseDraftLabelLibraryFromRequestBody(labels);
    expect(result.ok).toBe(false);
  });

  it('rejects string entries longer than the per-label limit', () => {
    const result = parseDraftLabelLibraryFromRequestBody(['a'.repeat(MAX_DRAFT_LABEL_LENGTH + 1)]);
    expect(result.ok).toBe(false);
  });
});

describe('draftLabelsRemovedFromLibrary', () => {
  it('returns labels removed during a settings update', () => {
    expect(
      draftLabelsRemovedFromLibrary(
        [
          { name: 'Easter', color: '#6366f1' },
          { name: 'Sunday', color: '#22c55e' },
        ],
        [{ name: 'Sunday', color: '#22c55e' }]
      )
    ).toEqual(['Easter']);
  });
});

describe('normalizeDraftLabelList', () => {
  it('normalizes unknown input to an empty list', () => {
    expect(normalizeDraftLabelList(null)).toEqual([]);
    expect(normalizeDraftLabelList([' Easter ', 'easter', 'Christmas'])).toEqual([
      'Easter',
      'Christmas',
    ]);
  });
});

describe('normalizeDraftLabelDefinition', () => {
  it('returns null when object name is not a string', () => {
    expect(normalizeDraftLabelDefinition({ name: { nested: true } })).toBeNull();
    expect(normalizeDraftLabelDefinition({ name: 42 })).toBeNull();
    expect(normalizeDraftLabelDefinition({ name: null })).toBeNull();
  });

  it('accepts string names on objects', () => {
    expect(normalizeDraftLabelDefinition({ name: 'Sunday', color: '#6366f1' })).toEqual({
      name: 'Sunday',
      color: '#6366f1',
    });
  });

  it('accepts legacy string entries', () => {
    expect(normalizeDraftLabelDefinition(' Easter ')).toEqual({
      name: 'Easter',
      color: expect.any(String),
    });
  });
});

describe('normalizeDraftLabelLibrary', () => {
  it('migrates legacy string entries and accepts color objects', () => {
    expect(normalizeDraftLabelLibrary([' Easter ', { name: 'Sunday', color: '#6366f1' }])).toEqual([
      { name: 'Easter', color: expect.any(String) },
      { name: 'Sunday', color: '#6366f1' },
    ]);
  });

  it('skips object entries with non-string names', () => {
    expect(
      normalizeDraftLabelLibrary([
        { name: 'Sunday', color: '#6366f1' },
        { name: { nested: true }, color: '#ef4444' },
      ])
    ).toEqual([{ name: 'Sunday', color: '#6366f1' }]);
  });

  it('deduplicates by name case-insensitively', () => {
    expect(
      normalizeDraftLabelLibrary([
        { name: 'Easter', color: '#6366f1' },
        { name: 'easter', color: '#ef4444' },
      ])
    ).toEqual([{ name: 'Easter', color: '#ef4444' }]);
  });
});

describe('normalizeDraftLabelColor', () => {
  it('falls back to the default for invalid values', () => {
    expect(normalizeDraftLabelColor('not-a-color')).toBe('#64748b');
    expect(normalizeDraftLabelColor('#AABBCC')).toBe('#aabbcc');
  });
});

describe('mergeDraftLabelLibraryEntries', () => {
  it('updates color for an existing label and appends new names', () => {
    expect(
      mergeDraftLabelLibraryEntries(
        [{ name: 'Sunday', color: '#6366f1' }],
        [
          { name: 'Sunday', color: '#ef4444' },
          { name: 'Easter', color: '#22c55e' },
        ]
      )
    ).toEqual([
      { name: 'Sunday', color: '#ef4444' },
      { name: 'Easter', color: '#22c55e' },
    ]);
  });
});

describe('upsertDraftLabelNamesInLibrary', () => {
  it('preserves existing colors when adding names only', () => {
    expect(
      upsertDraftLabelNamesInLibrary([{ name: 'Sunday', color: '#6366f1' }], ['Sunday', 'Easter'])
    ).toEqual([
      { name: 'Sunday', color: '#6366f1' },
      { name: 'Easter', color: expect.any(String) },
    ]);
  });

  it('does not add new names when the library is at capacity', () => {
    const fullLibrary = Array.from({ length: MAX_DRAFT_LABEL_LIBRARY_SIZE }, (_, index) => ({
      name: `Label ${index}`,
      color: '#6366f1',
    }));

    expect(upsertDraftLabelNamesInLibrary(fullLibrary, ['Label 0', 'Brand new'])).toEqual(
      fullLibrary
    );
  });
});

describe('lookupDraftLabelColor', () => {
  it('returns stored color or a stable default', () => {
    expect(lookupDraftLabelColor([{ name: 'Sunday', color: '#6366f1' }], 'sunday')).toBe('#6366f1');
    expect(lookupDraftLabelColor([], 'New Label')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('draftLabelListIncludesEquivalent', () => {
  it('matches labels case-insensitively', () => {
    expect(draftLabelListIncludesEquivalent(['Sunday Service'], 'sunday service')).toBe(true);
  });

  it('does not treat leading # as equivalent to the bare label', () => {
    expect(draftLabelListIncludesEquivalent(['foo'], '#foo')).toBe(false);
    expect(draftLabelListIncludesEquivalent(['#foo'], 'foo')).toBe(false);
  });
});
