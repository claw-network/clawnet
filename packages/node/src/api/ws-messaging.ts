/**
 * WebSocket messaging endpoint — WS /api/v1/messaging/subscribe
 *
 * Clients can subscribe to real-time inbox message pushes via WebSocket.
 * Authentication is via the `apiKey` query parameter or `X-Api-Key` header.
 *
 * Query parameters:
 *  - topic    (optional) — filter messages by topic
 *  - apiKey   (optional) — API key for authentication
 *  - sinceSeq (optional) — replay missed messages since this sequence number
 *
 * Server pushes JSON frames:
 *   { type: "message", data: InboxMessage }
 *   { type: "receipt", data: ReceiptInfo }
 *   { type: "replay_done", lastSeq: number }
 *   { type: "ping" }
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { MessagingService, InboxMessage } from '../services/messaging-service.js';
import type { ApiKeyStore } from './api-key-store.js';

const WS_PATH = '/api/v1/messaging/subscribe';
const HEARTBEAT_INTERVAL_MS = 30_000;
/** Validates a single topic segment (allows trailing `*` for prefix matching). */
const TOPIC_PATTERN = /^[a-zA-Z0-9._\-:/]{1,127}\*?$/;

/**
 * Parse a topic filter string into a matcher function.
 * Supports:
 * - Exact match: `telagent/envelope`
 * - Wildcard prefix: `telagent/*` matches any topic starting with `telagent/`
 * - Comma-separated list: `telagent/envelope,telagent/receipt`
 */
function buildTopicMatcher(filter: string): ((topic: string) => boolean) | null {
  const parts = filter.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  for (const part of parts) {
    if (!TOPIC_PATTERN.test(part)) return null; // invalid
  }

  const matchers = parts.map(part => {
    if (part.endsWith('*')) {
      const prefix = part.slice(0, -1);
      return (topic: string) => topic.startsWith(prefix);
    }
    return (topic: string) => topic === part;
  });

  return (topic: string) => matchers.some(m => m(topic));
}

interface WsClient {
  ws: WebSocket;
  topicFilter?: string;
  matchTopic?: (topic: string) => boolean;
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
    const sinceSeqParam = url.searchParams.get('sinceSeq');

    // Validate topic filter format
    let matchTopic: ((topic: string) => boolean) | undefined;
    if (topicParam) {
      const matcher = buildTopicMatcher(topicParam);
      if (!matcher) {
        ws.close(4001, 'Invalid topic filter');
        return;
      }
      matchTopic = matcher;
    }

    const client: WsClient = { ws, topicFilter: topicParam, matchTopic, alive: true };
    clients.add(client);

    // Track pong responses for stale connection detection
    ws.on('pong', () => { client.alive = true; });

    // Register inbox subscriber on the messaging service
    const svc = getMessagingService();
    const subscriber = (msg: InboxMessage) => {
      if (client.matchTopic && !client.matchTopic(msg.topic)) return;
      if (ws.readyState !== ws.OPEN) return;
      const frame = msg.topic === '_receipt'
        ? { type: 'receipt', data: JSON.parse(msg.payload) }
        : { type: 'message', data: msg };
      ws.send(JSON.stringify(frame));
    };

    svc?.addSubscriber(subscriber);

    // Send initial connected confirmation with current seq for client tracking
    const currentSeq = svc?.getCurrentSeq() ?? 0;
    ws.send(JSON.stringify({ type: 'connected', topicFilter: topicParam ?? null, seq: currentSeq }));

    // Replay missed messages since sinceSeq (reconnect support)
    if (svc && sinceSeqParam != null) {
      const sinceSeq = parseInt(sinceSeqParam, 10);
      if (!isNaN(sinceSeq) && sinceSeq >= 0) {
        const missed = svc.getInbox({ sinceSeq, topic: topicParam, limit: 500 });
        for (const msg of missed) {
          if (ws.readyState !== ws.OPEN) break;
          ws.send(JSON.stringify({ type: 'message', data: msg }));
        }
        ws.send(JSON.stringify({ type: 'replay_done', lastSeq: svc.getCurrentSeq() }));
      }
    }

    ws.on('close', () => {
      clients.delete(client);
      svc?.removeSubscriber(subscriber);
    });

    ws.on('error', () => {
      clients.delete(client);
      svc?.removeSubscriber(subscriber);
    });
  });

  return wss;
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}
