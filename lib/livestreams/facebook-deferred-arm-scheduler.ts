import { attemptDeferredFacebookArm } from '@/lib/livestreams/attempt-deferred-facebook-arm';
import { computeFacebookDeferredArmAt } from '@/lib/livestreams/facebook-arm-assignment';
import { PROMOTION_SCHEDULE_MAX_HOP_MS } from '@/lib/livestreams/temp-to-main-promotion-scheduler';
import { listAllPendingFacebookDeferredArms } from '@/lib/repositories/livestreams';
import type { Livestream } from '@/types';

type DeferredArmScheduleEntry = {
  timer: ReturnType<typeof setTimeout>;
  token: symbol;
};

type GlobalWithFacebookArmScheduler = typeof globalThis & {
  _facebookDeferredArmSchedules?: Map<string, DeferredArmScheduleEntry>;
  _facebookDeferredArmBootstrapStarted?: boolean;
};

const globalWithScheduler = globalThis as GlobalWithFacebookArmScheduler;

function deferredArmSchedules(): Map<string, DeferredArmScheduleEntry> {
  if (!globalWithScheduler._facebookDeferredArmSchedules) {
    globalWithScheduler._facebookDeferredArmSchedules = new Map();
  }
  return globalWithScheduler._facebookDeferredArmSchedules;
}

function scheduleDeferredArmAt(
  livestreamId: string,
  targetMs: number,
  token: symbol,
  onFire: () => void
): void {
  const schedules = deferredArmSchedules();
  const delay = targetMs - Date.now();

  if (delay <= 0) {
    const timer = setTimeout(() => {
      if (schedules.get(livestreamId)?.token !== token) {
        return;
      }
      schedules.delete(livestreamId);
      onFire();
    }, 0);
    schedules.set(livestreamId, { timer, token });
    return;
  }

  const timer = setTimeout(
    () => {
      if (schedules.get(livestreamId)?.token !== token) {
        return;
      }
      const remainingDelay = targetMs - Date.now();
      if (remainingDelay <= 0) {
        schedules.delete(livestreamId);
        onFire();
        return;
      }
      scheduleDeferredArmAt(livestreamId, targetMs, token, onFire);
    },
    Math.min(delay, PROMOTION_SCHEDULE_MAX_HOP_MS)
  );

  schedules.set(livestreamId, { timer, token });
}

/**
 * Cancels a scheduled deferred Facebook arm for a livestream.
 * @param livestreamId - Livestream row id.
 */
export function cancelFacebookDeferredArmSchedule(livestreamId: string): void {
  const schedules = deferredArmSchedules();
  const existing = schedules.get(livestreamId);
  if (existing) {
    clearTimeout(existing.timer);
    schedules.delete(livestreamId);
  }
}

async function runScheduledDeferredArm(livestreamId: string): Promise<void> {
  cancelFacebookDeferredArmSchedule(livestreamId);

  const result = await attemptDeferredFacebookArm(livestreamId);
  if (result.ok === true) {
    console.log(
      `[facebook-arm] Created deferred Facebook LiveVideo for livestream ${livestreamId} at ${result.livestream.facebookArmedAt ?? 'scheduled time'}.`
    );
    return;
  }

  if (
    result.reason === 'not_eligible' ||
    result.reason === 'not_found' ||
    result.reason === 'not_queue_head'
  ) {
    return;
  }

  if (result.reason === 'blocked') {
    const livestream = await import('@/lib/repositories/livestreams').then((mod) =>
      mod.getLivestreamById(livestreamId)
    );
    if (livestream) {
      syncFacebookDeferredArmSchedule(livestream);
    }
    return;
  }

  console.warn(
    `[facebook-arm] Scheduled deferred arm for livestream ${livestreamId} did not complete: ${result.details}`
  );
}

/**
 * Schedules (or immediately runs) deferred Facebook LiveVideo creation for one livestream.
 * @param livestream - Current livestream row used to derive the preparation instant.
 */
export function syncFacebookDeferredArmSchedule(
  livestream: Pick<
    Livestream,
    | 'id'
    | 'status'
    | 'targets'
    | 'scheduledStartTime'
    | 'facebookLiveVideoId'
    | 'autoPromoteToMainKey'
    | 'autoPromoteToMainKeyMinutes'
  >
): void {
  cancelFacebookDeferredArmSchedule(livestream.id);

  const armAt = computeFacebookDeferredArmAt(livestream);
  if (!armAt) {
    return;
  }

  const token = Symbol(`facebook-arm:${livestream.id}`);
  scheduleDeferredArmAt(livestream.id, armAt.getTime(), token, () => {
    void runScheduledDeferredArm(livestream.id);
  });
}

/**
 * Loads all queued Facebook livestreams and schedules their preparation instants.
 * Safe to call on process startup after MongoDB connects.
 */
export async function bootstrapFacebookDeferredArmSchedules(): Promise<void> {
  const pendingByUser = await listAllPendingFacebookDeferredArms();
  for (const pendingLivestreams of pendingByUser.values()) {
    for (const livestream of pendingLivestreams) {
      syncFacebookDeferredArmSchedule(livestream);
    }
  }
}

/**
 * Ensures deferred Facebook arm schedules are registered once per process after DB connects.
 */
export function ensureFacebookDeferredArmSchedulesBootstrapped(): void {
  if (globalWithScheduler._facebookDeferredArmBootstrapStarted) {
    return;
  }
  globalWithScheduler._facebookDeferredArmBootstrapStarted = true;

  void bootstrapFacebookDeferredArmSchedules().catch((error) => {
    globalWithScheduler._facebookDeferredArmBootstrapStarted = false;
    console.error('[facebook-arm] Failed to bootstrap deferred arm schedules:', error);
  });
}
