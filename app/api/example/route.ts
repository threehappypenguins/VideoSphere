// =============================================================================
// EXAMPLE API ROUTE
// =============================================================================
// Demonstrates the Next.js App Router API route pattern with both GET and POST
// handlers. Use this as a reference for creating your own API routes.
//
// Endpoints:
//   GET  /api/example  — Returns a list of example items
//   POST /api/example  — Creates a new example item
//
// Key patterns demonstrated:
//   - TypeScript request/response typing
//   - Try/catch error handling
//   - Proper HTTP status codes (200, 201, 400, 500)
//   - NextResponse.json() usage
//   - Request body parsing and validation
//
// See /docs/api-routes.md for detailed guidance on creating API routes.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import type { ExampleItem, ApiResponse, ApiError } from '@/types';

// --- Placeholder data ---
// STUDENT: Replace this with real data from your database.
// This in-memory array is for demonstration only — it resets on every server restart.
const exampleItems: ExampleItem[] = [
  {
    id: '1',
    title: 'Example Item One',
    description: 'This is a placeholder item demonstrating the API response pattern.',
    createdAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Example Item Two',
    description: 'Another placeholder item. Replace these with real data from your database.',
    createdAt: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'Example Item Three',
    description: 'A third placeholder item to demonstrate a collection response.',
    createdAt: new Date().toISOString(),
  },
];

/**
 * GET /api/example
 * Returns a list of example items.
 * Demonstrates the collection response pattern.
 */
export async function GET() {
  try {
    // In a real app, you would fetch from your database here.
    // Example with Supabase: const { data } = await supabase.from('items').select('*')
    const response: ApiResponse<ExampleItem[]> = {
      data: exampleItems,
      message: 'Items retrieved successfully',
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching items:', error);

    const errorResponse: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to fetch items',
      statusCode: 500,
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

/**
 * POST /api/example
 * Creates a new example item.
 * Demonstrates request body parsing, validation, and the created response pattern.
 */
export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const body = await request.json();

    // --- Validation ---
    // STUDENT: For production apps, consider using a validation library like Zod
    // for more robust validation. Example:
    //   const schema = z.object({ title: z.string().min(1), description: z.string() })
    //   const validated = schema.parse(body)
    if (!body.title || typeof body.title !== 'string') {
      const errorResponse: ApiError = {
        error: 'Bad Request',
        message: 'Title is required and must be a string',
        statusCode: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    if (!body.description || typeof body.description !== 'string') {
      const errorResponse: ApiError = {
        error: 'Bad Request',
        message: 'Description is required and must be a string',
        statusCode: 400,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // --- Create the item ---
    // In a real app, you would insert into your database here.
    const newItem: ExampleItem = {
      id: String(Date.now()), // Use a proper UUID in production
      title: body.title,
      description: body.description,
      createdAt: new Date().toISOString(),
    };

    const response: ApiResponse<ExampleItem> = {
      data: newItem,
      message: 'Item created successfully',
    };

    // Return 201 Created for successful creation
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating item:', error);

    const errorResponse: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to create item',
      statusCode: 500,
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}
