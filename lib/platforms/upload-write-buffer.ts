import { Transform } from 'node:stream';

/** Target size for batched backup uploads (matches YouTube resumable upload chunk sizing). */
export const BACKUP_UPLOAD_WRITE_CHUNK_TARGET = 8 * 1024 * 1024;

function concatUint8Arrays(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array
): Uint8Array<ArrayBufferLike> {
  if (left.length === 0) {
    return right;
  }
  if (right.length === 0) {
    return left;
  }
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

/**
 * Batches small ReadableStream chunks into fewer network writes for better throughput on large files.
 */
export class UploadWriteBuffer {
  private pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private readonly chunkTarget: number;

  /**
   * @param chunkTarget - Target block size in bytes; defaults to {@link BACKUP_UPLOAD_WRITE_CHUNK_TARGET}.
   * @throws {RangeError} When `chunkTarget` is not a positive finite integer.
   */
  constructor(chunkTarget = BACKUP_UPLOAD_WRITE_CHUNK_TARGET) {
    if (!Number.isFinite(chunkTarget) || !Number.isInteger(chunkTarget) || chunkTarget < 1) {
      throw new RangeError('UploadWriteBuffer chunkTarget must be a positive integer.');
    }
    this.chunkTarget = chunkTarget;
  }

  /**
   * Appends a source chunk and returns full target-sized blocks ready to write.
   * @param chunk - Bytes from the upstream video stream.
   * @returns Chunks of up to the configured target size.
   */
  takeWritableChunks(chunk: Uint8Array): Uint8Array[] {
    this.pending = concatUint8Arrays(this.pending, chunk);
    const chunks: Uint8Array[] = [];

    while (this.pending.length >= this.chunkTarget) {
      chunks.push(this.pending.subarray(0, this.chunkTarget));
      this.pending = this.pending.subarray(this.chunkTarget);
    }

    return chunks;
  }

  /**
   * Drains any bytes smaller than the target chunk size at end of stream.
   * @returns Final partial chunk, if any.
   */
  takeRemainder(): Uint8Array | null {
    if (this.pending.length === 0) {
      return null;
    }
    const remainder = this.pending;
    this.pending = new Uint8Array(0);
    return remainder;
  }
}

/**
 * Node transform that coalesces small upstream chunks before writing to SMB/SFTP-style sinks.
 * @returns Transform stream emitting up to {@link BACKUP_UPLOAD_WRITE_CHUNK_TARGET} byte blocks.
 */
export function createUploadWriteBufferTransform(): Transform {
  const buffer = new UploadWriteBuffer();

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        for (const block of buffer.takeWritableChunks(new Uint8Array(chunk))) {
          this.push(Buffer.from(block));
        }
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
    flush(callback) {
      try {
        const remainder = buffer.takeRemainder();
        if (remainder) {
          this.push(Buffer.from(remainder));
        }
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}
