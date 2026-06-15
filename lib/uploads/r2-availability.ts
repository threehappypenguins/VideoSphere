import { headObject, R2ObjectNotFoundError } from '@/lib/r2';

/** Max parallel R2 HEAD calls per upload-history request (unique keys, after retryability filter). */
export const R2_HEAD_CONCURRENCY = 8;

/**
 * Returns whether an R2 object exists, using `cache` to dedupe HEAD calls within one request.
 * @param key - R2 object key.
 * @param cache - Mutable map populated as keys are checked.
 * @returns `true` when the object exists, `false` when it is missing.
 */
export async function checkR2Availability(
  key: string,
  cache: Map<string, boolean>
): Promise<boolean> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    await headObject(key);
    cache.set(key, true);
    return true;
  } catch (error) {
    if (error instanceof R2ObjectNotFoundError) {
      cache.set(key, false);
      return false;
    }
    throw error;
  }
}

/**
 * Runs async work on `items` with at most `limit` concurrent executions.
 * @param items - Work items to process.
 * @param limit - Maximum concurrent workers.
 * @param fn - Async handler invoked once per item.
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const cap = Math.min(Math.max(1, limit), items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: cap }, () => worker()));
}

/**
 * HEAD unique R2 keys (deduped) and return an availability map for upload-history retry UI.
 * @param keys - R2 object keys to check (duplicates are ignored).
 * @param options - Optional tuning; defaults to {@link R2_HEAD_CONCURRENCY}.
 * @returns Map from key to `true` (exists) or `false` (missing).
 */
export async function resolveR2AvailabilityForKeys(
  keys: Iterable<string>,
  options?: { concurrency?: number }
): Promise<Map<string, boolean>> {
  const cache = new Map<string, boolean>();
  const uniqueKeys = [...new Set(keys)];
  await runWithConcurrency(uniqueKeys, options?.concurrency ?? R2_HEAD_CONCURRENCY, async (key) => {
    await checkR2Availability(key, cache);
  });
  return cache;
}

/**
 * Resolves `r2FileAvailable` for a job that may need retry, using a pre-built availability map.
 * @param needsR2Head - Whether any retryable failed platform on the job requires a HEAD check.
 * @param r2Key - Job R2 key, if any.
 * @param availabilityByKey - Map from {@link resolveR2AvailabilityForKeys}.
 * @returns `null` when no HEAD was needed; otherwise whether the file still exists.
 */
export function r2FileAvailableForRetryJob(
  needsR2Head: boolean,
  r2Key: string | null | undefined,
  availabilityByKey: ReadonlyMap<string, boolean>
): boolean | null {
  if (!needsR2Head) return null;
  if (r2Key) {
    return availabilityByKey.get(r2Key) ?? false;
  }
  return false;
}
