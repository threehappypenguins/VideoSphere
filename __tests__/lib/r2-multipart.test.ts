import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const mockSend = vi.hoisted(() => vi.fn());
const mockGetSignedUrl = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function MockS3Client(this: { send: typeof mockSend }) {
    this.send = mockSend;
  }),
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
  CopyObjectCommand: vi.fn(),
  CreateMultipartUploadCommand: vi.fn(function CreateMultipartUploadCommand(input: unknown) {
    return { input, _type: 'CreateMultipartUploadCommand' };
  }),
  UploadPartCommand: vi.fn(function UploadPartCommand(input: unknown) {
    return { input, _type: 'UploadPartCommand' };
  }),
  CompleteMultipartUploadCommand: vi.fn(function CompleteMultipartUploadCommand(input: unknown) {
    return { input, _type: 'CompleteMultipartUploadCommand' };
  }),
  AbortMultipartUploadCommand: vi.fn(function AbortMultipartUploadCommand(input: unknown) {
    return { input, _type: 'AbortMultipartUploadCommand' };
  }),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

import {
  CreateMultipartUploadCommand,
  GetObjectCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  computeMultipartPlan,
  createMultipartUpload,
  DEFAULT_MULTIPART_PART_SIZE_BYTES,
  getObjectWebStream,
  getPresignedUploadPartUrls,
  MAX_MULTIPART_PART_COUNT,
  MIN_MULTIPART_PART_SIZE_BYTES,
} from '@/lib/r2';

const MOCK_BUCKET = 'test-bucket';
const KEY = 'temp/uploads/user-1/video.mp4';
const CONTENT_TYPE = 'video/mp4';
const UPLOAD_ID = 'upload-id-abc';

describe('computeMultipartPlan', () => {
  it('uses a single part for a file smaller than the default part size', () => {
    expect(computeMultipartPlan(1024 * 1024)).toEqual({
      partCount: 1,
      partSize: DEFAULT_MULTIPART_PART_SIZE_BYTES,
    });
  });

  it('uses an exact multiple when the file size divides evenly', () => {
    const partSize = 32 * 1024 * 1024;
    expect(computeMultipartPlan(partSize * 2, partSize)).toEqual({
      partCount: 2,
      partSize,
    });
  });

  it('uses an extra part when the file size leaves a remainder', () => {
    const partSize = 32 * 1024 * 1024;
    expect(computeMultipartPlan(partSize + 1, partSize)).toEqual({
      partCount: 2,
      partSize,
    });
  });

  it('throws when the plan would exceed 10,000 parts', () => {
    const partSize = MIN_MULTIPART_PART_SIZE_BYTES;
    const fileSize = partSize * MAX_MULTIPART_PART_COUNT + 1;

    expect(() => computeMultipartPlan(fileSize, partSize)).toThrow(
      /would require 10001 parts \(maximum 10000\)/
    );
  });

  it('accepts exactly 10,000 parts at the boundary', () => {
    const partSize = MIN_MULTIPART_PART_SIZE_BYTES;
    const fileSize = partSize * MAX_MULTIPART_PART_COUNT;

    expect(computeMultipartPlan(fileSize, partSize)).toEqual({
      partCount: MAX_MULTIPART_PART_COUNT,
      partSize,
    });
  });
});

