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
    limit: (n: number) => `limit(${n})`,
    offset: (n: number) => `offset(${n})`,
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
  ensurePlatformUploadsForJobTargets,
  getPlatformUploadsByJob,
  resetPlatformUploadForRetry,
  updatePlatformUploadStatus,
} from '@/lib/repositories/platform-uploads';

const baseDocument = JSON.stringify({
  title: 'My Video',
  description: 'Description',
  tags: [] as string[],
  visibility: 'public',
});

const basePlatformUploadRow = {
  $id: 'pu-1',
  uploadJobId: 'job-1',
  platform: 'youtube',
  status: 'pending',
  platformVideoId: '',
  platformUrl: '',
  document: baseDocument,
  scheduledAt: '',
  errorMessage: '',
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
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
        tags: [],
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
      expect(call.data.document).toBe(baseDocument);
      expect(call.data.platformVideoId).toBe('');
      expect(call.data.platformUrl).toBe('');
      expect(call.data.errorMessage).toBe('');
      expect(call.data).not.toHaveProperty('createdAt');
      expect(call.data).not.toHaveProperty('updatedAt');
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
        tags: [],
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
        tags: [],
        visibility: 'public',
        scheduledAt: null,
      });

      expect(mockCreateRow.mock.calls[0][0].data.scheduledAt).toBeUndefined();
    });

    it('embeds YouTube category and madeForKids in document JSON', async () => {
      mockCreateRow.mockResolvedValue({ ...basePlatformUploadRow });

      await createPlatformUpload({
        uploadJobId: 'job-1',
        platform: 'youtube',
        title: 'T',
        description: 'D',
        tags: ['a'],
        visibility: 'public',
        categoryId: '10',
        madeForKids: false,
      });

      const doc = JSON.parse(mockCreateRow.mock.calls[0][0].data.document as string);
      expect(doc).toMatchObject({
        title: 'T',
        categoryId: '10',
        madeForKids: false,
        tags: ['a'],
      });
    });

    it('embeds Vimeo category URI in document JSON', async () => {
      mockCreateRow.mockResolvedValue({ ...basePlatformUploadRow, platform: 'vimeo' });

      await createPlatformUpload({
        uploadJobId: 'job-1',
        platform: 'vimeo',
        title: 'T',
        description: 'D',
        tags: [],
        visibility: 'unlisted',
        vimeoCategoryUri: '/categories/music',
      });

      const doc = JSON.parse(mockCreateRow.mock.calls[0][0].data.document as string);
      expect(doc.vimeoCategoryUri).toBe('/categories/music');
    });
  });

  describe('getPlatformUploadsByJob', () => {
    it('returns all platform uploads for the job ordered by $createdAt desc', async () => {
      mockListRows.mockResolvedValue({
        rows: [
          {
            ...basePlatformUploadRow,
            $id: 'pu-1',
            platform: 'youtube',
            $createdAt: '2026-01-02T00:00:00.000Z',
          },
          {
            ...basePlatformUploadRow,
            $id: 'pu-2',
            platform: 'vimeo',
            $createdAt: '2026-01-01T00:00:00.000Z',
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
      expect(queries).toContain('orderDesc("$createdAt")');
      expect(queries).toContain('limit(100)');
      expect(queries).toContain('offset(0)');
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
            document: JSON.stringify({
              title: 'My Video',
              description: 'Description',
              tags: [],
              visibility: 'unlisted',
            }),
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

    it('paginates with explicit limit/offset until a short page', async () => {
      mockListRows
        .mockResolvedValueOnce({
          rows: Array.from({ length: 100 }, (_, i) => ({
            ...basePlatformUploadRow,
            $id: `pu-${i + 1}`,
          })),
        })
        .mockResolvedValueOnce({
          rows: [
            {
              ...basePlatformUploadRow,
              $id: 'pu-101',
            },
          ],
        });

      const result = await getPlatformUploadsByJob('job-1');

      expect(mockListRows).toHaveBeenCalledTimes(2);
      const q1 = mockListRows.mock.calls[0][0].queries as string[];
      const q2 = mockListRows.mock.calls[1][0].queries as string[];
      expect(q1).toContain('limit(100)');
      expect(q1).toContain('offset(0)');
      expect(q2).toContain('limit(100)');
      expect(q2).toContain('offset(100)');
      expect(result).toHaveLength(101);
    });
  });

  describe('updatePlatformUploadStatus', () => {
    it('updates status (Appwrite maintains $updatedAt)', async () => {
      const updated = {
        ...basePlatformUploadRow,
        status: 'completed',
        $updatedAt: '2026-03-09T12:00:00.000Z',
      };
      mockUpdateRow.mockResolvedValue(updated);

      const result = await updatePlatformUploadStatus('pu-1', 'completed');

      expect(mockUpdateRow).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'platform_uploads',
          rowId: 'pu-1',
          data: { status: 'completed' },
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
        $updatedAt: '2026-03-09T12:00:00.000Z',
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
        $updatedAt: '2026-03-09T12:00:00.000Z',
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

  describe('resetPlatformUploadForRetry', () => {
    it('updates row to pending with fresh document and cleared outcome fields', async () => {
      const updatedRow = {
        ...basePlatformUploadRow,
        $id: 'pu-1',
        status: 'pending',
        platformVideoId: '',
        platformUrl: '',
        errorMessage: '',
      };
      mockUpdateRow.mockResolvedValue(updatedRow);

      await resetPlatformUploadForRetry('pu-1', {
        uploadJobId: 'job-1',
        platform: 'youtube',
        title: 'Retry title',
        description: 'D',
        tags: ['x'],
        visibility: 'public',
      });

      expect(mockUpdateRow).toHaveBeenCalledTimes(1);
      const data = mockUpdateRow.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.status).toBe('pending');
      expect(data.platformVideoId).toBe('');
      expect(data.platformUrl).toBe('');
      expect(data.errorMessage).toBe('');
      expect(data.scheduledAt).toBe('');
      const doc = JSON.parse(data.document as string);
      expect(doc.title).toBe('Retry title');
    });
  });

  describe('ensurePlatformUploadsForJobTargets', () => {
    const youtubeInput = {
      uploadJobId: 'job-1',
      platform: 'youtube' as const,
      title: 'T',
      description: 'D',
      tags: [] as string[],
      visibility: 'public' as const,
    };

    it('resets newest row per platform when one already exists', async () => {
      mockListRows.mockResolvedValue({
        rows: [
          {
            ...basePlatformUploadRow,
            $id: 'pu-existing',
            platform: 'youtube',
            status: 'failed',
            errorMessage: 'old',
            $createdAt: '2026-01-03T00:00:00.000Z',
          },
        ],
      });
      mockUpdateRow.mockResolvedValue({
        ...basePlatformUploadRow,
        $id: 'pu-existing',
        status: 'pending',
      });

      const out = await ensurePlatformUploadsForJobTargets([youtubeInput]);

      expect(mockCreateRow).not.toHaveBeenCalled();
      expect(mockUpdateRow).toHaveBeenCalledWith(expect.objectContaining({ rowId: 'pu-existing' }));
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe('pu-existing');
    });

    it('creates when no row exists for that platform', async () => {
      mockListRows.mockResolvedValue({ rows: [] });
      mockCreateRow.mockResolvedValue({ ...basePlatformUploadRow });

      await ensurePlatformUploadsForJobTargets([youtubeInput]);

      expect(mockCreateRow).toHaveBeenCalledTimes(1);
      expect(mockUpdateRow).not.toHaveBeenCalled();
    });

    it('resets one platform and creates the other when only one exists', async () => {
      mockListRows.mockResolvedValue({
        rows: [{ ...basePlatformUploadRow, $id: 'pu-yt', platform: 'youtube' }],
      });
      mockUpdateRow.mockResolvedValue({ ...basePlatformUploadRow, $id: 'pu-yt' });
      mockCreateRow.mockResolvedValue({
        ...basePlatformUploadRow,
        $id: 'pu-vm',
        platform: 'vimeo',
      });

      await ensurePlatformUploadsForJobTargets([
        youtubeInput,
        {
          uploadJobId: 'job-1',
          platform: 'vimeo',
          title: 'V',
          description: 'D',
          tags: [],
          visibility: 'unlisted',
        },
      ]);

      expect(mockUpdateRow).toHaveBeenCalledTimes(1);
      expect(mockCreateRow).toHaveBeenCalledTimes(1);
    });

    it('throws when inputs mix different uploadJobId values', async () => {
      await expect(
        ensurePlatformUploadsForJobTargets([
          youtubeInput,
          { ...youtubeInput, uploadJobId: 'job-2' },
        ])
      ).rejects.toThrow(/uploadJobId/);
      expect(mockListRows).not.toHaveBeenCalled();
    });

    it('dedupes duplicate platforms so only one reset/create runs per platform', async () => {
      mockListRows.mockResolvedValue({
        rows: [
          {
            ...basePlatformUploadRow,
            $id: 'pu-existing',
            platform: 'youtube',
            status: 'failed',
            $createdAt: '2026-01-03T00:00:00.000Z',
          },
        ],
      });
      mockUpdateRow.mockResolvedValue({
        ...basePlatformUploadRow,
        $id: 'pu-existing',
        status: 'pending',
      });

      const out = await ensurePlatformUploadsForJobTargets([
        { ...youtubeInput, title: 'First' },
        { ...youtubeInput, title: 'Second duplicate' },
      ]);

      expect(mockUpdateRow).toHaveBeenCalledTimes(1);
      expect(mockCreateRow).not.toHaveBeenCalled();
      expect(out).toHaveLength(1);
      const doc = JSON.parse(mockUpdateRow.mock.calls[0][0].data.document as string);
      expect(doc.title).toBe('First');
    });
  });
});
