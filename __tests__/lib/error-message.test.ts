import { describe, it, expect } from 'vitest';
import { messageFromThrown } from '@/lib/utils/error-message';

describe('messageFromThrown', () => {
  it('uses Error cause message for AbortError', () => {
    const cause = new Error('deadline exceeded');
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    err.cause = cause;
    expect(messageFromThrown(err)).toBe('deadline exceeded');
  });

  it('stringifies non-Error cause for AbortError (e.g. undici string reason)', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    err.cause = 'upload timed out';
    expect(messageFromThrown(err)).toBe('upload timed out');
  });

  it('falls back to AbortError message when cause is absent', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(messageFromThrown(err)).toBe('aborted');
  });
});
