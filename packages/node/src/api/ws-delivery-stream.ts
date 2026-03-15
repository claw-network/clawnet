/**
 * WebSocket delivery-stream endpoint — WS /api/v1/deliverables/stream/:deliverableId
 *
 * Clients push base64-encoded binary chunks; the server computes an
 * incremental BLAKE3 hash and (optionally) stores the reassembled blob.
 *
 * Protocol frames (client → server):
 *   { type: "chunk", data: "<base64>" }
 *   { type: "done" }                    — signals end-of-stream
 *
 * Protocol frames (server → client):
 *   { type: "ack", seq: number, totalBytes: number }
 *   { type: "finalHash", contentHash: string, totalBytes: number }
 *   { type: "error", detail: string }
 *   { type: "ping" }
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import { createBlake3Hasher, base64ToBytes } from '@claw-network/core';
import type { ApiKeyStore } from './api-key-store.js';
import { createBlobWriter, type BlobWriter } from '../services/blob-stage.js';

const WS_PATH_PREFIX = '/api/v1/deliverables/stream/';
const MAX_STREAM_BYTES = 50 * 1024 * 1024; // 50 MB
const HEARTBEAT_INTERVAL_MS = 30_000;

interface StreamSession {
  ws: WebSocket;
  deliverableId: string;
  hasher: ReturnType<typeof createBlake3Hasher>;
  totalBytes: number;
  seq: number;
  alive: boolean;
  done: boolean;
  blobWriter?: BlobWriter;
}

function sendJson(ws: WebSocket, data: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export interface DeliveryStreamOptions {
  apiKeyStore?: ApiKeyStore;
  /** When set, stream chunks are persisted to disk under this directory. */
  blobDir?: string;
}

export function attachDeliveryStreamHandler(
  server: Server,
  apiKeyStoreOrOpts?: ApiKeyStore | DeliveryStreamOptions,
): WebSocketServer {
  // Backward compat: accept bare ApiKeyStore or options object
  const opts: DeliveryStreamOptions =
    apiKeyStoreOrOpts && 'blobDir' in apiKeyStoreOrOpts
      ? apiKeyStoreOrOpts
      : { apiKeyStore: apiKeyStoreOrOpts as ApiKeyStore | undefined };

  const { apiKeyStore, blobDir } = opts;
  const wss = new WebSocketServer({ noServer: true });
  const sessions = new Set<StreamSession>();

  // Heartbeat
  const heartbeat = setInterval(() => {
    for (const session of sessions) {
      if (session.ws.readyState !== session.ws.OPEN) continue;
      if (!session.alive) {
        session.ws.terminate();
        sessions.delete(session);
        continue;
      }
      session.alive = false;
      session.ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeat));

  // Listen for upgrade (the messaging handler destroys unknown paths, so we
  // register on 'upgrade' **before** ws-messaging in server.ts).
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (!url.pathname.startsWith(WS_PATH_PREFIX)) return; // not ours — let other handlers pick up

    const deliverableId = decodeURIComponent(url.pathname.slice(WS_PATH_PREFIX.length));
    if (!deliverableId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    // Auth
    if (apiKeyStore && apiKeyStore.activeCount() > 0) {
      const apiKey =
        url.searchParams.get('apiKey') ??
        (req.headers['x-api-key'] as string | undefined) ??
        extractBearerToken(req.headers.authorization);

      if (!apiKey || !apiKeyStore.validate(apiKey)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleStreamConnection(ws, deliverableId, sessions, blobDir);
    });
  });

  return wss;
}

function handleStreamConnection(
  ws: WebSocket,
  deliverableId: string,
  sessions: Set<StreamSession>,
  blobDir?: string,
): void {
  const session: StreamSession = {
    ws,
    deliverableId,
    hasher: createBlake3Hasher(),
    totalBytes: 0,
    seq: 0,
    alive: true,
    done: false,
  };
  sessions.add(session);

  // Initialize blob writer (async, non-blocking — first chunk waits if needed)
  let blobReady: Promise<void> | undefined;
  if (blobDir) {
    blobReady = createBlobWriter(deliverableId, { blobDir }).then((w) => {
      session.blobWriter = w;
    });
  }

  ws.on('pong', () => {
    session.alive = true;
  });

  ws.on('message', (raw) => {
    // Wrap in async IIFE for blob write await
    void (async () => {
    session.alive = true;
    if (session.done) {
      sendJson(ws, { type: 'error', detail: 'Stream already finalized' });
      return;
    }

    let msg: { type?: string; data?: string };
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : (raw as Buffer).toString('utf-8'));
    } catch {
      sendJson(ws, { type: 'error', detail: 'Invalid JSON frame' });
      return;
    }

    if (msg.type === 'chunk') {
      if (typeof msg.data !== 'string') {
        sendJson(ws, { type: 'error', detail: '"data" must be a base64-encoded string' });
        return;
      }

      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes(msg.data);
      } catch {
        sendJson(ws, { type: 'error', detail: '"data" is not valid base64' });
        return;
      }

      session.totalBytes += bytes.length;
      if (session.totalBytes > MAX_STREAM_BYTES) {
        sendJson(ws, { type: 'error', detail: `Stream exceeds size limit (${MAX_STREAM_BYTES} bytes)` });
        ws.close(1009, 'Message too big');
        session.blobWriter?.abort().catch(() => {});
        sessions.delete(session);
        return;
      }

      session.hasher.update(bytes);
      // Persist chunk to disk if blob staging is enabled
      if (blobReady) {
        await blobReady;
        await session.blobWriter!.append(bytes);
      }
      session.seq += 1;
      sendJson(ws, { type: 'ack', seq: session.seq, totalBytes: session.totalBytes });
    } else if (msg.type === 'done') {
      session.done = true;
      const contentHash = session.hasher.hexDigest();
      // Finalize blob file
      if (session.blobWriter) {
        await session.blobWriter.finalize();
      }
      sendJson(ws, { type: 'finalHash', contentHash, totalBytes: session.totalBytes });
      ws.close(1000, 'Stream complete');
      sessions.delete(session);
    } else {
      sendJson(ws, { type: 'error', detail: `Unknown frame type: ${msg.type}` });
    }
    })();
  });

  ws.on('close', () => {
    if (!session.done) {
      session.blobWriter?.abort().catch(() => {});
    }
    sessions.delete(session);
  });

  ws.on('error', () => {
    if (!session.done) {
      session.blobWriter?.abort().catch(() => {});
    }
    sessions.delete(session);
  });
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const parts = header.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return undefined;
}
