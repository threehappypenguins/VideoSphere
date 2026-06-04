import { describe, expect, it } from 'vitest';
import {
  ConnectedAccountModel,
  isValidConnectedAccountSftpPort,
  normalizeConnectedAccountSftpHostKeyFingerprint,
} from '@/lib/models/ConnectedAccount';

const VALID_FINGERPRINT = 'a'.repeat(64);

function baseSftpDocument(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'ca-sftp-1',
    userId: 'user-1',
    platform: 'sftp',
    accessToken: 'encrypted-token',
    refreshToken: '',
    tokenExpiry: '2099-01-01T00:00:00.000Z',
    platformUserId: 'backup-user',
    platformName: 'My Home Server',
    sftpHost: 'sftp.example.com',
    sftpPort: 22,
    sftpRemotePath: '/backups',
    sftpAuthMethod: 'password',
    sftpHostKeyFingerprint: VALID_FINGERPRINT,
    ...overrides,
  };
}

describe('ConnectedAccount SFTP schema validation', () => {
  it('accepts valid SFTP field values', () => {
    const error = new ConnectedAccountModel(baseSftpDocument()).validateSync();
    expect(error).toBeUndefined();
  });

  it('rejects sftpPort outside the valid TCP range', () => {
    for (const sftpPort of [0, 65536, -1]) {
      const error = new ConnectedAccountModel(baseSftpDocument({ sftpPort })).validateSync();
      expect(error?.errors.sftpPort).toBeDefined();
    }
  });

  it('rejects non-integer sftpPort values', () => {
    const error = new ConnectedAccountModel(baseSftpDocument({ sftpPort: 22.5 })).validateSync();
    expect(error?.errors.sftpPort).toBeDefined();
  });

  it('normalizes sftpHostKeyFingerprint to lowercase hex', () => {
    const doc = new ConnectedAccountModel(
      baseSftpDocument({ sftpHostKeyFingerprint: 'A'.repeat(64) })
    );
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.sftpHostKeyFingerprint).toBe(VALID_FINGERPRINT);
  });

  it('rejects malformed sftpHostKeyFingerprint values', () => {
    for (const sftpHostKeyFingerprint of ['too-short', `${'a'.repeat(63)}g`, '']) {
      const error = new ConnectedAccountModel(
        baseSftpDocument({ sftpHostKeyFingerprint })
      ).validateSync();
      expect(error?.errors.sftpHostKeyFingerprint).toBeDefined();
    }
  });

  it('allows omitting optional SFTP fields on non-SFTP rows', () => {
    const error = new ConnectedAccountModel({
      _id: 'ca-youtube-1',
      userId: 'user-1',
      platform: 'youtube',
      accessToken: 'encrypted-token',
      refreshToken: 'encrypted-refresh',
      tokenExpiry: '2099-01-01T00:00:00.000Z',
      platformUserId: 'UCtest',
      platformName: 'My Channel',
    }).validateSync();
    expect(error).toBeUndefined();
  });
});

describe('ConnectedAccount SFTP helpers', () => {
  it('validates SFTP port range', () => {
    expect(isValidConnectedAccountSftpPort(22)).toBe(true);
    expect(isValidConnectedAccountSftpPort(65535)).toBe(true);
    expect(isValidConnectedAccountSftpPort(0)).toBe(false);
    expect(isValidConnectedAccountSftpPort(65536)).toBe(false);
    expect(isValidConnectedAccountSftpPort(22.5)).toBe(false);
  });

  it('normalizes host key fingerprints', () => {
    expect(normalizeConnectedAccountSftpHostKeyFingerprint(` ${'A'.repeat(64)} `)).toBe(
      VALID_FINGERPRINT
    );
    expect(normalizeConnectedAccountSftpHostKeyFingerprint('not-a-fingerprint')).toBeNull();
  });
});
