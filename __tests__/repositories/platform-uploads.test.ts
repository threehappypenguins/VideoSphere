// =============================================================================
// PLATFORM UPLOADS REPOSITORY UNIT TESTS
// =============================================================================
// Tests for createPlatformUpload, getPlatformUploadsByJob, updatePlatformUploadStatus.
// Mocks node-appwrite TablesDB so we don't hit a real Appwrite instance.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCreateRow, mockListRows, mockUpdateRow } = vi.hoisted(() => ({
  mockCreateRow: vi.fn(),
  mockListRows: vi.fn(),
  mockUpdateRow: vi.fn(),
}));

vi.mock('node-appwrite', () => ({
  ID: {
    unique: () => 'pu-id-123',
  },
  Query: {
    equal: (attr: string, value: string) => `equal("${attr}","${value}")`,
    orderDesc: (attr: string) => `orderDesc("${attr}")`,
  },
  TablesDB: class TablesDB {
    createRow = mockCreateRow;
    listRows = mockListRows;
    updateRow = mockUpdateRow;
  },
}));

vi.mock('@/lib/appwrite', () => ({
  default: {},
}));

import {
  createPlatformUpload,
  getPlatformUploadsByJob,
  updatePlatformUploadStatus,
} from '@/lib/repositories/platform-uploads';

