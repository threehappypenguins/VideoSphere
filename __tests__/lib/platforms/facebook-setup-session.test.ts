import { describe, it, expect } from 'vitest';
import { buildFacebookSetupSessionPages } from '@/lib/platforms/facebook-setup-session';

describe('buildFacebookSetupSessionPages', () => {
  it('strips Page access tokens from managed Page results', () => {
    const pages = buildFacebookSetupSessionPages([
      { id: 'page-1', name: 'First Page', access_token: 'secret-page-token-1' },
      { id: 'page-2', name: 'Second Page', access_token: 'secret-page-token-2' },
    ]);

    expect(pages).toEqual([
      { id: 'page-1', name: 'First Page' },
      { id: 'page-2', name: 'Second Page' },
    ]);
  });
});
