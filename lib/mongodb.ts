import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI!;
if (!MONGODB_URI) throw new Error('MONGODB_URI is not set');

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

export async function connectToDatabase() {
  if (cached!.conn) return cached!.conn;
  if (!cached!.promise) {
    cached!.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false });
  }
  try {
    cached!.conn = await cached!.promise;
  } catch (error) {
    cached!.promise = null;
    throw error;
  }
  return cached!.conn;
}
