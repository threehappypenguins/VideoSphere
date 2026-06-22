import { describe, expect, it } from 'vitest';

import { youtubeLivestreamFieldsToUserDefaults } from '@/lib/platforms/youtube-user-defaults-persist';

describe('youtubeLivestreamFieldsToUserDefaults', () => {
  it('maps explicit YouTube livestream fields to profile defaults', () => {
    expect(
      youtubeLivestreamFieldsToUserDefaults({
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
    expect(youtubeLivestreamFieldsToUserDefaults({})).toBeUndefined();
    expect(youtubeLivestreamFieldsToUserDefaults(undefined)).toBeUndefined();
  });
});
