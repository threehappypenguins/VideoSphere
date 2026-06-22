import {
  attemptPromoteTempLivestreamToMain,
  computeTempToMainPromotionAt,
} from '@/lib/livestreams/promote-temp-to-main';
import { listAllArmedYouTubeLivestreams } from '@/lib/repositories/livestreams';
import type { Livestream } from '@/types';

/** Maximum delay supported by a single `setTimeout` in Node (~24.8 days). */
export const PROMOTION_SCHEDULE_MAX_HOP_MS = 2_147_483_647;

type PromotionScheduleEntry = {
  timer: ReturnType<typeof setTimeout>;
  token: symbol;
};

type GlobalWithPromotionScheduler = typeof globalThis & {
  _tempToMainPromotionSchedules?: Map<string, PromotionScheduleEntry>;
  _tempToMainPromotionBootstrapStarted?: boolean;
};

const globalWithScheduler = globalThis as GlobalWithPromotionScheduler;

function promotionSchedules(): Map<string, PromotionScheduleEntry> {
  if (!globalWithScheduler._tempToMainPromotionSchedules) {
    globalWithScheduler._tempToMainPromotionSchedules = new Map();
  }
  return globalWithScheduler._tempToMainPromotionSchedules;
}

function schedulePromotionAt(
  livestreamId: string,
  targetMs: number,
  token: symbol,
  onFire: () => void
): void {
  const schedules = promotionSchedules();
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
      schedulePromotionAt(livestreamId, targetMs, token, onFire);
    },
    Math.min(delay, PROMOTION_SCHEDULE_MAX_HOP_MS)
  );

  schedules.set(livestreamId, { timer, token });
}

/**
 * Cancels a scheduled temp→main promotion for a livestream.
 * @param livestreamId - Livestream row id.
 */
export function cancelTempToMainPromotionSchedule(livestreamId: string): void {
  const schedules = promotionSchedules();
  const existing = schedules.get(livestreamId);
  if (existing) {
    clearTimeout(existing.timer);
    schedules.delete(livestreamId);
  }
}

async function runScheduledPromotion(livestreamId: string): Promise<void> {
  cancelTempToMainPromotionSchedule(livestreamId);

  const result = await attemptPromoteTempLivestreamToMain(livestreamId);
  if (result.ok === true) {
    console.log(
      `[promote] Promoted temp-slot livestream ${livestreamId} to main at ${result.livestream.keySwapPromotedAt ?? 'scheduled time'}.`
    );
    return;
  }

  if (result.reason === 'not_eligible' || result.reason === 'not_found') {
    return;
  }

  console.warn(
    `[promote] Scheduled promotion for livestream ${livestreamId} did not complete: ${result.details}`
  );
}

/**
 * Schedules (or immediately runs) the temp→main promotion for one livestream.
 * @param livestream - Current livestream row used to derive the promotion instant.
 */
export function syncTempToMainPromotionSchedule(
  livestream: Pick<
    Livestream,
    | 'id'
    | 'status'
    | 'keySlot'
    | 'scheduledStartTime'
    | 'autoPromoteToMainKey'
    | 'autoPromoteToMainKeyMinutes'
    | 'keySwapPromotedAt'
  >
): void {
  cancelTempToMainPromotionSchedule(livestream.id);

  const promotionAt = computeTempToMainPromotionAt(livestream);
  if (!promotionAt) {
    return;
  }

  const token = Symbol(`promotion:${livestream.id}`);
  schedulePromotionAt(livestream.id, promotionAt.getTime(), token, () => {
    void runScheduledPromotion(livestream.id);
  });
}

/**
 * Loads all armed temp-slot livestreams and schedules their promotion instants.
 * Safe to call on process startup after MongoDB connects.
 */
export async function bootstrapTempToMainPromotionSchedules(): Promise<void> {
  const armedByUser = await listAllArmedYouTubeLivestreams();
  for (const armedLivestreams of armedByUser.values()) {
    for (const livestream of armedLivestreams) {
      syncTempToMainPromotionSchedule(livestream);
    }
  }
}

/**
 * Ensures promotion schedules are registered once per process after DB connects.
 */
export function ensureTempToMainPromotionSchedulesBootstrapped(): void {
  if (globalWithScheduler._tempToMainPromotionBootstrapStarted) {
    return;
  }
  globalWithScheduler._tempToMainPromotionBootstrapStarted = true;

  void bootstrapTempToMainPromotionSchedules().catch((error) => {
    globalWithScheduler._tempToMainPromotionBootstrapStarted = false;
    console.error('[promote] Failed to bootstrap temp→main promotion schedules:', error);
  });
}
