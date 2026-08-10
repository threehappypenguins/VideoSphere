import { describe, expect, it } from 'vitest';
import {
  generateStreamKeyPlaintext,
  hashStreamKey,
  verifyStreamKey,
} from '@/lib/translation/stream-key';

describe('stream key helpers', () => {
  it('verifies plaintext against its hash', () => {
    const key = generateStreamKeyPlaintext();
    const digest = hashStreamKey(key);
    expect(verifyStreamKey(key, digest)).toBe(true);
    expect(verifyStreamKey(`${key}x`, digest)).toBe(false);
  });
});
