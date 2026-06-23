import mongoose from 'mongoose';

/** Process-wide bootstrap flags and timers (survives Next.js dev module reload). */
interface ProcessBootstrapState {
  setupBootstrapStarted: boolean;
  staleUploadReconcileStarted: boolean;
  livestreamKeyReconcileStarted: boolean;
  livestreamKeyReconcileIntervalId: ReturnType<typeof setInterval> | null;
}

type GlobalWithMongoose = typeof globalThis & {
  _mongooseCache?: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
  _videosphereProcessBootstrap?: ProcessBootstrapState;
};

const globalWithMongoose = globalThis as GlobalWithMongoose;

let cached = globalWithMongoose._mongooseCache;
if (!cached) {
  cached = globalWithMongoose._mongooseCache = { conn: null, promise: null };
}

/**
 * Returns bootstrap state shared across module reloads in the same Node process.
 * @returns Mutable singleton used to gate one-time startup tasks.
 */
function getProcessBootstrapState(): ProcessBootstrapState {
  if (!globalWithMongoose._videosphereProcessBootstrap) {
    globalWithMongoose._videosphereProcessBootstrap = {
      setupBootstrapStarted: false,
      staleUploadReconcileStarted: false,
      livestreamKeyReconcileStarted: false,
      livestreamKeyReconcileIntervalId: null,
    };
  }
  return globalWithMongoose._videosphereProcessBootstrap;
}

/**
 * Ensures first-run setup token bootstrap runs once per process after DB connects.
 */
function scheduleFirstRunSetupBootstrap(): void {
  const bootstrap = getProcessBootstrapState();
  if (bootstrap.setupBootstrapStarted) return;
  bootstrap.setupBootstrapStarted = true;

  void import('@/lib/bootstrap/setup-token')
    .then((mod) => mod.bootstrapFirstRunSetupToken())
    .catch((error) => {
      console.error('[Setup] Failed to bootstrap first-run setup token', error);
    });
}

/**
 * Marks stale in-progress upload rows failed once per process after the first DB connect.
 */
function scheduleStaleUploadReconciliation(): void {
  const bootstrap = getProcessBootstrapState();
  if (bootstrap.staleUploadReconcileStarted) return;
  bootstrap.staleUploadReconcileStarted = true;

  void import('@/lib/uploads/reconcile-stale-distribution')
    .then((mod) => mod.reconcileStaleUploadDistribution())
    .catch((error) => {
      console.error('[reconcile] Failed to reconcile stale upload distribution on startup:', error);
    });
}

/**
 * Starts periodic livestream key-slot reconciliation once per process after the first DB connect.
 */
function scheduleLivestreamKeyReconciliation(): void {
  const bootstrap = getProcessBootstrapState();
  if (bootstrap.livestreamKeyReconcileStarted) return;
  bootstrap.livestreamKeyReconcileStarted = true;

  void import('@/lib/livestreams/reconcile-stream-keys')
    .then((mod) => {
      if (bootstrap.livestreamKeyReconcileIntervalId != null) {
        return;
      }

      const intervalMs = mod.resolveLivestreamReconcileIntervalMs();
      const run = () => {
        void mod.reconcileLivestreamKeysAndStatus().catch((error) => {
          console.error('[reconcile] Failed to reconcile livestream keys and status:', error);
        });
        void import('@/lib/livestreams/reconcile-facebook-livestreams')
          .then((fbMod) => fbMod.reconcileFacebookLivestreamStatus())
          .catch((error) => {
            console.error(
              '[reconcile-facebook] Failed to reconcile Facebook livestream status:',
              error
            );
          });
      };
      run();
      bootstrap.livestreamKeyReconcileIntervalId = setInterval(run, intervalMs);
    })
    .catch((error) => {
      bootstrap.livestreamKeyReconcileStarted = false;
      console.error('[reconcile] Failed to start livestream key reconciliation:', error);
    });

  void import('@/lib/livestreams/temp-to-main-promotion-scheduler')
    .then((mod) => mod.ensureTempToMainPromotionSchedulesBootstrapped())
    .catch((error) => {
      console.error('[promote] Failed to start temp→main promotion scheduler:', error);
    });

  void import('@/lib/livestreams/facebook-deferred-arm-scheduler')
    .then((mod) => mod.ensureFacebookDeferredArmSchedulesBootstrapped())
    .catch((error) => {
      console.error('[facebook-arm] Failed to start deferred arm scheduler:', error);
    });
}

/**
 * Establishes and caches the shared MongoDB connection for the current process.
 * @returns The connected Mongoose instance.
 */
export async function connectToDatabase() {
  if (cached!.conn) {
    scheduleFirstRunSetupBootstrap();
    scheduleStaleUploadReconciliation();
    scheduleLivestreamKeyReconciliation();
    return cached!.conn;
  }
  if (!cached!.promise) {
    const mongodbUri = process.env.MONGODB_URI;
    if (!mongodbUri) {
      throw new Error('MONGODB_URI is not set');
    }
    cached!.promise = mongoose.connect(mongodbUri, { bufferCommands: false });
  }
  try {
    cached!.conn = await cached!.promise;
    scheduleFirstRunSetupBootstrap();
    scheduleStaleUploadReconciliation();
    scheduleLivestreamKeyReconciliation();
  } catch (error) {
    cached!.promise = null;
    throw error;
  }
  return cached!.conn;
}
