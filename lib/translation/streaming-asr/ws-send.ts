// =============================================================================
// Safe WebSocket send helpers for streaming ASR adapters
// =============================================================================

import type WebSocket from 'ws';

/**
 * Sends a binary PCM frame on an open `ws` socket.
 * Converts Node `Buffer` to a plain `Uint8Array` so optional native helpers
 * (`bufferutil`) are less likely to mis-handle webpack/Turbopack views.
 * @param socket - Open WebSocket client.
 * @param pcm - PCM16 LE mono bytes.
 */
export function sendWsBinary(socket: WebSocket, pcm: Buffer): void {
  if (pcm.byteLength === 0) return;
  // Copy into a standalone Buffer so optional native helpers (`bufferutil`) never
  // see SharedArrayBuffer / pooled views, and force the binary opcode explicitly.
  socket.send(Buffer.from(pcm), { binary: true });
}

/**
 * Sends a text/JSON frame on an open `ws` socket.
 * @param socket - Open WebSocket client.
 * @param data - UTF-8 text payload.
 */
export function sendWsText(socket: WebSocket, data: string): void {
  socket.send(data);
}
