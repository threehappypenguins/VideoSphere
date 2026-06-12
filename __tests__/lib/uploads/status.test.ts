import { describe, expect, it } from 'vitest';
import {
  isPlatformUploadDistributionComplete,
  isPlatformUploadStatusInProgress,
} from '@/lib/uploads/status';

describe('isPlatformUploadDistributionComplete', () => {
  it('treats completed, unpublished, and published as distribution-complete', () => {
    expect(isPlatformUploadDistributionComplete('completed')).toBe(true);
    expect(isPlatformUploadDistributionComplete('unpublished')).toBe(true);
    expect(isPlatformUploadDistributionComplete('published')).toBe(true);
  });

  it('treats pending, uploading, and failed as not distribution-complete', () => {
    expect(isPlatformUploadDistributionComplete('pending')).toBe(false);
    expect(isPlatformUploadDistributionComplete('uploading')).toBe(false);
    expect(isPlatformUploadDistributionComplete('failed')).toBe(false);
  });
});

describe('isPlatformUploadStatusInProgress', () => {
  it('treats unpublished as in progress for SA auto-publish polling', () => {
    expect(isPlatformUploadStatusInProgress('unpublished')).toBe(true);
  });

  it('treats terminal success and failure as not in progress', () => {
    expect(isPlatformUploadStatusInProgress('completed')).toBe(false);
    expect(isPlatformUploadStatusInProgress('published')).toBe(false);
    expect(isPlatformUploadStatusInProgress('failed')).toBe(false);
  });
});
