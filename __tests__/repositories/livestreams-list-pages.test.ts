import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConnectToDatabase = vi.fn();
const mockCountDocuments = vi.fn();
const mockFind = vi.fn();
const mockUpdateOne = vi.fn();

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/Livestream', () => ({
  LivestreamModel: {
    countDocuments: (...args: unknown[]) => mockCountDocuments(...args),
    find: (...args: unknown[]) => mockFind(...args),
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
  },
}));

import {
  getStreamedLivestreamsPage,
  getYoutubeImportLivestreamsPage,
} from '@/lib/repositories/livestreams';

const USER_ID = 'user-123';

const streamedDoc = {
  _id: 'streamed-1',
  userId: USER_ID,
  document: JSON.stringify({
    status: 'ended',
    title: 'Sunday Service',
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    youtubeBroadcastId: 'broadcast-1',
  }),
  status: 'ended',
  hasYoutubeTarget: true,
  youtubeBroadcastId: 'broadcast-1',
  youtubeLifecycleStatus: '',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
};

function mockFindChain(docs: unknown[]) {
  const chain = {
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
  };
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockResolvedValue(docs);
  mockFind.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
  mockCountDocuments.mockResolvedValue(1);
  mockFind.mockReturnValue({
    lean: vi.fn().mockResolvedValue([]),
  });
  mockUpdateOne.mockResolvedValue({ acknowledged: true });
});

describe('livestream list page queries', () => {
  it('queries streamed livestreams with indexed filters and pagination', async () => {
    const chain = mockFindChain([streamedDoc]);

    const result = await getStreamedLivestreamsPage(USER_ID, { limit: 2, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.livestreams).toHaveLength(1);
    expect(result.livestreams[0]?.id).toBe('streamed-1');
    expect(mockCountDocuments).toHaveBeenCalledWith({
      userId: USER_ID,
      status: { $in: ['ended', 'failed'] },
    });
    expect(mockFind).toHaveBeenCalledWith({
      userId: USER_ID,
      status: { $in: ['ended', 'failed'] },
    });
    expect(chain.sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(chain.skip).toHaveBeenCalledWith(0);
    expect(chain.limit).toHaveBeenCalledWith(2);
  });

  it('queries YouTube import livestreams with indexed filters and pagination', async () => {
    const chain = mockFindChain([streamedDoc]);

    const result = await getYoutubeImportLivestreamsPage(USER_ID, { limit: 2, offset: 2 });

    expect(result.total).toBe(1);
    expect(result.livestreams).toHaveLength(1);
    expect(mockCountDocuments).toHaveBeenCalledWith({
      userId: USER_ID,
      hasYoutubeTarget: true,
      youtubeBroadcastId: { $ne: '' },
      $or: [
        { status: { $in: ['ended', 'failed'] } },
        { status: 'live', youtubeLifecycleStatus: /^complete$/i },
      ],
    });
    expect(chain.skip).toHaveBeenCalledWith(2);
    expect(chain.limit).toHaveBeenCalledWith(2);
  });

  it('backfills query fields for legacy rows before paging', async () => {
    mockFind
      .mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue([
          {
            _id: 'legacy-1',
            userId: USER_ID,
            document: streamedDoc.document,
          },
        ]),
      })
      .mockReturnValueOnce(mockFindChain([streamedDoc]));

    await getStreamedLivestreamsPage(USER_ID, { limit: 1, offset: 0 });

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'legacy-1' },
      {
        status: 'ended',
        hasYoutubeTarget: true,
        youtubeBroadcastId: 'broadcast-1',
        youtubeLifecycleStatus: '',
      }
    );
  });
});
