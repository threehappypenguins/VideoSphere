import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getPresignedUploadUrl,
  getObjectUrl,
  getObjectWebStream,
  deleteObject,
  headObject,
  getBucketName,
  getR2Endpoint,
  isTempUploadObjectKeyForUser,
  buildDraftThumbnailPendingKey,
  buildDraftThumbnailFinalKey,
} from '../../lib/r2';

/**
 * Tests for R2 storage integration
 *
 * Focus: Parameter validation and error handling
 * Integration tests with AWS SDK require proper R2 credentials (separate test suite)
 */

describe('R2 Storage - Validation & Utilities', () => {
  const MOCK_ACCOUNT_ID = 'test-account-123';
  const MOCK_ACCESS_KEY = 'test-access-key';
  const MOCK_SECRET_KEY = 'test-secret-key';
  const MOCK_BUCKET = 'test-bucket';

  beforeAll(() => {
    process.env.R2_ACCOUNT_ID = MOCK_ACCOUNT_ID;
    process.env.R2_ACCESS_KEY_ID = MOCK_ACCESS_KEY;
    process.env.R2_SECRET_ACCESS_KEY = MOCK_SECRET_KEY;
    process.env.R2_BUCKET_NAME = MOCK_BUCKET;
  });

  afterAll(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
  });

  describe('getPresignedUploadUrl - Validation', () => {
    it('should throw when key is empty', async () => {
      await expect(getPresignedUploadUrl('', 'video/mp4', 1024 * 1024)).rejects.toThrow(
        'Object key is required'
      );
    });

    it('should throw when key is null', async () => {
      await expect(
        getPresignedUploadUrl(null as unknown as string, 'video/mp4', 1024 * 1024)
      ).rejects.toThrow('Object key is required');
    });

    it('should throw when contentType is empty', async () => {
      await expect(getPresignedUploadUrl('test.mp4', '', 1024 * 1024)).rejects.toThrow(
        'Content type is required'
      );
    });

    it('should throw when contentType is null', async () => {
      await expect(
        getPresignedUploadUrl('test.mp4', null as unknown as string, 1024 * 1024)
      ).rejects.toThrow('Content type is required');
    });

    it('should throw when contentLength is zero', async () => {
      await expect(getPresignedUploadUrl('test.mp4', 'video/mp4', 0)).rejects.toThrow(
        'Content length must be a positive number'
      );
    });

    it('should throw when contentLength is negative', async () => {
      await expect(getPresignedUploadUrl('test.mp4', 'video/mp4', -1)).rejects.toThrow(
        'Content length must be a positive number'
      );
    });
  });

  describe('getObjectWebStream - Validation', () => {
    it('should throw when key is empty', async () => {
      await expect(getObjectWebStream('')).rejects.toThrow('Object key is required');
    });
  });

  describe('getObjectUrl - Validation', () => {
    it('should throw when key is empty', async () => {
      await expect(getObjectUrl('')).rejects.toThrow('Object key is required');
    });

    it('should throw when key is null', async () => {
      await expect(getObjectUrl(null as unknown as string)).rejects.toThrow(
        'Object key is required'
      );
    });

    it('should throw when key is undefined', async () => {
      await expect(getObjectUrl(undefined as unknown as string)).rejects.toThrow(
        'Object key is required'
      );
    });
  });

  describe('deleteObject - Validation', () => {
    it('should throw when key is empty', async () => {
      await expect(deleteObject('')).rejects.toThrow('Object key is required');
    });

    it('should throw when key is null', async () => {
      await expect(deleteObject(null as unknown as string)).rejects.toThrow(
        'Object key is required'
      );
    });

    it('should throw when key is undefined', async () => {
      await expect(deleteObject(undefined as unknown as string)).rejects.toThrow(
        'Object key is required'
      );
    });
  });

  describe('headObject - Validation', () => {
    it('should throw when key is empty', async () => {
      await expect(headObject('')).rejects.toThrow('Object key is required');
    });

    it('should throw when key is null', async () => {
      await expect(headObject(null as unknown as string)).rejects.toThrow('Object key is required');
    });

    it('should throw when key is undefined', async () => {
      await expect(headObject(undefined as unknown as string)).rejects.toThrow(
        'Object key is required'
      );
    });
  });

  describe('Utility Functions', () => {
    it('getBucketName returns configured value', () => {
      expect(getBucketName()).toBe(MOCK_BUCKET);
    });

    it('getBucketName returns empty string when not configured', () => {
      const original = process.env.R2_BUCKET_NAME;
      delete process.env.R2_BUCKET_NAME;

      expect(getBucketName()).toBe('');

      if (original) process.env.R2_BUCKET_NAME = original;
    });

    it('getR2Endpoint returns properly formatted URL', () => {
      const endpoint = getR2Endpoint();
      expect(endpoint).toBe(`https://${MOCK_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    });
  });

  describe('Error Messages', () => {
    it('upload error mentions missing key', async () => {
      try {
        await getPresignedUploadUrl('', 'video/mp4', 1024 * 1024);
        expect.fail('Should throw');
      } catch (error: any) {
        expect(error.message.toLowerCase()).toContain('key');
      }
    });

    it('upload error mentions missing contentType', async () => {
      try {
        await getPresignedUploadUrl('test.mp4', '', 1024 * 1024);
        expect.fail('Should throw');
      } catch (error: any) {
        expect(error.message.toLowerCase()).toContain('content type');
      }
    });

    it('download error mentions missing key', async () => {
      try {
        await getObjectUrl('');
        expect.fail('Should throw');
      } catch (error: any) {
        expect(error.message.toLowerCase()).toContain('key');
      }
    });

    it('delete error mentions missing key', async () => {
      try {
        await deleteObject('');
        expect.fail('Should throw');
      } catch (error: any) {
        expect(error.message.toLowerCase()).toContain('key');
      }
    });
  });

  describe('Accepted Key Formats', () => {
    it('accepts simple keys without throwing validation errors', async () => {
      const simpleKeys = ['video.mp4', 'file.mov', 'data.bin'];

      for (const key of simpleKeys) {
        try {
          await getPresignedUploadUrl(key, 'video/mp4', 1024 * 1024);
        } catch (error: any) {
          // AWS SDK might fail, but validation errors should not occur
          expect(error.message).not.toContain('Object key is required');
        }
      }
    });

    it('accepts nested paths without throwing validation errors', async () => {
      const nestedPaths = [
        'temp/uploads/user-123/video.mp4',
        'videos/2026/03/11/file.mp4',
        'users/email@test.com/video.mp4',
      ];

      for (const key of nestedPaths) {
        try {
          await getPresignedUploadUrl(key, 'video/mp4', 1024 * 1024);
        } catch (error: any) {
          expect(error.message).not.toContain('Object key is required');
        }
      }
    });

    it('accepts various MIME types without validation error', async () => {
      const types = ['video/mp4', 'video/webm', 'video/quicktime'];

      for (const type of types) {
        try {
          await getPresignedUploadUrl('test.mp4', type, 1024 * 1024);
        } catch (error: any) {
          expect(error.message).not.toContain('Content type is required');
        }
      }
    });
  });

  describe('Environment Variables', () => {
    it('getBucketName reads from environment', () => {
      const bucket = getBucketName();
      expect(bucket).toBe(process.env.R2_BUCKET_NAME);
    });

    it('getR2Endpoint reads account ID from environment', () => {
      const endpoint = getR2Endpoint();
      expect(endpoint).toContain(process.env.R2_ACCOUNT_ID!);
    });

    it('handles missing bucket env var gracefully', () => {
      const original = process.env.R2_BUCKET_NAME;
      delete process.env.R2_BUCKET_NAME;

      expect(() => getBucketName()).not.toThrow();
      expect(getBucketName()).toBe('');

      if (original) process.env.R2_BUCKET_NAME = original;
    });
  });

  describe('isTempUploadObjectKeyForUser', () => {
    it('accepts keys under temp/uploads/{userId}/...', () => {
      expect(
        isTempUploadObjectKeyForUser('temp/uploads/user-123/1700000000-uuid/file.mp4', 'user-123')
      ).toBe(true);
    });

    it('rejects another user prefix', () => {
      expect(
        isTempUploadObjectKeyForUser('temp/uploads/user-456/1700000000-uuid/file.mp4', 'user-123')
      ).toBe(false);
    });

    it('rejects path traversal segments', () => {
      expect(
        isTempUploadObjectKeyForUser('temp/uploads/user-123/../user-456/x.mp4', 'user-123')
      ).toBe(false);
    });

    it('rejects key equal to prefix only', () => {
      expect(isTempUploadObjectKeyForUser('temp/uploads/user-123/', 'user-123')).toBe(false);
    });
  });

  describe('buildDraftThumbnailPendingKey / buildDraftThumbnailFinalKey', () => {
    it('builds keys that pass isDraftThumbnail* when inputs are valid', () => {
      const pending = buildDraftThumbnailPendingKey('u1', 'd1', 'uuid', 'jpg');
      expect(pending).toBe('temp/draft-thumbnail-pending/u1/d1/uuid.jpg');
      const finalKey = buildDraftThumbnailFinalKey('u1', 'd1', 'uuid', '.png');
      expect(finalKey).toBe('draft-thumbnails/u1/d1/uuid.png');
    });

    it('throws when userId or draftId contain path metacharacters', () => {
      expect(() => buildDraftThumbnailPendingKey('a/b', 'd1', 'u', 'jpg')).toThrow(
        /userId or draftId/i
      );
      expect(() => buildDraftThumbnailFinalKey('u1', '..', 'u', 'jpg')).toThrow(
        /userId or draftId/i
      );
    });

    it('throws when uniqueId is unsafe', () => {
      expect(() => buildDraftThumbnailPendingKey('u1', 'd1', '../x', 'jpg')).toThrow(/unique id/i);
    });

    it('throws when extension is unsafe', () => {
      expect(() => buildDraftThumbnailPendingKey('u1', 'd1', 'u', 'jp/g')).toThrow(/extension/i);
    });
  });
});
