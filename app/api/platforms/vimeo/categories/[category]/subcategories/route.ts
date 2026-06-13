import { NextRequest, NextResponse } from 'next/server';
import {
  fetchVimeoCategorySubcategories,
  requireVimeoConnection,
  vimeoUpstreamErrorResponse,
} from '@/lib/platforms/vimeo-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns subcategories for one top-level Vimeo category.
 * @param req - Incoming GET request.
 * @param context - Dynamic route params containing the category slug.
 * @returns JSON subcategory rows, or a structured error.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ category: string }> }) {
  const connection = await requireVimeoConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  const { category } = await context.params;
  const categorySlug = decodeURIComponent(category).trim();
  if (!categorySlug) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Category slug is required.',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  try {
    const result = await fetchVimeoCategorySubcategories(
      categorySlug,
      connection.accessToken,
      req.signal
    );
    if (result.ok === false) {
      return vimeoUpstreamErrorResponse(result.details);
    }

    const res: ApiResponse<Array<{ uri: string; name: string }>> = { data: result.items };
    return NextResponse.json(res, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error(
      `[GET /api/platforms/vimeo/categories/${categorySlug}/subcategories] Unexpected error:`,
      err
    );
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load Vimeo subcategories',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
