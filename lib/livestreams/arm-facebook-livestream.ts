import {
  findFacebookLivestreamArmConflict,
  type LivestreamArmConflict,
} from '@/lib/livestreams/key-slot-conflict';
import { createFacebookLiveVideo } from '@/lib/platforms/facebook-livestream-api';
import { updateLivestream } from '@/lib/repositories/livestreams';
import type { Livestream } from '@/types';

/**
 * Failure result when arming a Facebook livestream cannot complete.
 * @property details - Human-readable failure reason.
 * @property statusCode - HTTP status for API routes (`502` indicates a Facebook upstream error).
 */
export type ArmFacebookLivestreamFailure = {
  ok: false;
  details: string;
  statusCode: 400 | 404 | 409 | 502;
};

/**
 * Result of arming a scheduled Facebook livestream for RTMPS ingest.
 * @property livestream - Updated livestream row.
 * @property conflict - Another armed Facebook livestream for this user, if any.
 */
export type ArmFacebookLivestreamResult =
  | {
      ok: true;
      livestream: Livestream;
      conflict: LivestreamArmConflict | null;
    }
  | ArmFacebookLivestreamFailure;

/**
 * Creates a Facebook `LiveVideo` and persists arm metadata on a scheduled livestream row.
 * @param pageAccessToken - Resolved Page access token with live video permissions.
 * @param pageId - Facebook Page ID that owns the live video.
 * @param livestream - Livestream row to arm (must be scheduled with Facebook targeted).
 * @param armedFacebookLivestream - Another armed Facebook livestream for conflict detection, if any.
 * @returns Updated row and optional conflict metadata, or upstream error details.
 */
export async function armFacebookLivestream(
  pageAccessToken: string,
  pageId: string,
  livestream: Livestream,
  armedFacebookLivestream: Livestream | null
): Promise<ArmFacebookLivestreamResult> {
  if (livestream.status !== 'scheduled') {
    return {
      ok: false,
      details: 'Only scheduled livestreams can be armed for Facebook.',
      statusCode: 409,
    };
  }

  if (!livestream.targets.includes('facebook')) {
    return {
      ok: false,
      details: 'Livestream targets must include facebook to arm for Facebook.',
      statusCode: 409,
    };
  }

  const conflict = findFacebookLivestreamArmConflict(armedFacebookLivestream, livestream.id);

  const created = await createFacebookLiveVideo(pageAccessToken, pageId, {
    title: livestream.title,
    description: livestream.description,
  });
  if (created.ok === false) {
    return { ok: false, details: created.details, statusCode: 502 };
  }

  console.log(
    `[armFacebookLivestream] livestreamId=${livestream.id} facebookLiveVideoId=${created.id} pageId=${pageId}`
  );

  const updated = await updateLivestream(livestream.id, {
    facebookLiveVideoId: created.id,
    facebookStreamUrl: created.secureStreamUrl,
    facebookArmedAt: new Date().toISOString(),
    facebookLifecycleStatus: 'LIVE_NOW',
  });

  if (!updated) {
    return { ok: false, details: 'Livestream not found.', statusCode: 404 };
  }

  return { ok: true, livestream: updated, conflict };
}
