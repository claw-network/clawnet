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
import type { MessagingService, InboxMessage, DelegatedMsgSubscriber } from '../services/messaging-service.js';
import { RECEIPT_TOPIC } from '../services/messaging-service.js';
import type { DelegatedMessage } from '@claw-network/protocol/messaging';
import type { ApiKeyStore } from './api-key-store.js';

const WS_PATH = '/api/v1/messaging/subscribe';
const WS_DELEGATED_PATH = '/api/v1/messaging/subscribe-delegated';
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

    // ── Delegated subscription endpoint ────────────────────────────
    if (url.pathname === WS_DELEGATED_PATH) {
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

      const delegationId = url.searchParams.get('delegationId');
      if (!delegationId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleDelegatedConnection(ws, delegationId, url, getMessagingService());
      });
      return;
    }

    if (url.pathname !== WS_PATH) {
      // Not our path — let other upgrade handlers pick it up
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
      // Convert Buffer payload to a WS-safe representation
      const wireMsg = {
        ...msg,
        payload: (!msg.compressed && !msg.encrypted) ? msg.payload.toString('utf-8') : undefined,
        payloadSize: msg.payload.length,
      };
      const frame = msg.topic === RECEIPT_TOPIC
        ? { type: 'receipt', data: JSON.parse(msg.payload.toString('utf-8')) }
        : { type: 'message', data: wireMsg };
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
          const wireMsg = {
            ...msg,
            payload: (!msg.compressed && !msg.encrypted) ? msg.payload.toString('utf-8') : undefined,
            payloadSize: msg.payload.length,
          };
          ws.send(JSON.stringify({ type: 'message', data: wireMsg }));
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

function handleDelegatedConnection(
  ws: WebSocket,
  delegationId: string,
  url: URL,
  svc: MessagingService | undefined,
): void {
  if (!svc) {
    ws.close(4000, 'Messaging service unavailable');
    return;
  }

  const sinceSeqParam = url.searchParams.get('sinceSeq');

  const subscriber: DelegatedMsgSubscriber = (msg: DelegatedMessage) => {
    if (msg.delegationId !== delegationId) return;
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: 'delegated-message', data: msg }));
  };

  svc.addDelegatedMsgSubscriber(subscriber);

  const currentSeq = svc.getCurrentDelegatedSeq();
  ws.send(JSON.stringify({
    type: 'connected',
    delegationId,
    seq: currentSeq,
  }));

  if (sinceSeqParam != null) {
    const sinceSeq = parseInt(sinceSeqParam, 10);
    if (!isNaN(sinceSeq) && sinceSeq >= 0) {
      const missed = svc.getDelegatedInbox({
        delegationId,
        sinceSeq,
        limit: 500,
      });
      for (const row of missed) {
        if (ws.readyState !== ws.OPEN) break;
        ws.send(JSON.stringify({
          type: 'delegated-message',
          data: {
            type: 'delegated-message',
            delegationId: row.delegationId,
            originalTargetDid: row.originalTargetDid,
            sourceDid: row.sourceDid,
            topic: row.topic,
            seq: row.seq,
            receivedAtMs: row.receivedAtMs,
            metadata: row.messageId
              ? { messageId: row.messageId, payloadSizeBytes: row.payloadSize ?? 0 }
              : undefined,
          },
        }));
      }
      ws.send(JSON.stringify({
        type: 'replay_done',
        lastSeq: svc.getCurrentDelegatedSeq(),
      }));
    }
  }

  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  ws.on('close', () => {
    clearInterval(pingInterval);
    svc.removeDelegatedMsgSubscriber(subscriber);
  });

  ws.on('pong', () => {
    // client still alive
  });
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}
