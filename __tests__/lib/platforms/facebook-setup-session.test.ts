import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchFacebookSetupPages,
  toFacebookSetupPagePublicList,
  type FacebookSetupSession,
} from '@/lib/platforms/facebook-setup-session';

const mockFetchFacebookManagedPages = vi.fn();

vi.mock('@/lib/platforms/facebook-oauth', () => ({
  fetchFacebookManagedPages: (...args: unknown[]) => mockFetchFacebookManagedPages(...args),
}));

describe('toFacebookSetupPagePublicList', () => {
  it('maps managed Pages to id/name pairs only', () => {
    const pages = toFacebookSetupPagePublicList([
      { id: 'page-1', name: 'First Page', access_token: 'secret-page-token-1' },
      { id: 'page-2', name: 'Second Page', access_token: 'secret-page-token-2' },
    ]);

    expect(pages).toEqual([
      { id: 'page-1', name: 'First Page' },
      { id: 'page-2', name: 'Second Page' },
    ]);
  });
});

describe('fetchFacebookSetupPages', () => {
  const session: FacebookSetupSession = {
    userId: 'user-1',
    userAccessToken: 'long-user-token',
    userProfileId: 'fb-user-1',
    userProfileName: 'Test User',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchFacebookManagedPages.mockResolvedValue([
      { id: 'page-1', name: 'Test Page', access_token: 'page-token' },
    ]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('loads managed Pages using the pending session user token', async () => {
    const pages = await fetchFacebookSetupPages(session);

    expect(mockFetchFacebookManagedPages).toHaveBeenCalledWith('long-user-token');
    expect(pages).toEqual([{ id: 'page-1', name: 'Test Page' }]);
  });
});
