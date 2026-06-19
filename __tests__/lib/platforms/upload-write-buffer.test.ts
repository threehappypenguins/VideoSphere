import { describe, expect, it } from 'vitest';
import {
  BACKUP_UPLOAD_WRITE_CHUNK_TARGET,
  UploadWriteBuffer,
  createUploadWriteBufferTransform,
} from '@/lib/platforms/upload-write-buffer';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

describe('upload write buffer', () => {
  it('emits 8 MB blocks from many small chunks', () => {
    const buffer = new UploadWriteBuffer();
    const smallChunk = new Uint8Array(64 * 1024);
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < 130; i += 1) {
      chunks.push(...buffer.takeWritableChunks(smallChunk));
    }

    const remainder = buffer.takeRemainder();
    if (remainder) {
      chunks.push(remainder);
    }

    expect(chunks.length).toBeLessThan(130);
    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(smallChunk.length * 130);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(
      BACKUP_UPLOAD_WRITE_CHUNK_TARGET
    );
    expect(
      chunks.filter((chunk) => chunk.length === BACKUP_UPLOAD_WRITE_CHUNK_TARGET).length
    ).toBeGreaterThan(0);
  });

  it('honors a custom chunk target size', () => {
    const customTarget = 32 * 1024;
    const buffer = new UploadWriteBuffer(customTarget);
    const chunks = buffer.takeWritableChunks(new Uint8Array(customTarget + 1));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.length).toBe(customTarget);
    expect(buffer.takeRemainder()?.length).toBe(1);
  });

  it('transform coalesces small writes for pipeline consumers', async () => {
    const smallChunkSize = 64 * 1024;
    const chunkCount = 130;
    const writeSizes: number[] = [];

    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < chunkCount; i += 1) {
          controller.enqueue(new Uint8Array(smallChunkSize));
        }
        controller.close();
      },
    });

    const nodeReadable = (await import('node:stream')).Readable.fromWeb(
      source as import('node:stream/web').ReadableStream<Uint8Array>
    );

    const sink = new Writable({
      write(chunk, _encoding, callback) {
        writeSizes.push(chunk.length);
        callback();
      },
    });

    await pipeline(nodeReadable, createUploadWriteBufferTransform(), sink);

    expect(writeSizes.length).toBeLessThan(chunkCount);
    expect(writeSizes.reduce((sum, size) => sum + size, 0)).toBe(smallChunkSize * chunkCount);
    expect(Math.max(...writeSizes)).toBeLessThanOrEqual(BACKUP_UPLOAD_WRITE_CHUNK_TARGET);
  });
});
