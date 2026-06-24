/**
 * Tests for GET /api/platforms/connect/drive
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

import { GET } from '@/app/api/platforms/connect/drive/route';

const SESSION_COOKIE = 'videosphere_session';

function makeRequest(cookies: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/connect/drive');
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

describe('GET /api/platforms/connect/drive', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'test-drive-client-id';
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    mockGetAuthenticatedUserId.mockImplementation(async (req: NextRequest) => {
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      if (!token || /bad|invalid|expired/i.test(token)) return null;
      return 'user-123';
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;
  });

  it('redirects to error when GOOGLE_DRIVE_CLIENT_ID is missing', async () => {
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=google_drive');
  });

  it('redirects to /login when no session cookie is present', async () => {
    const req = makeRequest();
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/login$/);
  });

  it('redirects to Google OAuth consent screen on success', async () => {
    const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('client_id')).toBe('test-drive-client-id');
    expect(decodeURIComponent(location.searchParams.get('scope') || '')).toContain('drive.file');
    expect(location.searchParams.get('access_type')).toBe('offline');
  });
});
