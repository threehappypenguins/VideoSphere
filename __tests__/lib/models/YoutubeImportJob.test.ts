import { describe, expect, it } from 'vitest';
import { YoutubeImportJobModel } from '@/lib/models/YoutubeImportJob';

describe('YoutubeImportJob schema indexes', () => {
  it('indexes userId via a partial unique index for active jobs (not field index: true)', () => {
    const indexes = YoutubeImportJobModel.schema.indexes();

    const userIdPartialUnique = indexes.find(([spec, options]) => {
      const keys = spec as Record<string, number>;
      return (
        keys.userId === 1 &&
        Object.keys(keys).length === 1 &&
        options?.unique === true &&
        typeof options.partialFilterExpression === 'object' &&
        options.partialFilterExpression !== null &&
        'status' in options.partialFilterExpression
      );
    });

    expect(userIdPartialUnique).toBeDefined();

    const userIdFieldIndex = YoutubeImportJobModel.schema.path('userId')?.options?.index;
    expect(userIdFieldIndex).not.toBe(true);
  });

  it('indexes draft history lookups by draftId and createdAt', () => {
    const indexes = YoutubeImportJobModel.schema.indexes();

    const draftHistory = indexes.find(([spec]) => {
      const keys = spec as Record<string, number>;
      return keys.draftId === 1 && keys.createdAt === -1;
    });

    expect(draftHistory).toBeDefined();
  });
});
