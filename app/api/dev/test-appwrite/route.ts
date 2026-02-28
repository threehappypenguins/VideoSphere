// =============================================================================
// DEV: Test Appwrite connection
// =============================================================================
// GET /api/dev/test-appwrite — verifies .env.local and connectivity to
// Appwrite. Use this after configuring .env.local to confirm the app can
// reach the DB. Remove or restrict in production.
// =============================================================================

import { Client, TablesDB } from 'node-appwrite';
import { NextResponse } from 'next/server';

export async function GET() {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;

  if (!endpoint || !projectId || !apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Missing Appwrite env vars',
        hint: 'Set NEXT_PUBLIC_APPWRITE_ENDPOINT, NEXT_PUBLIC_APPWRITE_PROJECT_ID, and APPWRITE_API_KEY in .env.local',
        env: {
          hasEndpoint: !!endpoint,
          hasProjectId: !!projectId,
          hasApiKey: !!apiKey,
        },
      },
      { status: 500 }
    );
  }

  try {
    const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const tables = new TablesDB(client);
    await tables.list({ total: true });
    return NextResponse.json({
      ok: true,
      message: 'Connected to Appwrite',
      endpoint,
      projectId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: 'Appwrite request failed',
        message,
        hint: 'Check that Appwrite is running (e.g. cd appwrite && docker compose ps), that the endpoint URL is correct, and that the API key has at least "databases.read" scope.',
      },
      { status: 502 }
    );
  }
}
