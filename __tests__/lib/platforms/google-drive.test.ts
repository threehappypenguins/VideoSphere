import { describe, it, expect } from 'vitest';
import {
  parseGoogleDrivePlatformUserId,
  serializeGoogleDrivePlatformUserId,
} from '@/lib/platforms/google-drive';

describe('google-drive account metadata helpers', () => {
  it('parses legacy plain permission ids', () => {
    expect(parseGoogleDrivePlatformUserId('perm-123')).toEqual({ permissionId: 'perm-123' });
  });

  it('parses serialized permission and root folder ids', () => {
    expect(
      parseGoogleDrivePlatformUserId('{"permissionId":"perm-123","rootFolderId":"folder-root-1"}')
    ).toEqual({
      permissionId: 'perm-123',
      rootFolderId: 'folder-root-1',
    });
  });

  it('serializes without folder id as the plain permission id', () => {
    expect(serializeGoogleDrivePlatformUserId('perm-123')).toBe('perm-123');
  });

  it('serializes with folder id as JSON metadata', () => {
    expect(serializeGoogleDrivePlatformUserId('perm-123', 'folder-root-1')).toBe(
      '{"permissionId":"perm-123","rootFolderId":"folder-root-1"}'
    );
  });
});
