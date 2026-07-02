import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDraftById = vi.fn();
const mockGetYoutubeImportJobForDraftEditor = vi.fn();
const mockUpdateYoutubeImportJobStatus = vi.fn();
const mockGetUploadJobById = vi.fn();
const mockUpdateUploadJobStatus = vi.fn();
const mockDeleteObject = vi.fn();

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: (...args: unknown[]) => mockGetDraftById(...args),
}));

vi.mock('@/lib/repositories/youtube-import-jobs', () => ({
  getYoutubeImportJobForDraftEditor: (...args: unknown[]) =>
    mockGetYoutubeImportJobForDraftEditor(...args),
  getYoutubeImportJobById: vi.fn(),
  updateYoutubeImportJobStatus: (...args: unknown[]) => mockUpdateYoutubeImportJobStatus(...args),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  getUploadJobById: (...args: unknown[]) => mockGetUploadJobById(...args),
  updateUploadJobStatus: (...args: unknown[]) => mockUpdateUploadJobStatus(...args),
}));

vi.mock('@/lib/r2', () => ({
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
  R2ObjectNotFoundError: class R2ObjectNotFoundError extends Error {},
}));

import { discardBlockingDraftYoutubeImport } from '@/lib/youtube-import/discard-draft-import';

const USER_ID = 'user-123';
const DRAFT_ID = 'draft-1';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDraftById.mockResolvedValue({ id: DRAFT_ID, userId: USER_ID });
  mockUpdateYoutubeImportJobStatus.mockResolvedValue(undefined);
  mockUpdateUploadJobStatus.mockResolvedValue(null);
  mockDeleteObject.mockResolvedValue(undefined);
});

describe('discardBlockingDraftYoutubeImport', () => {
  it('cancels an active import job for the draft', async () => {
    mockGetYoutubeImportJobForDraftEditor.mockResolvedValue({
      id: 'import-1',
      userId: USER_ID,
      draftId: DRAFT_ID,
      status: 'downloading',
      uploadJobId: null,
    });

    await discardBlockingDraftYoutubeImport(DRAFT_ID, USER_ID);

    expect(mockUpdateYoutubeImportJobStatus).toHaveBeenCalledWith('import-1', {
      status: 'cancelled',
      errorMessage: null,
    });
  });

  it('discards a staged upload and cancels the completed import job', async () => {
    mockGetYoutubeImportJobForDraftEditor.mockResolvedValue({
      id: 'import-2',
      userId: USER_ID,
      draftId: DRAFT_ID,
      status: 'completed',
      uploadJobId: 'upload-1',
    });
    mockGetUploadJobById.mockResolvedValue({
      id: 'upload-1',
      userId: USER_ID,
      status: 'uploading',
      r2Key: 'temp/uploads/user-123/video.mp4',
    });

    await discardBlockingDraftYoutubeImport(DRAFT_ID, USER_ID);

    expect(mockUpdateUploadJobStatus).toHaveBeenCalledWith('upload-1', 'cancelled', null);
    expect(mockDeleteObject).toHaveBeenCalledWith('temp/uploads/user-123/video.mp4');
    expect(mockUpdateYoutubeImportJobStatus).toHaveBeenCalledWith('import-2', {
      status: 'cancelled',
      errorMessage: null,
      distributeQueued: false,
    });
  });
});
