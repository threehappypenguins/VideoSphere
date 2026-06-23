import { describe, expect, it } from 'vitest';
import { decryptToken } from '@/lib/crypto/token-encryption';
import {
  encryptFacebookStreamUrlForStorage,
  readFacebookStreamUrlFromStorage,
} from '@/lib/livestreams/facebook-stream-url-storage';

const INGEST_URL = 'rtmps://live-api-s.facebook.com:443/rtmp/FB-1412016960959699-0-AbCdEf';

describe('facebook stream url storage', () => {
  it('round-trips ingest URLs through encrypt and decrypt', () => {
    const stored = encryptFacebookStreamUrlForStorage(INGEST_URL);
    expect(stored).not.toBe(INGEST_URL);
    expect(readFacebookStreamUrlFromStorage(stored, 'livestream-1')).toBe(INGEST_URL);
    expect(decryptToken(stored)).toBe(INGEST_URL);
  });

  it('reads legacy plaintext ingest URLs until the row is rewritten', () => {
    expect(readFacebookStreamUrlFromStorage(INGEST_URL, 'livestream-legacy')).toBe(INGEST_URL);
  });

  it('returns undefined for undecryptable non-url ciphertext', () => {
    expect(
      readFacebookStreamUrlFromStorage('not-valid-ciphertext', 'livestream-bad')
    ).toBeUndefined();
  });
});
