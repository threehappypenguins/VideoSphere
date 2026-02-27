// =============================================================================
// HEALTH CHECK API ROUTE
// =============================================================================
// A simple health check endpoint. Useful for monitoring, load balancers,
// and verifying your deployment is running correctly.
//
// Usage: GET /api/health
// Returns: { status: 'ok', timestamp: string, environment: string }
//
// This is a Next.js App Router Route Handler. Learn more:
// https://nextjs.org/docs/app/building-your-application/routing/route-handlers
//
// See /docs/api-routes.md for detailed guidance on creating API routes.
// =============================================================================

import { NextResponse } from 'next/server';

/**
 * GET /api/health
 * Returns the health status of the application.
 */
export async function GET() {
  try {
    return NextResponse.json(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
      },
      { status: 200 }
    );
  } catch (error) {
    // If something goes wrong, return a 500 error
    console.error('Health check failed:', error);
    return NextResponse.json({ status: 'error', message: 'Health check failed' }, { status: 500 });
  }
}
