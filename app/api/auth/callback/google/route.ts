import { NextRequest, NextResponse } from 'next/server';
import { Client, Databases } from 'node-appwrite';

/**
 * POST /api/auth/callback/google
 *
 * Creates or updates the user_profiles document for a newly authenticated user.
 * Called by the callback page after successful OAuth.
 *
 * The session is established by Appwrite's OAuth and the browser has cookies.
 * This endpoint uses an API key to create/verify the user_profiles document in Appwrite.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, email } = body;

    if (!userId || !email) {
      return NextResponse.json({ error: 'Missing userId or email' }, { status: 400 });
    }

    // Initialize Appwrite admin client (uses API key)
    const adminClient = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
      .setKey(process.env.APPWRITE_API_KEY!);

    const databases = new Databases(adminClient);
    const DATABASE_ID = 'videosphere';
    const COLLECTION_ID = 'user_profiles';

    // Check if user_profiles document already exists
    try {
      await databases.getDocument(DATABASE_ID, COLLECTION_ID, userId);
      console.log(`[POST /api/auth/callback/google] User profile already exists for ${userId}`);
      return NextResponse.json({ success: true, message: 'Profile already exists' });
    } catch (docError: any) {
      // Document doesn't exist (404), so create it for new users
      if (docError.code === 404 || docError.message?.includes('not found')) {
        console.log(
          `[POST /api/auth/callback/google] Creating new user_profiles for user ${userId}`
        );

        try {
          await databases.createDocument(DATABASE_ID, COLLECTION_ID, userId, {
            userId,
            email,
            isSupporter: false,
            role: 'user',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          return NextResponse.json({ success: true, message: 'Profile created' });
        } catch (createError: unknown) {
          // Race: two requests (e.g. Strict Mode) both tried to create; one wins, the other gets 409
          const err = createError as { code?: number };
          if (err.code === 409) {
            console.log(
              `[POST /api/auth/callback/google] User profile already exists (race) for ${userId}`
            );
            return NextResponse.json({ success: true, message: 'Profile already exists' });
          }
          throw createError;
        }
      } else {
        throw docError;
      }
    }
  } catch (error) {
    console.error('[POST /api/auth/callback/google] Error:', error);
    return NextResponse.json({ error: 'Failed to create or verify user profile' }, { status: 500 });
  }
}

/**
 * GET /api/auth/callback/google
 *
 * This endpoint is no longer used (OAuth callback is now a page route).
 * Kept for backwards compatibility.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'OAuth callback is handled by /auth/callback/google page route' },
    { status: 404 }
  );
}
