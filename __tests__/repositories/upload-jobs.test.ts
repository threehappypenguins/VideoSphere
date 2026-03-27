// =============================================================================
// UPLOAD JOBS REPOSITORY UNIT TESTS
// =============================================================================
// Tests for upload job CRUD, listUploadJobsByUserForDraftIds, and
// getUploadJobsWithPlatformUploads. Mocks
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
    equal: (attr: string, value: string | string[]) =>
      Array.isArray(value)
        ? `equal("${attr}",[${value.map((v) => `"${v}"`).join(',')}])`
        : `equal("${attr}","${value}")`,
    orderAsc: (attr: string) => `orderAsc("${attr}")`,
    orderDesc: (attr: string) => `orderDesc("${attr}")`,
    limit: (n: number) => `limit(${n})`,
    offset: (n: number) => `offset(${n})`,
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
  findUploadJobForDistribution,
  getUploadJobById,
  listUploadJobsByUser,
  listUploadJobsByUserForDraftIds,
  updateUploadJobStatus,
  getUploadJobsWithPlatformUploads,
  getUploadJobsWithPlatformUploadsForDraft,
} from '@/lib/repositories/upload-jobs';

const baseJobRow = {
  $id: 'job-1',
  userId: 'user-1',
  draftId: 'draft-1',
  r2Key: 'temp/uploads/user-1/1234567890/test.mp4',
  status: 'pending',
  errorMessage: '',
  quotaClaimMonth: '2026-01',
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
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
        r2Key: 'temp/uploads/user-1/1234567890/test.mp4',
        quotaClaimMonth: '2026-01',
      });

      expect(mockCreateRow).toHaveBeenCalledTimes(1);
      const call = mockCreateRow.mock.calls[0][0];
      expect(call.databaseId).toBe('videosphere');
      expect(call.tableId).toBe('upload_jobs');
      expect(call.rowId).toBe('upload-job-id-123');
      expect(call.data.userId).toBe('user-1');
      expect(call.data.draftId).toBe('draft-1');
      expect(call.data.r2Key).toBe('temp/uploads/user-1/1234567890/test.mp4');
      expect(call.data.status).toBe('pending');
      expect(call.data.errorMessage).toBe('');
      expect(call.data.quotaClaimMonth).toBe('2026-01');
      expect(call.data).not.toHaveProperty('createdAt');
      expect(call.data).not.toHaveProperty('updatedAt');

      expect(result.id).toBe('job-1');
      expect(result.userId).toBe('user-1');
      expect(result.draftId).toBe('draft-1');
      expect(result.r2Key).toBe('temp/uploads/user-1/1234567890/test.mp4');
      expect(result.status).toBe('pending');
      expect(result.errorMessage).toBeNull();
    });

    it('stores null draftId as empty string', async () => {
      mockCreateRow.mockResolvedValue({ ...baseJobRow, draftId: '' });

      await createUploadJob({
        userId: 'user-1',
        draftId: null,
        r2Key: 'temp/uploads/user-1/1234567890/test.mp4',
        quotaClaimMonth: '2026-01',
      });

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
    it('returns jobs for user sorted by $createdAt descending', async () => {
      mockListRows.mockResolvedValue({
        rows: [
          { ...baseJobRow, $id: 'j1', $createdAt: '2026-01-03T00:00:00.000Z' },
          { ...baseJobRow, $id: 'j2', $createdAt: '2026-01-02T00:00:00.000Z' },
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
      expect(queries).toContain('orderDesc("$createdAt")');
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

  describe('listUploadJobsByUserForDraftIds', () => {
    it('returns [] and does not query when draftIds is empty', async () => {
      await expect(listUploadJobsByUserForDraftIds('user-1', [])).resolves.toEqual([]);
      expect(mockListRows).not.toHaveBeenCalled();
    });

    it('returns [] when all draft ids are blank after filtering', async () => {
      await expect(listUploadJobsByUserForDraftIds('user-1', ['', ''])).resolves.toEqual([]);
      expect(mockListRows).not.toHaveBeenCalled();
    });

    it('queries userId, draftId as IN array, orderAsc($createdAt), limit, and offset', async () => {
      mockListRows.mockResolvedValue({ rows: [] });

      await listUploadJobsByUserForDraftIds('user-1', ['draft-a', 'draft-b']);

      expect(mockListRows).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'upload_jobs',
          total: false,
        })
      );
      const queries = mockListRows.mock.calls[0][0].queries as string[];
      expect(queries).toContain('equal("userId","user-1")');
      expect(queries).toContain('equal("draftId",["draft-a","draft-b"])');
      expect(queries).toContain('orderAsc("$createdAt")');
      expect(queries).toContain('limit(100)');
      expect(queries).toContain('offset(0)');
    });

    it('dedupes duplicate draft ids', async () => {
      mockListRows.mockResolvedValue({ rows: [] });

      await listUploadJobsByUserForDraftIds('user-1', ['x', 'x', 'y']);

      const queries = mockListRows.mock.calls[0][0].queries as string[];
      expect(queries).toContain('equal("draftId",["x","y"])');
    });

    it('paginates with increasing offset until a short page ends the loop', async () => {
      mockListRows
        .mockResolvedValueOnce({
          rows: [
            { ...baseJobRow, $id: 'j1', draftId: 'a' },
            { ...baseJobRow, $id: 'j2', draftId: 'b' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ ...baseJobRow, $id: 'j3', draftId: 'c' }],
        });

      const result = await listUploadJobsByUserForDraftIds('user-1', ['a', 'b', 'c'], {
        pageSize: 2,
      });

      expect(mockListRows).toHaveBeenCalledTimes(2);
      const q1 = mockListRows.mock.calls[0][0].queries as string[];
      const q2 = mockListRows.mock.calls[1][0].queries as string[];
      expect(q1).toContain('offset(0)');
      expect(q1).toContain('limit(2)');
      expect(q2).toContain('offset(2)');
      expect(q2).toContain('limit(2)');
      expect(result.map((j) => j.id)).toEqual(['j1', 'j2', 'j3']);
    });

    it('stops after one page when every draftId has been seen (early exit)', async () => {
      mockListRows.mockResolvedValueOnce({
        rows: [
          { ...baseJobRow, $id: 'j1', draftId: 'a' },
          { ...baseJobRow, $id: 'j2', draftId: 'b' },
        ],
      });

      await listUploadJobsByUserForDraftIds('user-1', ['a', 'b'], { pageSize: 10 });

      expect(mockListRows).toHaveBeenCalledTimes(1);
    });

    it('stops when a page has fewer rows than the page limit (no more data)', async () => {
      mockListRows.mockResolvedValueOnce({
        rows: [{ ...baseJobRow, $id: 'j1', draftId: 'a' }],
      });

      const result = await listUploadJobsByUserForDraftIds('user-1', ['a', 'b'], {
        pageSize: 5,
      });

      expect(mockListRows).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });

    it('caps total rows at maxRows and does not fetch another page when the cap is hit', async () => {
      mockListRows.mockResolvedValueOnce({
        rows: [
          { ...baseJobRow, $id: 'j1', draftId: 'a' },
          { ...baseJobRow, $id: 'j2', draftId: 'a' },
        ],
      });

      const result = await listUploadJobsByUserForDraftIds('user-1', ['a', 'b', 'c'], {
        pageSize: 2,
        maxRows: 2,
      });

      expect(result).toHaveLength(2);
      expect(mockListRows).toHaveBeenCalledTimes(1);
      const queries = mockListRows.mock.calls[0][0].queries as string[];
      expect(queries).toContain('limit(2)');
    });

    it('with maxRows Infinity, keeps paging until every draft id is seen (cap would stop early)', async () => {
      mockListRows
        .mockResolvedValueOnce({
          rows: [
            { ...baseJobRow, $id: 'j1', draftId: 'a' },
            { ...baseJobRow, $id: 'j2', draftId: 'a' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ ...baseJobRow, $id: 'j3', draftId: 'b' }],
        });

      const unbounded = await listUploadJobsByUserForDraftIds('user-1', ['a', 'b'], {
        pageSize: 2,
        maxRows: Number.POSITIVE_INFINITY,
      });

      expect(mockListRows).toHaveBeenCalledTimes(2);
      expect(unbounded.some((j) => j.draftId === 'b')).toBe(true);

      vi.clearAllMocks();
      mockListRows.mockResolvedValueOnce({
        rows: [
          { ...baseJobRow, $id: 'j1', draftId: 'a' },
          { ...baseJobRow, $id: 'j2', draftId: 'a' },
        ],
      });

      const capped = await listUploadJobsByUserForDraftIds('user-1', ['a', 'b'], {
        pageSize: 2,
        maxRows: 2,
      });

      expect(mockListRows).toHaveBeenCalledTimes(1);
      expect(capped.some((j) => j.draftId === 'b')).toBe(false);
    });

    it('uses the remaining maxRows budget as the page limit on the first request', async () => {
      mockListRows.mockResolvedValue({ rows: [] });

      await listUploadJobsByUserForDraftIds('user-1', ['only-one-draft'], {
        pageSize: 100,
        maxRows: 3,
      });

      const queries = mockListRows.mock.calls[0][0].queries as string[];
      expect(queries).toContain('limit(3)');
    });

    it('throws AbortError before querying when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        listUploadJobsByUserForDraftIds('user-1', ['a'], { signal: controller.signal })
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(mockListRows).not.toHaveBeenCalled();
    });

    it('throws AbortError after current page when signal is aborted mid-scan', async () => {
      const controller = new AbortController();
      mockListRows.mockImplementationOnce(async () => {
        controller.abort();
        return {
          rows: [{ ...baseJobRow, $id: 'j1', draftId: 'a' }],
        };
      });

      await expect(
        listUploadJobsByUserForDraftIds('user-1', ['a', 'b'], {
          pageSize: 1,
          signal: controller.signal,
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(mockListRows).toHaveBeenCalledTimes(1);
    });
  });

  describe('findUploadJobForDistribution', () => {
    it('queries userId, draftId, r2Key, distributable statuses, and limit 1', async () => {
      mockListRows.mockResolvedValue({ rows: [{ ...baseJobRow }] });

      const result = await findUploadJobForDistribution({
        userId: 'user-1',
        draftId: 'draft-1',
        r2Key: 'temp/uploads/user-1/x.mp4',
      });

      expect(mockListRows).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'upload_jobs',
          total: false,
        })
      );
      const queries = mockListRows.mock.calls[0][0].queries as string[];
      expect(queries).toContain('equal("userId","user-1")');
      expect(queries).toContain('equal("draftId","draft-1")');
      expect(queries).toContain('equal("r2Key","temp/uploads/user-1/x.mp4")');
      expect(queries).toContain('equal("status",["pending","uploading","distributing"])');
      expect(queries).toContain('orderDesc("$createdAt")');
      expect(queries).toContain('limit(1)');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('job-1');
    });

    it('returns null when no row matches', async () => {
      mockListRows.mockResolvedValue({ rows: [] });

      const result = await findUploadJobForDistribution({
        userId: 'user-1',
        draftId: 'draft-1',
        r2Key: 'temp/uploads/user-1/x.mp4',
      });

      expect(result).toBeNull();
    });
  });

  describe('updateUploadJobStatus', () => {
    it('updates status (Appwrite maintains $updatedAt)', async () => {
      const updated = {
        ...baseJobRow,
        status: 'distributing',
        $updatedAt: '2026-03-09T12:00:00.000Z',
      };
      mockUpdateRow.mockResolvedValue(updated);

      const result = await updateUploadJobStatus('job-1', 'distributing');

      expect(mockUpdateRow).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'upload_jobs',
          rowId: 'job-1',
          data: { status: 'distributing' },
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
        $updatedAt: '2026-03-09T12:00:00.000Z',
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
    it('returns [] and does not query platform_uploads when user has no jobs', async () => {
      mockListRows.mockResolvedValueOnce({ rows: [] });

      const result = await getUploadJobsWithPlatformUploads('user-1');

      expect(result).toEqual([]);
      expect(mockListRows).toHaveBeenCalledTimes(1);
      expect(mockListRows).toHaveBeenCalledWith(
        expect.objectContaining({ tableId: 'upload_jobs' })
      );
    });

    it('returns jobs with platformUploads for each job (single platform_uploads query)', async () => {
      const platformUploadRow = {
        $id: 'pu-1',
        uploadJobId: 'job-1',
        platform: 'youtube',
        status: 'completed',
        platformVideoId: 'yt-123',
        platformUrl: 'https://youtube.com/watch?v=yt-123',
        document: JSON.stringify({
          title: 'Video',
          description: 'Desc',
          tags: [],
          visibility: 'public',
        }),
        scheduledAt: '',
        errorMessage: '',
        $createdAt: '2026-01-01T00:00:00.000Z',
        $updatedAt: '2026-01-01T00:00:00.000Z',
      };
      mockListRows
        .mockResolvedValueOnce({
          rows: [
            { ...baseJobRow, $id: 'job-1' },
            { ...baseJobRow, $id: 'job-2' },
          ],
        })
        .mockResolvedValueOnce({ rows: [platformUploadRow] });

      const result = await getUploadJobsWithPlatformUploads('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('job-1');
      expect(result[0].platformUploads).toHaveLength(1);
      expect(result[0].platformUploads[0].platform).toBe('youtube');
      expect(result[0].platformUploads[0].platformVideoId).toBe('yt-123');
      expect(result[1].id).toBe('job-2');
      expect(result[1].platformUploads).toEqual([]);

      expect(mockListRows).toHaveBeenCalledTimes(2);
      expect(mockListRows).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ tableId: 'upload_jobs' })
      );
      expect(mockListRows).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          tableId: 'platform_uploads',
          queries: expect.arrayContaining([expect.stringMatching(/equal\("uploadJobId"/)]),
        })
      );
    });

    it('returns empty platformUploads only when platform_uploads list returns 404 (e.g. table missing)', async () => {
      const err404 = new Error('Not found') as Error & { code?: number };
      err404.code = 404;
      mockListRows
        .mockResolvedValueOnce({ rows: [{ ...baseJobRow, $id: 'job-1' }] })
        .mockRejectedValueOnce(err404);

      const result = await getUploadJobsWithPlatformUploads('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].platformUploads).toEqual([]);
    });

    it('rethrows non-404 errors when listing platform_uploads', async () => {
      mockListRows
        .mockResolvedValueOnce({ rows: [{ ...baseJobRow, $id: 'job-1' }] })
        .mockRejectedValueOnce(new Error('Server error'));

      await expect(getUploadJobsWithPlatformUploads('user-1')).rejects.toThrow('Server error');
    });
  });

  describe('getUploadJobsWithPlatformUploadsForDraft', () => {
    it('paginates upload_jobs and aggregates platform_uploads across pages', async () => {
      const platformUploadRow = {
        $id: 'pu-1',
        uploadJobId: 'job-2',
        platform: 'youtube',
        status: 'completed',
        platformVideoId: 'yt-123',
        platformUrl: 'https://youtube.com/watch?v=yt-123',
        document: JSON.stringify({
          title: 'Video',
          description: 'Desc',
          tags: [],
          visibility: 'public',
        }),
        scheduledAt: '',
        errorMessage: '',
        $createdAt: '2026-01-02T00:00:00.000Z',
        $updatedAt: '2026-01-02T00:00:00.000Z',
      };

      mockListRows
        .mockResolvedValueOnce({
          // upload_jobs page 1 (pageSize=2)
          rows: [
            { ...baseJobRow, $id: 'job-1', $createdAt: '2026-01-03T00:00:00.000Z' },
            { ...baseJobRow, $id: 'job-2', $createdAt: '2026-01-02T00:00:00.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          // upload_jobs page 2
          rows: [{ ...baseJobRow, $id: 'job-3', $createdAt: '2026-01-01T00:00:00.000Z' }],
        })
        .mockResolvedValueOnce({
          // platform_uploads across all jobs found so far
          rows: [platformUploadRow],
        });

      const result = await getUploadJobsWithPlatformUploadsForDraft('user-1', 'draft-1', {
        pageSize: 2,
      });

      expect(result).toHaveLength(3);
      expect(result.map((j) => j.id)).toEqual(['job-1', 'job-2', 'job-3']);

      const job2 = result.find((j) => j.id === 'job-2');
      expect(job2?.platformUploads).toHaveLength(1);
      expect(job2?.platformUploads[0].platform).toBe('youtube');

      expect(mockListRows).toHaveBeenCalledTimes(3);

      const uploadJobsQueries1 = mockListRows.mock.calls[0][0].queries as string[];
      expect(uploadJobsQueries1).toContain('offset(0)');
      expect(uploadJobsQueries1).toContain('limit(2)');

      const uploadJobsQueries2 = mockListRows.mock.calls[1][0].queries as string[];
      expect(uploadJobsQueries2).toContain('offset(2)');
      expect(uploadJobsQueries2).toContain('limit(2)');

      const platformQueries = mockListRows.mock.calls[2][0].queries as string[];
      expect(platformQueries.some((q) => q.startsWith('equal("uploadJobId"'))).toBe(true);
      expect(platformQueries.join(' ')).toContain('job-1');
      expect(platformQueries.join(' ')).toContain('job-2');
      expect(platformQueries.join(' ')).toContain('job-3');
    });
  });
});
