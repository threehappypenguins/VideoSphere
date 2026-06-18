import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  isValidGoogleDriveBackupFolderPath,
  normalizeGoogleDriveBackupFolderPath,
  parseGoogleDrivePlatformUserId,
  resolveGoogleDriveBackupRootFolderId,
  serializeGoogleDrivePlatformUserId,
} from '@/lib/platforms/google-drive';
import {
  getConnectedAccountWithTokens,
  updateGoogleDriveBackupFolder,
} from '@/lib/repositories/connected-accounts';
import type { ApiError } from '@/types';

interface UpdateGoogleDriveSettingsBody {
  backupFolderPath?: unknown;
}

/**
 * Updates Google Drive backup folder settings for the authenticated user's connection.
 * @param req - Request containing the desired backup folder path.
 * @returns Updated connection metadata on success.
 */
export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  let body: UpdateGoogleDriveSettingsBody;
  try {
    body = (await req.json()) as UpdateGoogleDriveSettingsBody;
  } catch {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Request body must be valid JSON',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (typeof body.backupFolderPath !== 'string') {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'backupFolderPath must be a string',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const backupFolderPath = normalizeGoogleDriveBackupFolderPath(body.backupFolderPath);
  if (!isValidGoogleDriveBackupFolderPath(backupFolderPath)) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message:
        'backupFolderPath must be empty (Drive root) or a valid folder path without . or .. segments',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  try {
    const account = await getConnectedAccountWithTokens(userId, 'google_drive');
    if (!account) {
      const errRes: ApiError = {
        error: 'Not Found',
        message: 'Google Drive is not connected',
        statusCode: 404,
      };
      return NextResponse.json(errRes, { status: 404 });
    }

    const parsed = parseGoogleDrivePlatformUserId(account.platformUserId);
    let rootFolderId: string | undefined;

    if (backupFolderPath) {
      rootFolderId = await resolveGoogleDriveBackupRootFolderId(
        backupFolderPath,
        account.accessToken
      );
      if (!rootFolderId) {
        const errRes: ApiError = {
          error: 'Bad Request',
          message: 'Could not resolve the configured Google Drive backup folder',
          statusCode: 400,
        };
        return NextResponse.json(errRes, { status: 400 });
      }
    }

    const platformUserId = serializeGoogleDrivePlatformUserId(parsed.permissionId, rootFolderId);
    const updated = await updateGoogleDriveBackupFolder(
      account.id,
      backupFolderPath,
      platformUserId
    );

    if (!updated) {
      const errRes: ApiError = {
        error: 'Internal Server Error',
        message: 'Failed to update Google Drive settings',
        statusCode: 500,
      };
      return NextResponse.json(errRes, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    console.error('[POST /api/platforms/connect/drive/settings] Unexpected error:', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to update Google Drive settings',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
