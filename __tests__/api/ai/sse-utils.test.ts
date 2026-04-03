/**
 * Tests for lib/ai/sse-utils — SSE chunk parsing utilities
 *
 * Covers:
 *   - parseSseLine: [DONE] detection
 *   - parseSseLine: delta content extraction
 *   - parseSseLine: upstream error event parsing
 *   - parseSseLine: non-data lines return null
 *   - parseSseLine: malformed JSON is skipped gracefully
 *   - parseSseChunk: multi-line chunk reassembly
 *   - parseSseChunk: accumulation across multiple chunks produces valid JSON
 *   - createSseParser: data: line split across multiple network chunks
 */

import { describe, it, expect } from 'vitest';
import { parseSseLine, parseSseChunk, createSseParser } from '@/lib/ai/sse-utils';

// ---------------------------------------------------------------------------
// parseSseLine
// ---------------------------------------------------------------------------
describe('parseSseLine', () => {
  it('returns null for empty lines', () => {
    expect(parseSseLine('')).toBeNull();
  });

  it('returns null for comment lines', () => {
    expect(parseSseLine(': keep-alive')).toBeNull();
  });

  it('returns null for event: lines', () => {
    expect(parseSseLine('event: message')).toBeNull();
  });

  it('detects [DONE]', () => {
    const result = parseSseLine('data: [DONE]');
    expect(result).toEqual({ done: true });
  });

  it('extracts delta content from a normal chunk', () => {
    const chunk = JSON.stringify({
      id: 'chatcmpl-abc',
      choices: [{ delta: { content: '{"title"' }, finish_reason: null }],
    });
    const result = parseSseLine(`data: ${chunk}`);
    expect(result).toEqual({ done: false, deltaContent: '{"title"' });
  });

  it('returns done:false with no deltaContent when content is empty string', () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: '' }, finish_reason: null }],
    });
    const result = parseSseLine(`data: ${chunk}`);
    expect(result).toEqual({ done: false, deltaContent: '' });
  });

  it('returns done:false with no deltaContent for a role-only delta', () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { role: 'assistant' }, finish_reason: null }],
    });
    const result = parseSseLine(`data: ${chunk}`);
    expect(result).toEqual({ done: false });
  });

  it('parses an upstream error object', () => {
    const errorChunk = JSON.stringify({ error: { message: 'Rate limit exceeded', code: 429 } });
    const result = parseSseLine(`data: ${errorChunk}`);
    expect(result).toEqual({ done: false, error: 'Rate limit exceeded' });
  });

  it('parses an upstream error string', () => {
    const errorChunk = JSON.stringify({ error: 'Something went wrong' });
    const result = parseSseLine(`data: ${errorChunk}`);
    expect(result).toEqual({ done: false, error: 'Something went wrong' });
  });

  it('returns done:false and skips malformed JSON without throwing', () => {
    const result = parseSseLine('data: {not valid json');
    expect(result).toEqual({ done: false });
  });
});

// ---------------------------------------------------------------------------
// parseSseChunk
// ---------------------------------------------------------------------------
describe('parseSseChunk', () => {
  it('returns an empty array for a chunk with no data: lines', () => {
    expect(parseSseChunk('\n\n')).toEqual([]);
  });

  it('processes multiple data lines in a single chunk', () => {
    const line1 = JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] });
    const line2 = JSON.stringify({ choices: [{ delta: { content: ' World' } }] });
    const chunk = `data: ${line1}\ndata: ${line2}\n`;
    const results = parseSseChunk(chunk);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ done: false, deltaContent: 'Hello' });
    expect(results[1]).toEqual({ done: false, deltaContent: ' World' });
  });

  it('handles [DONE] appearing after delta lines in the same chunk', () => {
    const line1 = JSON.stringify({ choices: [{ delta: { content: 'last token' } }] });
    const chunk = `data: ${line1}\ndata: [DONE]\n`;
    const results = parseSseChunk(chunk);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ done: false, deltaContent: 'last token' });
    expect(results[1]).toEqual({ done: true });
  });

  it('trims whitespace from lines before parsing', () => {
    const line = JSON.stringify({ choices: [{ delta: { content: 'trimmed' } }] });
    const results = parseSseChunk(`  data: ${line}  `);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ done: false, deltaContent: 'trimmed' });
  });
});

