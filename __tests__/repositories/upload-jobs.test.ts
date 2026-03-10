// =============================================================================
// UPLOAD JOBS REPOSITORY UNIT TESTS
// =============================================================================
// Tests for upload job CRUD and getUploadJobsWithPlatformUploads. Mocks
// node-appwrite TablesDB so we don't hit a real Appwrite instance.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCreateRow, mockGetRow, mockListRows, mockUpdateRow } = vi.hoisted(() => ({
  mockCreateRow: vi.fn(),
  mockGetRow: vi.fn(),
  mockListRows: vi.fn(),
  mockUpdateRow: vi.fn(),
}));

vi.mock('node-appwrite', () => ({
  ID: {
    unique: () => 'upload-job-id-123',
  },
  Query: {
    equal: (attr: string, value: string) => `equal("${attr}","${value}")`,
    orderDesc: (attr: string) => `orderDesc("${attr}")`,
  },
  TablesDB: class TablesDB {
    createRow = mockCreateRow;
    getRow = mockGetRow;
    listRows = mockListRows;
    updateRow = mockUpdateRow;
  },
}));

vi.mock('@/lib/appwrite', () => ({
  default: {},
}));

import {
  createUploadJob,
  getUploadJobById,
  listUploadJobsByUser,
  updateUploadJobStatus,
  getUploadJobsWithPlatformUploads,
} from '@/lib/repositories/upload-jobs';

