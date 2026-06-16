import { describe, expect, it } from 'vitest';
import {
  readMembershipTypeFromMeBody,
  shouldIncludeUnlistedVisibilityOption,
  vimeoMembershipTypeSupportsUnlistedPrivacy,
  visibilityOptionsForPrivacyUi,
} from '@/lib/platforms/vimeo-membership';

describe('vimeoMembershipTypeSupportsUnlistedPrivacy', () => {
  it('returns false for free and basic memberships', () => {
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('free')).toBe(false);
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('basic')).toBe(false);
  });

  it('returns true for paid memberships that support unlisted uploads', () => {
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('starter')).toBe(true);
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('standard')).toBe(true);
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('advanced')).toBe(true);
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('pro_unlimited')).toBe(true);
  });
});

describe('readMembershipTypeFromMeBody', () => {
  it('reads membership.type from /me', () => {
    expect(readMembershipTypeFromMeBody({ membership: { type: 'free' } })).toBe('free');
  });
});

describe('visibilityOptionsForPrivacyUi', () => {
  it('hides unlisted for Vimeo-only privacy when the account is free', () => {
    expect(
      visibilityOptionsForPrivacyUi({
        scope: 'shared',
        vimeoSupportsUnlisted: false,
        selectedPrivacyPlatforms: ['vimeo'],
      }).map((option) => option.value)
    ).toEqual(['public', 'private']);
  });

  it('hides unlisted in shared privacy when YouTube and Vimeo share metadata on a free Vimeo account', () => {
    expect(
      shouldIncludeUnlistedVisibilityOption({
        scope: 'shared',
        vimeoSupportsUnlisted: false,
        selectedPrivacyPlatforms: ['youtube', 'vimeo'],
      })
    ).toBe(false);
  });

  it('shows unlisted for YouTube per-platform overrides even when Vimeo is free', () => {
    expect(
      visibilityOptionsForPrivacyUi({
        scope: 'youtube',
        vimeoSupportsUnlisted: false,
        selectedPrivacyPlatforms: ['youtube', 'vimeo'],
      }).map((option) => option.value)
    ).toEqual(['public', 'unlisted', 'private']);
  });

  it('shows unlisted for shared YouTube-only privacy', () => {
    expect(
      visibilityOptionsForPrivacyUi({
        scope: 'shared',
        vimeoSupportsUnlisted: false,
        selectedPrivacyPlatforms: ['youtube'],
      }).map((option) => option.value)
    ).toEqual(['public', 'unlisted', 'private']);
  });
});