// ---------------------------------------------------------------------------
// Full stream reassembly simulation
// ---------------------------------------------------------------------------
describe('SSE stream reassembly', () => {
  /**
   * Simulates the client-side accumulation loop:
   * reads an array of raw SSE chunks, returns the assembled JSON string
   * (stopping at [DONE]) or throws on an error event.
   */
  function assembleStream(chunks: string[]): string {
    let accumulated = '';
    for (const chunk of chunks) {
      for (const result of parseSseChunk(chunk)) {
        if (result.error) throw new Error(result.error);
        if (result.done) return accumulated;
        if (result.deltaContent !== undefined) accumulated += result.deltaContent;
      }
    }
    return accumulated;
  }

  it('reassembles a full JSON object from token-by-token chunks', () => {
    const tokens = ['{"title":"My', ' Video","description":"A', ' test.","tags":["a","b"]}'];
    const chunks = tokens.map(
      (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n`
    );
    chunks.push('data: [DONE]\n');

    const assembled = assembleStream(chunks);
    const parsed = JSON.parse(assembled) as { title: string; description: string; tags: string[] };
    expect(parsed.title).toBe('My Video');
    expect(parsed.description).toBe('A test.');
    expect(parsed.tags).toEqual(['a', 'b']);
  });

  it('throws when an error event appears mid-stream', () => {
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: '{"title":"' } }] })}\n`,
      `data: ${JSON.stringify({ error: { message: 'Context length exceeded' } })}\n`,
    ];
    expect(() => assembleStream(chunks)).toThrow('Context length exceeded');
  });

  it('reassembles a data: line split mid-JSON across two network chunks', () => {
    const fullLine = `data: ${JSON.stringify({ choices: [{ delta: { content: '{"title":"Split"}' } }] })}\n`;
    // Cut the raw SSE line at an arbitrary mid-point so chunk1 has no \n
    const splitAt = Math.floor(fullLine.length / 2);
    const chunk1 = fullLine.slice(0, splitAt);
    const chunk2 = fullLine.slice(splitAt) + 'data: [DONE]\n';

    const parse = createSseParser();
    const results1 = parse(chunk1);
    const results2 = parse(chunk2);

    // chunk1 ends mid-line — no complete line yet, so no results
    expect(results1).toEqual([]);
    // chunk2 completes the line and adds [DONE]
    expect(results2).toHaveLength(2);
    expect(results2[0]).toEqual({ done: false, deltaContent: '{"title":"Split"}' });
    expect(results2[1]).toEqual({ done: true });
  });

  it('reassembles a full stream when every network chunk cuts mid-line', () => {
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: '{"title":"' } }] })}\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Chunked"}' } }] })}\n`,
      'data: [DONE]\n',
    ].join('');

    // Split the entire stream at every character to maximise fragmentation
    const parse = createSseParser();
    const allResults: ReturnType<typeof parse> = [];
    for (const char of lines) allResults.push(...parse(char));

    const deltaResults = allResults.filter((r) => r.deltaContent !== undefined);
    expect(deltaResults.map((r) => r.deltaContent).join('')).toBe('{"title":"Chunked"}');
    expect(allResults.at(-1)).toEqual({ done: true });
  });

  it('returns accumulated content even when [DONE] arrives in same chunk as last token', () => {
    const lastToken = JSON.stringify({ choices: [{ delta: { content: '}' } }] });
    const chunk = `data: ${lastToken}\ndata: [DONE]\n`;
    // Prior accumulated content
    const priorChunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: '{"title":"T"}' } }] })}\n`,
    ];
    const assembled = assembleStream([...priorChunks, chunk]);
    expect(assembled).toBe('{"title":"T"}}');
  });
});
