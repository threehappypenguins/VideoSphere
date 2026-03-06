// =============================================================================
// POST /api/auth/login
// =============================================================================
// Creates session via admin client (API key with sessions.write) and sets
// cookie server-side. Per Appwrite Next.js SSR tutorial.
// https://appwrite.io/docs/tutorials/nextjs-ssr-auth/step-5
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName, getSessionCookieOptions } from '@/lib/auth-session-cookie';
import { appwriteAuth } from '@/lib/appwrite';

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }
    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a JSON object.' }, { status: 400 });
    }

    const { email: rawEmail, password: rawPassword } = body as Record<string, unknown>;
    if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') {
      return NextResponse.json(
        { error: 'Email and password are required and must be strings.' },
        { status: 400 }
      );
    }

    const email = rawEmail.trim().toLowerCase();
    const password = rawPassword;
    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    if (!projectId) {
      return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 });
    }

    let session: { secret?: string } | undefined;
    try {
      session = await appwriteAuth.createEmailPasswordSession({ email, password });
    } catch (sessionErr) {
      const err = sessionErr as { code?: number };
      if (err?.code === 401 || (sessionErr as Error)?.message?.toLowerCase().includes('invalid')) {
        return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
      }
      throw sessionErr;
    }

    const secret =
      session && typeof session === 'object' && 'secret' in session ? session.secret : undefined;
    if (typeof secret !== 'string' || secret.length === 0) {
      return NextResponse.json({ error: 'Session could not be created.' }, { status: 500 });
    }

    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.cookies.set(getSessionCookieName(projectId), secret, getSessionCookieOptions());
    return res;
  } catch (err) {
    console.error('[POST /api/auth/login]', err);
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
