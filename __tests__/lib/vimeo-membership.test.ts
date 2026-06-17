import { describe, expect, it } from 'vitest';
import {
  readMembershipTypeFromMeBody,
  resolveVimeoSupportsUnlistedForPrivacyUi,
  shouldIncludeUnlistedVisibilityOption,
  vimeoMembershipTypeSupportsUnlistedPrivacy,
  visibilityOptionsForPrivacyUi,
} from '@/lib/platforms/vimeo-membership';

describe('vimeoMembershipTypeSupportsUnlistedPrivacy', () => {
  it('returns false for free and basic memberships', () => {
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('free')).toBe(false);
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('basic')).toBe(false);
  });

  it('returns true only for Starter, Standard, and Advanced', () => {
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('starter')).toBe(true);
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('standard')).toBe(true);
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('advanced')).toBe(true);
  });

  it('returns false for other paid tiers that are not Starter/Standard/Advanced', () => {
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('plus')).toBe(false);
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('pro')).toBe(false);
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('pro_unlimited')).toBe(false);
    expect(vimeoMembershipTypeSupportsUnlistedPrivacy('business')).toBe(false);
  });
});

describe('readMembershipTypeFromMeBody', () => {
  it('reads membership.type from /me', () => {
    expect(readMembershipTypeFromMeBody({ membership: { type: 'free' } })).toBe('free');
    expect(readMembershipTypeFromMeBody({ membership: { type: 'starter' } })).toBe('starter');
  });

  it('reads membership.display when type is absent', () => {
    expect(readMembershipTypeFromMeBody({ membership: { display: 'Free' } })).toBe('free');
    expect(readMembershipTypeFromMeBody({ membership: { display: 'Business Live' } })).toBe(
      'live_business'
    );
  });

  it('reads top-level account when membership fields are absent', () => {
    expect(readMembershipTypeFromMeBody({ account: 'basic' })).toBe('basic');
  });

  it('returns undefined when no plan tier fields are present', () => {
    expect(readMembershipTypeFromMeBody({})).toBeUndefined();
    expect(readMembershipTypeFromMeBody({ membership: {} })).toBeUndefined();
  });
});

describe('resolveVimeoSupportsUnlistedForPrivacyUi', () => {
  it('returns null while metadata is loading', () => {
    expect(
      resolveVimeoSupportsUnlistedForPrivacyUi({
        vimeoTargetActive: true,
        metadataLoaded: false,
        accountDefaults: undefined,
      })
    ).toBeNull();
  });

  it('returns explicit supportsUnlistedPrivacy when membership was resolved', () => {
    expect(
      resolveVimeoSupportsUnlistedForPrivacyUi({
        vimeoTargetActive: true,
        metadataLoaded: true,
        accountDefaults: { supportsUnlistedPrivacy: false, membershipType: 'free' },
      })
    ).toBe(false);
  });

  it('returns null when metadata loaded but membership.type was not returned', () => {
    expect(
      resolveVimeoSupportsUnlistedForPrivacyUi({
        vimeoTargetActive: true,
        metadataLoaded: true,
        accountDefaults: { license: 'by-sa' },
      })
    ).toBeNull();
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

  it('shows unlisted while Vimeo membership support is still unknown', () => {
    expect(
      visibilityOptionsForPrivacyUi({
        scope: 'shared',
        vimeoSupportsUnlisted: null,
        selectedPrivacyPlatforms: ['youtube', 'vimeo'],
      }).map((option) => option.value)
    ).toEqual(['public', 'unlisted', 'private']);

    expect(
      visibilityOptionsForPrivacyUi({
        scope: 'vimeo',
        vimeoSupportsUnlisted: undefined,
        selectedPrivacyPlatforms: ['vimeo'],
      }).map((option) => option.value)
    ).toEqual(['public', 'unlisted', 'private']);
  });

  it('hides unlisted for Vimeo when support is known false after metadata load', () => {
    expect(
      visibilityOptionsForPrivacyUi({
        scope: 'vimeo',
        vimeoSupportsUnlisted: false,
        selectedPrivacyPlatforms: ['vimeo'],
      }).map((option) => option.value)
    ).toEqual(['public', 'private']);
  });

  it('shows unlisted when Vimeo support is unknown after metadata load', () => {
    expect(
      visibilityOptionsForPrivacyUi({
        scope: 'vimeo',
        vimeoSupportsUnlisted: null,
        selectedPrivacyPlatforms: ['vimeo'],
      }).map((option) => option.value)
    ).toEqual(['public', 'unlisted', 'private']);
  });
});
