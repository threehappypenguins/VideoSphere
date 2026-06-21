import { describe, expect, it } from 'vitest';

import { youTubeLivestreamFieldsToUserDefaults } from '@/lib/platforms/youtube-user-defaults-persist';

describe('youTubeLivestreamFieldsToUserDefaults', () => {
  it('maps explicit YouTube livestream fields to profile defaults', () => {
    expect(
      youTubeLivestreamFieldsToUserDefaults({
        categoryId: '22',
        defaultAudioLanguage: 'en',
        madeForKids: false,
        license: 'youtube',
        embeddable: true,
      })
    ).toEqual({
      categoryId: '22',
      defaultAudioLanguage: 'en',
      madeForKids: false,
      license: 'youtube',
      embeddable: true,
    });
  });

  it('returns undefined when no persistable fields are present', () => {
    expect(youTubeLivestreamFieldsToUserDefaults({})).toBeUndefined();
    expect(youTubeLivestreamFieldsToUserDefaults(undefined)).toBeUndefined();
  });
});
