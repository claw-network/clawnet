/**
 * WebSocket messaging endpoint — WS /api/v1/messaging/subscribe
 *
 * Clients can subscribe to real-time inbox message pushes via WebSocket.
 * Authentication is via the `apiKey` query parameter or `X-Api-Key` header.
 *
 * Query parameters:
 *  - topic  (optional) — filter messages by topic
 *  - apiKey (optional) — API key for authentication
 *
 * Server pushes JSON frames:
 *   { type: "message", data: InboxMessage }
 *   { type: "receipt", data: ReceiptInfo }
 *   { type: "ping" }
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { MessagingService, InboxMessage } from '../services/messaging-service.js';
import type { ApiKeyStore } from './api-key-store.js';

const WS_PATH = '/api/v1/messaging/subscribe';
const HEARTBEAT_INTERVAL_MS = 30_000;
const TOPIC_PATTERN = /^[a-zA-Z0-9._\-:/]{1,128}$/;

interface WsClient {
  ws: WebSocket;
  topicFilter?: string;
  alive: boolean;
}

export function attachWebSocketHandler(
  server: Server,
  getMessagingService: () => MessagingService | undefined,
  apiKeyStore?: ApiKeyStore,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WsClient>();

  // ── Heartbeat to detect stale connections ──────────────────────

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.ws.readyState !== client.ws.OPEN) continue;
      if (!client.alive) {
        // No pong received since last ping — connection is stale
        client.ws.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeat));

  // ── Handle HTTP upgrade ────────────────────────────────────────

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== WS_PATH) {
      // Not our path — destroy socket so other upgrade handlers can work
      socket.destroy();
      return;
    }

    // Auth check: apiKey query param or X-Api-Key header
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
      wss.emit('connection', ws, req);
    });
  });

  // ── Handle new WS connections ──────────────────────────────────

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const topicParam = url.searchParams.get('topic') ?? undefined;

    // Validate topic filter format
    if (topicParam && !TOPIC_PATTERN.test(topicParam)) {
      ws.close(4001, 'Invalid topic filter');
      return;
    }

    const client: WsClient = { ws, topicFilter: topicParam, alive: true };
    clients.add(client);

    // Track pong responses for stale connection detection
    ws.on('pong', () => { client.alive = true; });

    // Register inbox subscriber on the messaging service
    const svc = getMessagingService();
    const subscriber = (msg: InboxMessage) => {
      if (client.topicFilter && msg.topic !== client.topicFilter) return;
      if (ws.readyState !== ws.OPEN) return;
      const frame = msg.topic === '_receipt'
        ? { type: 'receipt', data: JSON.parse(msg.payload) }
        : { type: 'message', data: msg };
      ws.send(JSON.stringify(frame));
    };

    svc?.addSubscriber(subscriber);

    ws.on('close', () => {
      clients.delete(client);
      svc?.removeSubscriber(subscriber);
    });

    ws.on('error', () => {
      clients.delete(client);
      svc?.removeSubscriber(subscriber);
    });

    // Send initial connected confirmation
    ws.send(JSON.stringify({ type: 'connected', topicFilter: topicParam ?? null }));
  });

  return wss;
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}