const basePlatformUploadRow = {
  $id: 'pu-1',
  uploadJobId: 'job-1',
  platform: 'youtube',
  status: 'pending',
  platformVideoId: '',
  platformUrl: '',
  title: 'My Video',
  description: 'Description',
  tags: '[]',
  visibility: 'public',
  scheduledAt: '',
  errorMessage: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('platform-uploads repository', () => {
  describe('createPlatformUpload', () => {
    it('creates a platform upload with status pending linked to upload job', async () => {
      mockCreateRow.mockResolvedValue({ ...basePlatformUploadRow });

      const result = await createPlatformUpload({
        uploadJobId: 'job-1',
        platform: 'youtube',
        title: 'My Video',
        description: 'Description',
        tags: '[]',
        visibility: 'public',
      });

      expect(mockCreateRow).toHaveBeenCalledTimes(1);
      const call = mockCreateRow.mock.calls[0][0];
      expect(call.databaseId).toBe('videosphere');
      expect(call.tableId).toBe('platform_uploads');
      expect(call.rowId).toBe('pu-id-123');
      expect(call.data.uploadJobId).toBe('job-1');
      expect(call.data.platform).toBe('youtube');
      expect(call.data.status).toBe('pending');
      expect(call.data.title).toBe('My Video');
      expect(call.data.platformVideoId).toBe('');
      expect(call.data.platformUrl).toBe('');
      expect(call.data.errorMessage).toBe('');
      expect(call.data.createdAt).toBeDefined();
      expect(call.data.updatedAt).toBeDefined();
      expect(call.data.scheduledAt).toBeUndefined();

      expect(result.id).toBe('pu-1');
      expect(result.uploadJobId).toBe('job-1');
      expect(result.platform).toBe('youtube');
      expect(result.status).toBe('pending');
      expect(result.title).toBe('My Video');
      expect(result.scheduledAt).toBeNull();
      expect(result.errorMessage).toBeNull();
    });

    it('includes scheduledAt in row data when provided', async () => {
      mockCreateRow.mockResolvedValue({
        ...basePlatformUploadRow,
        scheduledAt: '2026-03-15T14:00:00.000Z',
      });

      await createPlatformUpload({
        uploadJobId: 'job-1',
        platform: 'vimeo',
        title: 'Scheduled',
        description: 'Desc',
        tags: '[]',
        visibility: 'unlisted',
        scheduledAt: '2026-03-15T14:00:00.000Z',
      });

      expect(mockCreateRow.mock.calls[0][0].data.scheduledAt).toBe('2026-03-15T14:00:00.000Z');
    });

    it('omits scheduledAt from row data when null', async () => {
      mockCreateRow.mockResolvedValue(basePlatformUploadRow);

      await createPlatformUpload({
        uploadJobId: 'job-1',
        platform: 'youtube',
        title: 'Immediate',
        description: 'Desc',
        tags: '[]',
        visibility: 'public',
        scheduledAt: null,
      });

      expect(mockCreateRow.mock.calls[0][0].data.scheduledAt).toBeUndefined();
    });
  });

  describe('getPlatformUploadsByJob', () => {
    it('returns all platform uploads for the job ordered by createdAt desc', async () => {
      mockListRows.mockResolvedValue({
        rows: [
          {
            ...basePlatformUploadRow,
            $id: 'pu-1',
            platform: 'youtube',
            createdAt: '2026-01-02T00:00:00.000Z',
          },
          {
            ...basePlatformUploadRow,
            $id: 'pu-2',
            platform: 'vimeo',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

      const result = await getPlatformUploadsByJob('job-1');

      expect(mockListRows).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'platform_uploads',
          total: false,
        })
      );
      const queries = mockListRows.mock.calls[0][0].queries;
      expect(queries).toContain('equal("uploadJobId","job-1")');
      expect(queries).toContain('orderDesc("createdAt")');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('pu-1');
      expect(result[0].platform).toBe('youtube');
      expect(result[1].id).toBe('pu-2');
      expect(result[1].platform).toBe('vimeo');
    });

    it('returns empty array when job has no platform uploads', async () => {
      mockListRows.mockResolvedValue({ rows: [] });

      const result = await getPlatformUploadsByJob('job-1');

      expect(result).toEqual([]);
    });

    it('maps row to typed PlatformUpload (visibility, scheduledAt, errorMessage)', async () => {
      mockListRows.mockResolvedValue({
        rows: [
          {
            ...basePlatformUploadRow,
            visibility: 'unlisted',
            scheduledAt: '2026-03-10T12:00:00.000Z',
            errorMessage: '',
          },
        ],
      });

      const result = await getPlatformUploadsByJob('job-1');

      expect(result[0].visibility).toBe('unlisted');
      expect(result[0].scheduledAt).toBe('2026-03-10T12:00:00.000Z');
      expect(result[0].errorMessage).toBeNull();
    });
  });

  describe('updatePlatformUploadStatus', () => {
    it('updates status and updatedAt', async () => {
      const updated = {
        ...basePlatformUploadRow,
        status: 'completed',
        updatedAt: '2026-03-09T12:00:00.000Z',
      };
      mockUpdateRow.mockResolvedValue(updated);

      const result = await updatePlatformUploadStatus('pu-1', 'completed');

      expect(mockUpdateRow).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'platform_uploads',
          rowId: 'pu-1',
          data: expect.objectContaining({
            status: 'completed',
            updatedAt: expect.any(String),
          }),
        })
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
    });

    it('includes platformVideoId and platformUrl when provided', async () => {
      const updated = {
        ...basePlatformUploadRow,
        status: 'completed',
        platformVideoId: 'yt-abc',
        platformUrl: 'https://youtube.com/watch?v=yt-abc',
        updatedAt: '2026-03-09T12:00:00.000Z',
      };
      mockUpdateRow.mockResolvedValue(updated);

      const result = await updatePlatformUploadStatus(
        'pu-1',
        'completed',
        'yt-abc',
        'https://youtube.com/watch?v=yt-abc'
      );

      const data = mockUpdateRow.mock.calls[0][0].data;
      expect(data.platformVideoId).toBe('yt-abc');
      expect(data.platformUrl).toBe('https://youtube.com/watch?v=yt-abc');
      expect(result!.platformVideoId).toBe('yt-abc');
      expect(result!.platformUrl).toBe('https://youtube.com/watch?v=yt-abc');
    });

    it('includes errorMessage when provided', async () => {
      const updated = {
        ...basePlatformUploadRow,
        status: 'failed',
        errorMessage: 'Quota exceeded',
        updatedAt: '2026-03-09T12:00:00.000Z',
      };
      mockUpdateRow.mockResolvedValue(updated);

      const result = await updatePlatformUploadStatus(
        'pu-1',
        'failed',
        undefined,
        undefined,
        'Quota exceeded'
      );

      expect(mockUpdateRow.mock.calls[0][0].data.errorMessage).toBe('Quota exceeded');
      expect(result!.status).toBe('failed');
      expect(result!.errorMessage).toBe('Quota exceeded');
    });

    it('sets errorMessage to empty string when passed null', async () => {
      mockUpdateRow.mockResolvedValue({ ...basePlatformUploadRow, errorMessage: '' });

      await updatePlatformUploadStatus('pu-1', 'pending', undefined, undefined, null);

      expect(mockUpdateRow.mock.calls[0][0].data.errorMessage).toBe('');
    });

    it('returns null when platform upload is not found (404)', async () => {
      const err = new Error('Not found') as Error & { code?: number };
      err.code = 404;
      mockUpdateRow.mockRejectedValue(err);

      const result = await updatePlatformUploadStatus('missing-id', 'completed');

      expect(result).toBeNull();
    });

    it('rethrows non-404 errors', async () => {
      mockUpdateRow.mockRejectedValue(new Error('Server error'));

      await expect(updatePlatformUploadStatus('pu-1', 'completed')).rejects.toThrow('Server error');
    });
  });
});