describe('R2 multipart upload primitives', () => {
  beforeAll(() => {
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-access-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.R2_BUCKET_NAME = MOCK_BUCKET;
  });

  afterAll(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
  });

  describe('createMultipartUpload', () => {
    it('returns the UploadId from CreateMultipartUpload', async () => {
      mockSend.mockResolvedValueOnce({ UploadId: UPLOAD_ID });

      await expect(createMultipartUpload(KEY, CONTENT_TYPE)).resolves.toBe(UPLOAD_ID);

      expect(CreateMultipartUploadCommand).toHaveBeenCalledWith({
        Bucket: MOCK_BUCKET,
        Key: KEY,
        ContentType: CONTENT_TYPE,
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('throws when key is empty', async () => {
      await expect(createMultipartUpload('', CONTENT_TYPE)).rejects.toThrow(
        'Object key is required'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('wraps SDK failures with context', async () => {
      mockSend.mockRejectedValueOnce(new Error('network down'));

      await expect(createMultipartUpload(KEY, CONTENT_TYPE)).rejects.toThrow(
        `Failed to create multipart upload for key "${KEY}": network down`
      );
    });
  });

  describe('getPresignedUploadPartUrls', () => {
    it('generates presigned URLs for each part concurrently', async () => {
      mockGetSignedUrl.mockImplementation(async (_client, command) => {
        const partNumber = (command as { input?: { PartNumber?: number } }).input?.PartNumber;
        return `https://r2.example/part-${partNumber}`;
      });

      const urls = await getPresignedUploadPartUrls(KEY, UPLOAD_ID, 3, 900);

      expect(urls).toEqual([
        { partNumber: 1, url: 'https://r2.example/part-1' },
        { partNumber: 2, url: 'https://r2.example/part-2' },
        { partNumber: 3, url: 'https://r2.example/part-3' },
      ]);
      expect(UploadPartCommand).toHaveBeenCalledTimes(3);
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(3);
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: MOCK_BUCKET,
            Key: KEY,
            UploadId: UPLOAD_ID,
            PartNumber: 1,
          }),
        }),
        { expiresIn: 900 }
      );
    });

    it('throws when partCount is invalid', async () => {
      await expect(getPresignedUploadPartUrls(KEY, UPLOAD_ID, 0, 900)).rejects.toThrow(
        'Part count must be a positive number'
      );
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('completeMultipartUpload', () => {
    it('sorts parts ascending before CompleteMultipartUpload', async () => {
      mockSend.mockResolvedValueOnce({});

      await completeMultipartUpload(KEY, UPLOAD_ID, [
        { partNumber: 3, eTag: '"etag-3"' },
        { partNumber: 1, eTag: '"etag-1"' },
        { partNumber: 2, eTag: '"etag-2"' },
      ]);

      expect(CompleteMultipartUploadCommand).toHaveBeenCalledWith({
        Bucket: MOCK_BUCKET,
        Key: KEY,
        UploadId: UPLOAD_ID,
        MultipartUpload: {
          Parts: [
            { PartNumber: 1, ETag: '"etag-1"' },
            { PartNumber: 2, ETag: '"etag-2"' },
            { PartNumber: 3, ETag: '"etag-3"' },
          ],
        },
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('throws when no parts are provided', async () => {
      await expect(completeMultipartUpload(KEY, UPLOAD_ID, [])).rejects.toThrow(
        'At least one uploaded part is required'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('abortMultipartUpload', () => {
    it('sends AbortMultipartUploadCommand', async () => {
      mockSend.mockResolvedValueOnce({});

      await abortMultipartUpload(KEY, UPLOAD_ID);

      expect(AbortMultipartUploadCommand).toHaveBeenCalledWith({
        Bucket: MOCK_BUCKET,
        Key: KEY,
        UploadId: UPLOAD_ID,
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('logs and swallows SDK failures', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockSend.mockRejectedValueOnce(new Error('NoSuchUpload'));

      await expect(abortMultipartUpload(KEY, UPLOAD_ID)).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to abort multipart upload for key "${KEY}"`)
      );
      warnSpy.mockRestore();
    });
  });

  describe('getObjectWebStream range reads', () => {
    it('requests a Range starting at rangeStart and returns full object contentLength', async () => {
      mockSend.mockResolvedValueOnce({
        Body: Readable.from([Buffer.from([1, 2])]),
        ContentRange: 'bytes 256-511/512',
        ContentType: 'video/mp4',
      });

      const opened = await getObjectWebStream(KEY, { rangeStart: 256 });

      expect(opened.contentLength).toBe(512);
      expect(opened.contentType).toBe('video/mp4');
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: MOCK_BUCKET,
        Key: KEY,
        Range: 'bytes=256-',
      });
    });
  });
});