const baseJobRow = {
  $id: 'job-1',
  userId: 'user-1',
  draftId: 'draft-1',
  status: 'pending',
  errorMessage: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('upload-jobs repository', () => {
  describe('createUploadJob', () => {
    it('creates an upload job with status pending', async () => {
      mockCreateRow.mockResolvedValue({ ...baseJobRow });

      const result = await createUploadJob({
        userId: 'user-1',
        draftId: 'draft-1',
      });

      expect(mockCreateRow).toHaveBeenCalledTimes(1);
      const call = mockCreateRow.mock.calls[0][0];
      expect(call.databaseId).toBe('videosphere');
      expect(call.tableId).toBe('upload_jobs');
      expect(call.rowId).toBe('upload-job-id-123');
      expect(call.data.userId).toBe('user-1');
      expect(call.data.draftId).toBe('draft-1');
      expect(call.data.status).toBe('pending');
      expect(call.data.errorMessage).toBe('');
      expect(call.data.createdAt).toBeDefined();
      expect(call.data.updatedAt).toBeDefined();

      expect(result.id).toBe('job-1');
      expect(result.userId).toBe('user-1');
      expect(result.draftId).toBe('draft-1');
      expect(result.status).toBe('pending');
      expect(result.errorMessage).toBeNull();
    });

    it('stores null draftId as empty string', async () => {
      mockCreateRow.mockResolvedValue({ ...baseJobRow, draftId: '' });

      await createUploadJob({ userId: 'user-1', draftId: null });

      const call = mockCreateRow.mock.calls[0][0];
      expect(call.data.draftId).toBe('');
    });
  });

  describe('getUploadJobById', () => {
    it('returns typed UploadJob', async () => {
      mockGetRow.mockResolvedValue({
        ...baseJobRow,
        status: 'completed',
        errorMessage: '',
      });

      const result = await getUploadJobById('job-1');

      expect(mockGetRow).toHaveBeenCalledWith({
        databaseId: 'videosphere',
        tableId: 'upload_jobs',
        rowId: 'job-1',
      });
      expect(result).not.toBeNull();
      expect(result!.id).toBe('job-1');
      expect(result!.userId).toBe('user-1');
      expect(result!.status).toBe('completed');
      expect(result!.draftId).toBe('draft-1');
      expect(result!.errorMessage).toBeNull();
    });

    it('returns draftId and errorMessage as null when empty', async () => {
      mockGetRow.mockResolvedValue({
        ...baseJobRow,
        draftId: '',
        errorMessage: '',
      });

      const result = await getUploadJobById('job-1');

      expect(result!.draftId).toBeNull();
      expect(result!.errorMessage).toBeNull();
    });

    it('returns null when job is not found (404)', async () => {
      const err = new Error('Not found') as Error & { code?: number };
      err.code = 404;
      mockGetRow.mockRejectedValue(err);

      const result = await getUploadJobById('missing-id');

      expect(result).toBeNull();
    });

    it('rethrows non-404 errors', async () => {
      mockGetRow.mockRejectedValue(new Error('Server error'));

      await expect(getUploadJobById('job-1')).rejects.toThrow('Server error');
    });
  });

  describe('listUploadJobsByUser', () => {
    it('returns jobs for user sorted by createdAt descending', async () => {
      mockListRows.mockResolvedValue({
        rows: [
          { ...baseJobRow, $id: 'j1', createdAt: '2026-01-03T00:00:00.000Z' },
          { ...baseJobRow, $id: 'j2', createdAt: '2026-01-02T00:00:00.000Z' },
        ],
      });

      const result = await listUploadJobsByUser('user-1');

      expect(mockListRows).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'upload_jobs',
          total: false,
        })
      );
      const queries = mockListRows.mock.calls[0][0].queries;
      expect(queries).toContain('equal("userId","user-1")');
      expect(queries).toContain('orderDesc("createdAt")');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('j1');
      expect(result[1].id).toBe('j2');
    });

    it('filters by status when provided', async () => {
      mockListRows.mockResolvedValue({ rows: [{ ...baseJobRow, status: 'completed' }] });

      await listUploadJobsByUser('user-1', 'completed');

      const queries = mockListRows.mock.calls[0][0].queries;
      expect(queries).toContain('equal("status","completed")');
    });

    it('returns empty array when user has no jobs', async () => {
      mockListRows.mockResolvedValue({ rows: [] });

      const result = await listUploadJobsByUser('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('updateUploadJobStatus', () => {
    it('updates status and updatedAt', async () => {
      const updated = {
        ...baseJobRow,
        status: 'distributing',
        updatedAt: '2026-03-09T12:00:00.000Z',
      };
      mockUpdateRow.mockResolvedValue(updated);

      const result = await updateUploadJobStatus('job-1', 'distributing');

      expect(mockUpdateRow).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'upload_jobs',
          rowId: 'job-1',
          data: expect.objectContaining({
            status: 'distributing',
            updatedAt: expect.any(String),
          }),
        })
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe('distributing');
    });

    it('updates errorMessage when provided', async () => {
      const updated = {
        ...baseJobRow,
        status: 'failed',
        errorMessage: 'Upload quota exceeded',
        updatedAt: '2026-03-09T12:00:00.000Z',
      };
      mockUpdateRow.mockResolvedValue(updated);

      const result = await updateUploadJobStatus('job-1', 'failed', 'Upload quota exceeded');

      expect(mockUpdateRow.mock.calls[0][0].data.errorMessage).toBe('Upload quota exceeded');
      expect(result!.status).toBe('failed');
      expect(result!.errorMessage).toBe('Upload quota exceeded');
    });

    it('sets errorMessage to empty string when passed null', async () => {
      mockUpdateRow.mockResolvedValue({ ...baseJobRow, errorMessage: '' });

      await updateUploadJobStatus('job-1', 'pending', null);

      expect(mockUpdateRow.mock.calls[0][0].data.errorMessage).toBe('');
    });

    it('returns null when job is not found (404)', async () => {
      const err = new Error('Not found') as Error & { code?: number };
      err.code = 404;
      mockUpdateRow.mockRejectedValue(err);

      const result = await updateUploadJobStatus('missing-id', 'completed');

      expect(result).toBeNull();
    });

    it('rethrows non-404 errors', async () => {
      mockUpdateRow.mockRejectedValue(new Error('Server error'));

      await expect(updateUploadJobStatus('job-1', 'completed')).rejects.toThrow('Server error');
    });
  });

  describe('getUploadJobsWithPlatformUploads', () => {
    it('returns jobs with platformUploads for each job', async () => {
      mockListRows
        .mockResolvedValueOnce({
          rows: [
            { ...baseJobRow, $id: 'job-1' },
            { ...baseJobRow, $id: 'job-2' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              $id: 'pu-1',
              uploadJobId: 'job-1',
              platform: 'youtube',
              status: 'completed',
              platformVideoId: 'yt-123',
              platformUrl: 'https://youtube.com/watch?v=yt-123',
              title: 'Video',
              description: 'Desc',
              tags: '[]',
              visibility: 'public',
              scheduledAt: '',
              errorMessage: '',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await getUploadJobsWithPlatformUploads('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('job-1');
      expect(result[0].platformUploads).toHaveLength(1);
      expect(result[0].platformUploads[0].platform).toBe('youtube');
      expect(result[0].platformUploads[0].platformVideoId).toBe('yt-123');
      expect(result[1].id).toBe('job-2');
      expect(result[1].platformUploads).toEqual([]);

      expect(mockListRows).toHaveBeenCalledTimes(3);
      expect(mockListRows).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          tableId: 'upload_jobs',
        })
      );
      expect(mockListRows).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          tableId: 'platform_uploads',
        })
      );
      expect(mockListRows).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          tableId: 'platform_uploads',
        })
      );
    });

    it('returns empty platformUploads when platform_uploads list fails', async () => {
      mockListRows
        .mockResolvedValueOnce({ rows: [{ ...baseJobRow, $id: 'job-1' }] })
        .mockRejectedValueOnce(new Error('Table not found'));

      const result = await getUploadJobsWithPlatformUploads('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].platformUploads).toEqual([]);
    });
  });
});
