import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());
const mockUploadDone = vi.hoisted(() => vi.fn());
const mockUploadConstructor = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function MockS3Client(this: { send: typeof mockSend }) {
    this.send = mockSend;
  }),
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(function HeadObjectCommand(input: unknown) {
    return { input, _type: 'HeadObjectCommand' };
  }),
  CopyObjectCommand: vi.fn(),
  CreateMultipartUploadCommand: vi.fn(),
  UploadPartCommand: vi.fn(),
  CompleteMultipartUploadCommand: vi.fn(),
  AbortMultipartUploadCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn(function MockUpload(this: { done: typeof mockUploadDone }, config: unknown) {
    mockUploadConstructor(config);
    this.done = mockUploadDone;
  }),
}));

import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { uploadLocalFileToR2 } from '@/lib/r2';

const MOCK_BUCKET = 'test-bucket';
const KEY = 'temp/uploads/user-1/import/trimmed.mp4';
const CONTENT_TYPE = 'video/mp4';
const OBJECT_SIZE = 42_000_000;

describe('uploadLocalFileToR2', () => {
  let tempDir = '';
  let localFilePath = '';

  beforeAll(async () => {
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-access-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.R2_BUCKET_NAME = MOCK_BUCKET;

    tempDir = await mkdtemp(join(tmpdir(), 'r2-upload-local-'));
    localFilePath = join(tempDir, 'trimmed.mp4');
    await writeFile(localFilePath, Buffer.alloc(1024));
  });

  afterAll(async () => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
    mockUploadDone.mockReset();
  });

  it('streams the local file via Upload and returns the HEAD content length', async () => {
    mockUploadDone.mockResolvedValueOnce(undefined);
    mockSend.mockResolvedValueOnce({ ContentLength: OBJECT_SIZE });

    const size = await uploadLocalFileToR2(localFilePath, KEY, CONTENT_TYPE);

    expect(size).toBe(OBJECT_SIZE);
    expect(mockUploadConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.objectContaining({ send: mockSend }),
        params: expect.objectContaining({
          Bucket: MOCK_BUCKET,
          Key: KEY,
          ContentType: CONTENT_TYPE,
        }),
      })
    );
    const uploadConfig = mockUploadConstructor.mock.calls[0]?.[0] as {
      params?: { Body?: { path?: string } };
    };
    expect(uploadConfig.params?.Body?.path).toBe(localFilePath);
    expect(mockUploadDone).toHaveBeenCalledTimes(1);
    expect(HeadObjectCommand).toHaveBeenCalledWith({
      Bucket: MOCK_BUCKET,
      Key: KEY,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from the Upload SDK', async () => {
    const sdkError = new Error('multipart upload failed');
    mockUploadDone.mockRejectedValueOnce(sdkError);

    await expect(uploadLocalFileToR2(localFilePath, KEY, CONTENT_TYPE)).rejects.toThrow(
      'multipart upload failed'
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('propagates errors from the post-upload HEAD request', async () => {
    mockUploadDone.mockResolvedValueOnce(undefined);
    mockSend.mockRejectedValueOnce(new Error('head failed'));

    await expect(uploadLocalFileToR2(localFilePath, KEY, CONTENT_TYPE)).rejects.toThrow(
      `Failed to HEAD object "${KEY}": head failed`
    );
  });
});
