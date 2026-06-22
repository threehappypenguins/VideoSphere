import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectToDatabase,
  mockCreate,
  mockFind,
  mockFindOne,
  mockFindById,
  mockFindByIdAndUpdate,
  mockDeleteOne,
} = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockCreate: vi.fn(),
  mockFind: vi.fn(),
  mockFindOne: vi.fn(),
  mockFindById: vi.fn(),
  mockFindByIdAndUpdate: vi.fn(),
  mockDeleteOne: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/ConnectedAccount', () => ({
  ConnectedAccountModel: {
    create: (...args: unknown[]) => mockCreate(...args),
    find: (...args: unknown[]) => mockFind(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
    deleteOne: (...args: unknown[]) => mockDeleteOne(...args),
  },
}));

import { decryptToken, encryptToken } from '@/lib/crypto/token-encryption';
import {
  createConnectedAccount,
  deleteConnectedAccount,
  getConnectedAccount,
  getConnectedAccountsByUser,
  getConnectedAccountForUser,
  getConnectedAccountWithTokens,
  updateTokens,
  updateYouTubeStreamKeys,
} from '@/lib/repositories/connected-accounts';

function chain<T>(value: T) {
  return {
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

const baseDoc = {
  _id: 'conn-1',
  userId: 'user-1',
  platform: 'youtube',
  accessToken: 'encrypted',
  refreshToken: 'encrypted-refresh',
  tokenExpiry: '2026-12-31T00:00:00.000Z',
  platformUserId: 'yt-123',
  platformName: 'My Channel',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
});

describe('connected-accounts repository (mongo)', () => {
  it('creates connected account and returns public shape', async () => {
    mockCreate.mockResolvedValueOnce({ toObject: () => baseDoc });

    const account = await createConnectedAccount({
      userId: 'user-1',
      platform: 'youtube',
      accessToken: 'a',
      refreshToken: 'r',
      tokenExpiry: '2026-12-31T00:00:00.000Z',
      platformUserId: 'yt-123',
      platformName: 'My Channel',
    });

    expect(mockCreate).toHaveBeenCalled();
    expect(account.id).toBe('conn-1');
    expect(account).not.toHaveProperty('accessToken');
  });

  it('lists and gets account by platform', async () => {
    mockFind.mockReturnValueOnce(chain([baseDoc]));
    mockFindOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });

    const all = await getConnectedAccountsByUser('user-1');
    const one = await getConnectedAccount('user-1', 'youtube');

    expect(all).toHaveLength(1);
    expect(one?.platform).toBe('youtube');
  });

  it('guards ownership on id lookup', async () => {
    mockFindById.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });
    const own = await getConnectedAccountForUser('conn-1', 'user-1');
    expect(own?.id).toBe('conn-1');

    mockFindById.mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({ ...baseDoc, userId: 'other-user' }),
    });
    const other = await getConnectedAccountForUser('conn-1', 'user-1');
    expect(other).toBeNull();
  });

  it('updates tokens and deletes by id', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });
    mockDeleteOne.mockResolvedValueOnce({ deletedCount: 1 });

    const updated = await updateTokens('conn-1', 'new-a', 'new-r', '2027-01-01T00:00:00.000Z');
    await deleteConnectedAccount('conn-1');

    expect(updated?.id).toBe('conn-1');
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: 'conn-1' });
  });

  it('returns null from updateYouTubeStreamKeys when YouTube is not connected', async () => {
    mockFindOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) });

    const result = await updateYouTubeStreamKeys('user-1', { mainStreamKey: 'key-main' });

    expect(result).toBeNull();
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('encrypts and stores YouTube stream keys on update', async () => {
    const encryptedMain = encryptToken('main-key-value');
    const updatedDoc = {
      ...baseDoc,
      youtubeMainStreamKey: encryptedMain,
    };

    mockFindOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });
    mockFindByIdAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(updatedDoc) });

    const result = await updateYouTubeStreamKeys('user-1', { mainStreamKey: 'main-key-value' });

    expect(mockFindByIdAndUpdate).toHaveBeenCalledTimes(1);
    const [rowId, updatePayload, options] = mockFindByIdAndUpdate.mock.calls[0] as [
      string,
      { youtubeMainStreamKey: string },
      { returnDocument: 'after'; runValidators: boolean },
    ];
    expect(rowId).toBe('conn-1');
    expect(decryptToken(updatePayload.youtubeMainStreamKey)).toBe('main-key-value');
    expect(options).toEqual({ returnDocument: 'after', runValidators: true });
    expect(result?.hasYoutubeMainStreamKey).toBe(true);
    expect(result?.hasYoutubeTempStreamKey).toBe(false);
  });

  it('clears a YouTube stream key when an empty string is provided', async () => {
    const existingDoc = {
      ...baseDoc,
      youtubeTempStreamKey: encryptToken('temp-key'),
    };
    const clearedDoc = { ...existingDoc, youtubeTempStreamKey: '' };

    mockFindOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(existingDoc) });
    mockFindByIdAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(clearedDoc) });

    const result = await updateYouTubeStreamKeys('user-1', { tempStreamKey: '' });

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'conn-1',
      { youtubeTempStreamKey: '' },
      { returnDocument: 'after', runValidators: true }
    );
    expect(result?.hasYoutubeTempStreamKey).toBe(false);
  });

  it('leaves stored YouTube stream keys unchanged when fields are omitted', async () => {
    const existingDoc = {
      ...baseDoc,
      youtubeMainStreamKey: encryptToken('main-key'),
    };

    mockFindOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(existingDoc) });

    const result = await updateYouTubeStreamKeys('user-1', {});

    expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
    expect(result?.hasYoutubeMainStreamKey).toBe(true);
  });

  it('decrypts YouTube stream keys in getConnectedAccountWithTokens', async () => {
    const encryptedAccess = encryptToken('access-plain');
    const encryptedRefresh = encryptToken('refresh-plain');
    const encryptedMain = encryptToken('main-stream-key');
    const doc = {
      ...baseDoc,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      youtubeMainStreamKey: encryptedMain,
    };

    mockFindOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(doc) });

    const account = await getConnectedAccountWithTokens('user-1', 'youtube');

    expect(account?.accessToken).toBe('access-plain');
    expect(account?.youtubeMainStreamKey).toBe('main-stream-key');
    expect(account?.hasYoutubeMainStreamKey).toBe(true);
    expect(account?.hasYoutubeTempStreamKey).toBe(false);
  });

  it('omits undecryptable YouTube stream keys without throwing', async () => {
    const encryptedAccess = encryptToken('access-plain');
    const encryptedRefresh = encryptToken('refresh-plain');
    const doc = {
      ...baseDoc,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      youtubeMainStreamKey: 'not-valid-ciphertext',
    };

    mockFindOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(doc) });

    const account = await getConnectedAccountWithTokens('user-1', 'youtube');

    expect(account?.accessToken).toBe('access-plain');
    expect(account).not.toHaveProperty('youtubeMainStreamKey');
    expect(account?.hasYoutubeMainStreamKey).toBe(true);
  });
});
