import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnectToDatabase, mockCreate, mockFind, mockFindOne, mockFindByIdAndUpdate } =
  vi.hoisted(() => ({
    mockConnectToDatabase: vi.fn(),
    mockCreate: vi.fn(),
    mockFind: vi.fn(),
    mockFindOne: vi.fn(),
    mockFindByIdAndUpdate: vi.fn(),
  }));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/PlatformUpload', () => ({
  PlatformUploadModel: {
    create: (...args: unknown[]) => mockCreate(...args),
    find: (...args: unknown[]) => mockFind(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
  },
}));

import {
  createPlatformUpload,
  getPlatformUploadsByJob,
  listStaleSermonAudioUnpublishedPlatformUploads,
  rowToPlatformUpload,
  updatePlatformUploadResumableState,
  updatePlatformUploadStatus,
} from '@/lib/repositories/platform-uploads';
import type { PlatformUploadDocument } from '@/lib/models/PlatformUpload';

function chain<T>(value: T) {
  return {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

const baseDoc: PlatformUploadDocument = {
  _id: 'pu-1',
  uploadJobId: 'job-1',
  platform: 'youtube',
  status: 'pending',
  platformVideoId: '',
  platformUrl: '',
  document: JSON.stringify({
    title: 'My Video',
    description: 'D',
    tags: [],
    visibility: 'public',
  }),
  scheduledAt: '',
  errorMessage: '',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
});

describe('platform-uploads repository (mongo)', () => {
  it('creates a pending platform upload', async () => {
    mockCreate.mockResolvedValueOnce({ toObject: () => baseDoc });

    const row = await createPlatformUpload({
      uploadJobId: 'job-1',
      platform: 'youtube',
      title: 'My Video',
      description: 'D',
      tags: [],
      visibility: 'public',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadJobId: 'job-1',
        platform: 'youtube',
        status: 'pending',
      })
    );
    expect(row.id).toBe('pu-1');
  });

  it('creates a pending platform upload for sermon_audio', async () => {
    mockCreate.mockResolvedValueOnce({
      toObject: () => ({ ...baseDoc, _id: 'pu-sa', platform: 'sermon_audio' }),
    });

    const row = await createPlatformUpload({
      uploadJobId: 'job-1',
      platform: 'sermon_audio',
      title: 'Sunday Sermon',
      description: 'D',
      tags: ['faith'],
      visibility: 'public',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadJobId: 'job-1',
        platform: 'sermon_audio',
        status: 'pending',
      })
    );
    expect(row.platform).toBe('sermon_audio');
  });

  it('returns the existing row when create hits duplicate-key race', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key error'), {
      code: 11000,
    });
    mockCreate.mockRejectedValueOnce(duplicateKeyError);
    mockFindOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });

    const row = await createPlatformUpload({
      uploadJobId: 'job-1',
      platform: 'youtube',
      title: 'My Video',
      description: 'D',
      tags: [],
      visibility: 'public',
    });

    expect(mockFindOne).toHaveBeenCalledWith({ uploadJobId: 'job-1', platform: 'youtube' });
    expect(row.id).toBe('pu-1');
  });

  it('lists uploads by job in createdAt-desc order', async () => {
    mockFind.mockReturnValueOnce(chain([baseDoc]));

    const rows = await getPlatformUploadsByJob('job-1');

    expect(mockFind).toHaveBeenCalledWith({ uploadJobId: 'job-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0].uploadJobId).toBe('job-1');
  });

  it('updates upload status and returns null when row missing', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });
    const ok = await updatePlatformUploadStatus('pu-1', 'completed', 'vid-1', 'https://x');
    expect(ok?.id).toBe('pu-1');

    mockFindByIdAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) });
    const missing = await updatePlatformUploadStatus(
      'missing',
      'failed',
      undefined,
      undefined,
      'x'
    );
    expect(missing).toBeNull();
  });

  it('persists resumable state and returns it from the read path', async () => {
    const resumableUpdatedAt = '2026-06-20T12:00:00.000Z';
    const updatedDoc = {
      ...baseDoc,
      resumableUploadUrl: 'https://upload.example.com/session/abc',
      resumableBytesConfirmed: 1_048_576,
      resumableUpdatedAt,
    };

    mockFindByIdAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(updatedDoc) });
    const updated = await updatePlatformUploadResumableState('pu-1', {
      resumableUploadUrl: 'https://upload.example.com/session/abc',
      resumableBytesConfirmed: 1_048_576,
      resumableUpdatedAt,
    });

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'pu-1',
      {
        resumableUploadUrl: 'https://upload.example.com/session/abc',
        resumableBytesConfirmed: 1_048_576,
        resumableUpdatedAt,
      },
      { returnDocument: 'after', runValidators: true }
    );
    expect(updated).toEqual(rowToPlatformUpload(updatedDoc));

    mockFind.mockReturnValueOnce(chain([updatedDoc]));
    const rows = await getPlatformUploadsByJob('job-1');
    expect(rows[0].resumableUploadUrl).toBe('https://upload.example.com/session/abc');
    expect(rows[0].resumableBytesConfirmed).toBe(1_048_576);
    expect(rows[0].resumableUpdatedAt).toBe(resumableUpdatedAt);
  });

  it('returns null from updatePlatformUploadResumableState when the row is missing', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) });

    const missing = await updatePlatformUploadResumableState('missing', {
      resumableUploadUrl: 'https://upload.example.com/session/abc',
      resumableBytesConfirmed: 512,
      resumableUpdatedAt: '2026-06-20T12:00:00.000Z',
    });

    expect(missing).toBeNull();
  });

  it('maps legacy rows without resumable fields to null on read', () => {
    expect(rowToPlatformUpload(baseDoc)).toMatchObject({
      resumableUploadUrl: null,
      resumableBytesConfirmed: null,
      resumableUpdatedAt: null,
    });
  });

  it('lists stale SermonAudio unpublished rows with auto-publish enabled only', async () => {
    const updatedBefore = new Date('2026-06-20T11:00:00.000Z');
    const autoPublishDoc: PlatformUploadDocument = {
      ...baseDoc,
      _id: 'pu-sa-auto',
      platform: 'sermon_audio',
      status: 'unpublished',
      document: JSON.stringify({
        title: 'Sermon',
        description: '',
        tags: [],
        visibility: 'public',
        sermonAudioAutoPublishOnProcessed: true,
      }),
      updatedAt: new Date('2026-06-20T10:00:00.000Z'),
    };
    const manualPublishDoc: PlatformUploadDocument = {
      ...autoPublishDoc,
      _id: 'pu-sa-manual',
      document: JSON.stringify({
        title: 'Sermon manual',
        description: '',
        tags: [],
        visibility: 'public',
        sermonAudioAutoPublishOnProcessed: false,
      }),
    };

    mockFind.mockReturnValueOnce(chain([autoPublishDoc, manualPublishDoc]));

    const rows = await listStaleSermonAudioUnpublishedPlatformUploads(updatedBefore);

    expect(mockFind).toHaveBeenCalledWith({
      platform: 'sermon_audio',
      status: 'unpublished',
      updatedAt: { $lt: updatedBefore },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('pu-sa-auto');
    expect(rows[0].sermonAudioAutoPublishOnProcessed).toBe(true);
  });
});
