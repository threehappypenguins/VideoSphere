import {
  attemptPromoteTempLivestreamToMain,
  computeTempToMainPromotionAt,
} from '@/lib/livestreams/promote-temp-to-main';
import { listAllArmedYouTubeLivestreams } from '@/lib/repositories/livestreams';
import type { Livestream } from '@/types';

/** Maximum delay supported by a single `setTimeout` in Node (~24.8 days). */
const MAX_SET_TIMEOUT_MS = 2_147_483_647;

type GlobalWithPromotionScheduler = typeof globalThis & {
  _tempToMainPromotionTimers?: Map<string, ReturnType<typeof setTimeout>>;
  _tempToMainPromotionBootstrapStarted?: boolean;
};

const globalWithScheduler = globalThis as GlobalWithPromotionScheduler;

function promotionTimers(): Map<string, ReturnType<typeof setTimeout>> {
  if (!globalWithScheduler._tempToMainPromotionTimers) {
    globalWithScheduler._tempToMainPromotionTimers = new Map();
  }
  return globalWithScheduler._tempToMainPromotionTimers;
}

function scheduleAt(targetMs: number, onFire: () => void): ReturnType<typeof setTimeout> {
  const delay = targetMs - Date.now();
  if (delay <= 0) {
    return setTimeout(onFire, 0);
  }
  if (delay > MAX_SET_TIMEOUT_MS) {
    return setTimeout(() => {
      scheduleAt(targetMs, onFire);
    }, MAX_SET_TIMEOUT_MS);
  }
  return setTimeout(onFire, delay);
}

/**
 * Cancels a scheduled temp→main promotion for a livestream.
 * @param livestreamId - Livestream row id.
 */
export function cancelTempToMainPromotionSchedule(livestreamId: string): void {
  const timers = promotionTimers();
  const existing = timers.get(livestreamId);
  if (existing) {
    clearTimeout(existing);
    timers.delete(livestreamId);
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

  const targetMs = promotionAt.getTime();
  const timer = scheduleAt(targetMs, () => {
    void runScheduledPromotion(livestream.id);
  });
  promotionTimers().set(livestream.id, timer);
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
