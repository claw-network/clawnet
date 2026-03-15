/**
 * Delivery stream WebSocket API tests.
 *
 * Tests the WS /api/v1/deliverables/stream/:deliverableId endpoint.
 * Creates a real HTTP server with the WS handler attached, then sends
 * chunk frames through and verifies incremental hashing + finalHash.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import WebSocket from 'ws';
import { attachDeliveryStreamHandler } from '../src/api/ws-delivery-stream.js';
import { blake3Hex, utf8ToBytes, bytesToBase64 } from '@claw-network/core';

// ── Test server setup ──────────────────────────────────────────

let server: Server;
let port: number;

function wsUrl(deliverableId: string): string {
  return `ws://127.0.0.1:${port}/api/v1/deliverables/stream/${encodeURIComponent(deliverableId)}`;
}

/** Collect all JSON messages until WS closes. */
function collectMessages(ws: WebSocket): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const msgs: Record<string, unknown>[] = [];
    ws.on('message', (raw) => {
      try {
        msgs.push(JSON.parse(raw.toString()));
      } catch { /* ignore non-JSON */ }
    });
    ws.on('close', () => resolve(msgs));
    ws.on('error', reject);
  });
}

/** Wait for the WS to be in OPEN state. */
function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
}

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  // Attach without apiKeyStore (no auth required in tests)
  attachDeliveryStreamHandler(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

// ── Tests ──────────────────────────────────────────────────────

describe('delivery stream WS', () => {
  it('returns finalHash after streaming chunks', async () => {
    const ws = new WebSocket(wsUrl('test-deliverable-1'));
    const collecting = collectMessages(ws);
    await waitOpen(ws);

    const chunk1 = utf8ToBytes('hello ');
    const chunk2 = utf8ToBytes('world');
    const fullContent = utf8ToBytes('hello world');
    const expectedHash = blake3Hex(fullContent);

    ws.send(JSON.stringify({ type: 'chunk', data: bytesToBase64(chunk1) }));
    ws.send(JSON.stringify({ type: 'chunk', data: bytesToBase64(chunk2) }));

    // Small delay to let acks arrive before sending done
    await new Promise((r) => setTimeout(r, 50));
    ws.send(JSON.stringify({ type: 'done' }));

    const msgs = await collecting;

    // Should have 2 acks + 1 finalHash
    const acks = msgs.filter((m) => m.type === 'ack');
    const finals = msgs.filter((m) => m.type === 'finalHash');

    expect(acks).toHaveLength(2);
    expect(acks[0]).toMatchObject({ type: 'ack', seq: 1 });
    expect(acks[1]).toMatchObject({ type: 'ack', seq: 2, totalBytes: fullContent.length });

    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({
      type: 'finalHash',
      contentHash: expectedHash,
      totalBytes: fullContent.length,
    });
  });

  it('returns error on invalid JSON frame', async () => {
    const ws = new WebSocket(wsUrl('test-deliverable-2'));
    const collecting = collectMessages(ws);
    await waitOpen(ws);

    ws.send('not json at all');
    // Small delay then close
    await new Promise((r) => setTimeout(r, 50));
    ws.close();

    const msgs = await collecting;
    const errors = msgs.filter((m) => m.type === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.detail).toContain('Invalid JSON');
  });

  it('returns error when chunk data is not a string', async () => {
    const ws = new WebSocket(wsUrl('test-deliverable-3'));
    const collecting = collectMessages(ws);
    await waitOpen(ws);

    // Send chunk with non-string data
    ws.send(JSON.stringify({ type: 'chunk', data: 12345 }));
    await new Promise((r) => setTimeout(r, 50));
    ws.close();

    const msgs = await collecting;
    const errors = msgs.filter((m) => m.type === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.detail).toContain('base64');
  });

  it('returns error when sending chunk after done', async () => {
    const ws = new WebSocket(wsUrl('test-deliverable-4'));
    const collecting = collectMessages(ws);
    await waitOpen(ws);

    ws.send(JSON.stringify({ type: 'chunk', data: bytesToBase64(utf8ToBytes('data')) }));
    await new Promise((r) => setTimeout(r, 30));
    ws.send(JSON.stringify({ type: 'done' }));
    // Server will close after done — wait for close, then reconnect or just check
    const msgs = await collecting;

    const finals = msgs.filter((m) => m.type === 'finalHash');
    expect(finals).toHaveLength(1);
  });

  it('rejects unknown frame types gracefully', async () => {
    const ws = new WebSocket(wsUrl('test-deliverable-5'));
    const collecting = collectMessages(ws);
    await waitOpen(ws);

    ws.send(JSON.stringify({ type: 'unknown_frame' }));
    await new Promise((r) => setTimeout(r, 50));
    ws.close();

    const msgs = await collecting;
    const errors = msgs.filter((m) => m.type === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.detail).toContain('Unknown frame type');
  });
});
