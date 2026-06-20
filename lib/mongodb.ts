import mongoose from 'mongoose';

// Singleton for Next.js hot-reload
const globalWithMongoose = global as typeof global & { mongoose?: typeof import('mongoose') };

let cached = (
  globalWithMongoose as {
    _mongooseCache?: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
  }
)._mongooseCache;
if (!cached) {
  cached = (globalWithMongoose as any)._mongooseCache = { conn: null, promise: null };
}

let setupBootstrapStarted = false;
let staleUploadReconcileStarted = false;

/**
 * Ensures first-run setup token bootstrap runs once per process after DB connects.
 */
function scheduleFirstRunSetupBootstrap(): void {
  if (setupBootstrapStarted) return;
  setupBootstrapStarted = true;

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
  if (staleUploadReconcileStarted) return;
  staleUploadReconcileStarted = true;

  void import('@/lib/uploads/reconcile-stale-distribution')
    .then((mod) => mod.reconcileStaleUploadDistribution())
    .catch((error) => {
      console.error('[reconcile] Failed to reconcile stale upload distribution on startup:', error);
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
  } catch (error) {
    cached!.promise = null;
    throw error;
  }
  return cached!.conn;
}
