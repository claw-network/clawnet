import type { ServerResponse } from 'node:http';
import type { EventNotification, EventSubscribeResponse } from '../protocol/index.js';
import type { ClawNetGatewayService } from '../clawnet/gateway-service.js';
import type { ApiProxyService } from './api-proxy-service.js';
import { getGlobalLogger } from '../logger.js';

const logger = getGlobalLogger();
const DEFAULT_DELEGATION_TTL_SEC = 3600;
const METADATA_ONLY_TOPICS = ['telagent/envelope', 'telagent/group-sync'];
const RECEIPT_TOPICS = ['telagent/receipt'];
const DELEGATION_TOPICS = [...METADATA_ONLY_TOPICS, ...RECEIPT_TOPICS];
const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;

type DelegationMode = 'metadata' | 'receipt';

// ── SSE client management ────────────────────────────────

interface SseClient {
  id: string;
  res: ServerResponse;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

// ── Delegation WS state (gateway role) ───────────────────

interface DelegationWsState {
  key: string;
  delegationId: string;
  targetDid: string;
  mode: DelegationMode;
  topics: string[];
  metadataOnly: boolean;
  ws: WebSocket | null;
  lastSeq: number;
  stopping: boolean;
  sseClients: Set<string>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

/**
 * EventPushService handles two responsibilities:
 *
 * 1. **Local SSE** (any node):   Pushes EventNotification to directly-connected Webapp clients.
 * 2. **Gateway delegation** (gateway role): Manages ClawNet delegation WS connections and
 *    forwards delegated-message events as SSE to DID-mode Webapp clients.
 */
export class EventPushService {
  /** Local SSE clients: Webapp directly connected to this node. */
  private readonly localClients = new Map<string, SseClient>();

  /** Gateway-side: delegation WS connections keyed by targetDid. */
  private readonly delegationConnections = new Map<string, DelegationWsState>();

  /** Gateway SSE clients: keyed by client id, mapped to targetDid. */
  private readonly gatewayClients = new Map<string, { sseClient: SseClient; targetDid: string }>();

  private clientIdCounter = 0;

  constructor(
    private readonly clawnetGateway: ClawNetGatewayService,
    private readonly apiProxyService: ApiProxyService | undefined,
  ) {}

  // ── Local SSE ──────────────────────────────────────────

  /**
   * Register a local SSE client. Called when Webapp opens GET /api/v1/events.
   */
  addLocalClient(res: ServerResponse): string {
    const id = `local-${++this.clientIdCounter}`;
    this.initSseResponse(res);
    const heartbeatTimer = setInterval(() => {
      this.sendSseComment(res, 'heartbeat');
    }, HEARTBEAT_INTERVAL_MS);
    this.localClients.set(id, { id, res, heartbeatTimer });
    res.on('close', () => this.removeLocalClient(id));
    logger.info('[event-push] Local SSE client connected: %s (total: %d)', id, this.localClients.size);
    return id;
  }

  removeLocalClient(id: string): void {
    const client = this.localClients.get(id);
    if (!client) return;
    clearInterval(client.heartbeatTimer);
    this.localClients.delete(id);
    if (!client.res.writableEnded) {
      client.res.end();
    }
    logger.info('[event-push] Local SSE client disconnected: %s (remaining: %d)', id, this.localClients.size);
  }

  /**
   * Emit an event to all local SSE clients.
   * Called by the node's message processing pipeline.
   */
  emitLocal(event: EventNotification): void {
    if (this.localClients.size === 0) return;
    const data = JSON.stringify(event);
    for (const client of this.localClients.values()) {
      this.sendSseEvent(client.res, event.type, data);
    }
  }

  // ── Target role: create/revoke delegation ──────────────

  /**
   * Create a ClawNet subscription delegation for a gateway.
   * Called when gateway sends POST /api/v1/events/subscribe via API Proxy.
   */
  async createDelegation(
    gatewayDid: string,
    options: {
      topics?: string[];
      expiresInSec?: number;
      metadataOnly?: boolean;
    } = {},
  ): Promise<EventSubscribeResponse> {
    const topics = options.topics?.filter((topic) => typeof topic === 'string' && topic.trim().length > 0) ?? DELEGATION_TOPICS;
    const expiresInSec = options.expiresInSec && options.expiresInSec > 0
      ? Math.floor(options.expiresInSec)
      : DEFAULT_DELEGATION_TTL_SEC;
    const result = await this.clawnetGateway.client.messaging.createSubscriptionDelegation({
      delegateDid: gatewayDid,
      topics,
      expiresInSec,
      metadataOnly: options.metadataOnly ?? true,
    });
    logger.info('[event-push] Created delegation %s for gateway %s (topics=%s, metadataOnly=%s)',
      result.delegationId, gatewayDid, topics.join(','), String(options.metadataOnly ?? true));
    return {
      delegationId: result.delegationId,
      expiresAtMs: result.expiresAtMs,
    };
  }

  /**
   * Revoke a ClawNet subscription delegation.
   */
  async revokeDelegation(delegationId: string): Promise<void> {
    try {
      await this.clawnetGateway.client.messaging.revokeSubscriptionDelegation(delegationId);
      logger.info('[event-push] Revoked delegation %s', delegationId);
    } catch (err) {
      logger.warn('[event-push] Failed to revoke delegation %s: %s', delegationId, (err as Error).message);
    }
  }

  // ── Gateway role: delegation WS + SSE relay ────────────

  /**
   * Register a gateway SSE client for a DID-mode Webapp.
   * This will:
   *  1. Send POST /api/v1/events/subscribe to target via API Proxy
   *  2. Connect to ClawNet WS subscribe-delegated endpoint
   *  3. Pipe delegated-message events as SSE to the Webapp
   */
  async addGatewayClient(
    res: ServerResponse,
    targetDid: string,
  ): Promise<string> {
    if (!this.apiProxyService) {
      throw new Error('API Proxy service not available');
    }

    const clientId = `gateway-${++this.clientIdCounter}`;
    this.initSseResponse(res);
    const heartbeatTimer = setInterval(() => {
      this.sendSseComment(res, 'heartbeat');
    }, HEARTBEAT_INTERVAL_MS);

    const sseClient: SseClient = { id: clientId, res, heartbeatTimer };

    const gatewayDid = (this.clawnetGateway as any).client?.identity?.did
      ?? await this.clawnetGateway.getSelfIdentity().then(i => i.did);
    const connections = await this.ensureDelegationConnections(targetDid, gatewayDid);

    for (const conn of connections) {
      conn.sseClients.add(clientId);
    }
    this.gatewayClients.set(clientId, { sseClient, targetDid });

    res.on('close', () => this.removeGatewayClient(clientId));
    logger.info('[event-push] Gateway SSE client %s connected for target %s (delegations: %s)',
      clientId, targetDid, connections.map((conn) => `${conn.mode}:${conn.delegationId}`).join(', '));
    return clientId;
  }

  removeGatewayClient(clientId: string): void {
    const entry = this.gatewayClients.get(clientId);
    if (!entry) return;
    clearInterval(entry.sseClient.heartbeatTimer);
    if (!entry.sseClient.res.writableEnded) {
      entry.sseClient.res.end();
    }
    this.gatewayClients.delete(clientId);

    // Remove from delegation connection
    for (const conn of this.listDelegationConnections(entry.targetDid)) {
      conn.sseClients.delete(clientId);
      if (conn.sseClients.size === 0) {
        void this.teardownDelegation(conn);
      }
    }
    logger.info('[event-push] Gateway SSE client %s disconnected', clientId);
  }

  // ── Delegation WS connection ───────────────────────────

  private connectDelegationWs(conn: DelegationWsState): void {
    if (conn.stopping) return;

    const baseUrl = this.clawnetGateway.baseUrl;
    let wsUrl = baseUrl.replace(/^http/, 'ws')
      + '/api/v1/messaging/subscribe-delegated';
    const params = new URLSearchParams();
    params.set('delegationId', conn.delegationId);
    if (conn.lastSeq > 0) {
      params.set('sinceSeq', String(conn.lastSeq));
    }
    const apiKey = (this.clawnetGateway as any).config?.apiKey;
    if (apiKey) {
      params.set('apiKey', apiKey);
    }
    wsUrl += `?${params.toString()}`;

    const ws = new WebSocket(wsUrl);
    conn.ws = ws;

    ws.addEventListener('open', () => {
      logger.info('[event-push] Delegation WS connected for target %s (delegationId: %s)',
        conn.targetDid, conn.delegationId);
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      this.handleDelegationFrame(conn, String(event.data));
    });

    ws.addEventListener('close', () => {
      if (!conn.stopping) {
        logger.warn('[event-push] Delegation WS closed for %s, reconnecting in %dms...',
          conn.targetDid, RECONNECT_DELAY_MS);
        conn.reconnectTimer = setTimeout(() => this.connectDelegationWs(conn), RECONNECT_DELAY_MS);
      }
    });

    ws.addEventListener('error', (event: Event) => {
      logger.error('[event-push] Delegation WS error for %s: %s',
        conn.targetDid, (event as ErrorEvent).message ?? 'unknown');
    });
  }

  private handleDelegationFrame(conn: DelegationWsState, raw: string): void {
    try {
      const frame = JSON.parse(raw) as {
        type: string;
        seq?: number;
        lastSeq?: number;
        delegationId?: string;
        data?: {
          type: string;
          delegationId: string;
          originalTargetDid: string;
          sourceDid: string;
          topic: string;
          seq: number;
          receivedAtMs: number;
          payload?: string;
          metadata?: {
            messageId: string;
            payloadSizeBytes: number;
          };
        };
      };

      switch (frame.type) {
        case 'connected':
          if (frame.seq && conn.lastSeq === 0) {
            conn.lastSeq = frame.seq;
          }
          logger.info('[event-push] Delegation WS subscribed (delegationId=%s, seq=%d)',
            frame.delegationId, frame.seq);
          break;

        case 'delegated-message':
          if (frame.data) {
            const notification = this.delegatedMessageToNotification(frame.data);
            if (notification) {
              this.pushToGatewayClients(conn, notification);
            }
            if (frame.data.seq > conn.lastSeq) {
              conn.lastSeq = frame.data.seq;
            }
          }
          break;

        case 'replay_done':
          if (frame.lastSeq && frame.lastSeq > conn.lastSeq) {
            conn.lastSeq = frame.lastSeq;
          }
          logger.info('[event-push] Delegation replay done for %s (lastSeq=%d)',
            conn.targetDid, frame.lastSeq);
          break;
      }
    } catch (err) {
      logger.error('[event-push] Failed to process delegation frame: %s', (err as Error).message);
    }
  }

  private delegatedMessageToNotification(
    data: NonNullable<{
      topic: string;
      sourceDid: string;
      receivedAtMs: number;
      payload?: string;
      metadata?: { messageId: string };
    }>,
  ): EventNotification | null {
    switch (data.topic) {
      case 'telagent/envelope':
        return {
          type: 'new-envelope',
          sourceDid: data.sourceDid,
          envelopeId: data.metadata?.messageId,
          atMs: data.receivedAtMs,
        };
      case 'telagent/receipt':
        return {
          type: 'receipt',
          sourceDid: data.sourceDid,
          envelopeId: this.extractReceiptEnvelopeId(data.payload),
          atMs: data.receivedAtMs,
        };
      case 'telagent/group-sync':
        return {
          type: 'conversation-update',
          sourceDid: data.sourceDid,
          atMs: data.receivedAtMs,
        };
      default:
        return null;
    }
  }

  private pushToGatewayClients(conn: DelegationWsState, event: EventNotification): void {
    const data = JSON.stringify(event);
    for (const clientId of conn.sseClients) {
      const entry = this.gatewayClients.get(clientId);
      if (entry) {
        this.sendSseEvent(entry.sseClient.res, event.type, data);
      }
    }
  }

  private async teardownDelegation(conn: DelegationWsState): Promise<void> {
    conn.stopping = true;
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
    }
    if (conn.ws) {
      conn.ws.close();
      conn.ws = null;
    }
    this.delegationConnections.delete(conn.key);

    // Revoke delegation on target via API Proxy
    if (this.apiProxyService) {
      try {
        await this.apiProxyService.proxyRequest(
          conn.targetDid,
          'POST',
          '/api/v1/events/unsubscribe',
          { 'content-type': 'application/json' },
          JSON.stringify({ delegationId: conn.delegationId }),
        );
      } catch (err) {
        logger.warn('[event-push] Failed to revoke delegation on target %s: %s',
          conn.targetDid, (err as Error).message);
      }
    }
    logger.info('[event-push] Delegation teardown complete for target %s (%s)', conn.targetDid, conn.mode);
  }

  private async ensureDelegationConnections(targetDid: string, gatewayDid: string): Promise<DelegationWsState[]> {
    const specs: Array<{ mode: DelegationMode; topics: string[]; metadataOnly: boolean }> = [
      { mode: 'metadata', topics: METADATA_ONLY_TOPICS, metadataOnly: true },
      { mode: 'receipt', topics: RECEIPT_TOPICS, metadataOnly: false },
    ];
    const ensured: DelegationWsState[] = [];
    const created: DelegationWsState[] = [];

    try {
      for (const spec of specs) {
        const existing = this.delegationConnections.get(this.delegationKey(targetDid, spec.mode));
        if (existing) {
          ensured.push(existing);
          continue;
        }

        const conn = await this.createGatewayDelegationConnection(targetDid, gatewayDid, spec);
        ensured.push(conn);
        created.push(conn);
      }
    } catch (err) {
      await Promise.all(created.map((conn) => this.teardownDelegation(conn)));
      throw err;
    }

    return ensured;
  }

  private async createGatewayDelegationConnection(
    targetDid: string,
    gatewayDid: string,
    spec: { mode: DelegationMode; topics: string[]; metadataOnly: boolean },
  ): Promise<DelegationWsState> {
    if (!this.apiProxyService) {
      throw new Error('API Proxy service not available');
    }

    const proxyResponse = await this.apiProxyService.proxyRequest(
      targetDid,
      'POST',
      '/api/v1/events/subscribe',
      { 'content-type': 'application/json' },
      JSON.stringify({
        gatewayDid,
        topics: spec.topics,
        expiresInSec: DEFAULT_DELEGATION_TTL_SEC,
        metadataOnly: spec.metadataOnly,
      }),
    );

    if (proxyResponse.status !== 200 && proxyResponse.status !== 201) {
      const errText = proxyResponse.bodyBytes ? new TextDecoder().decode(proxyResponse.bodyBytes) : '';
      throw new Error(`Target refused event subscription: ${proxyResponse.status} ${errText}`);
    }

    const body = JSON.parse(proxyResponse.bodyBytes ? new TextDecoder().decode(proxyResponse.bodyBytes) : '{}');
    const delegationId = body.data?.delegationId as string;
    if (!delegationId) {
      throw new Error('Target did not return delegation ID');
    }

    const conn: DelegationWsState = {
      key: this.delegationKey(targetDid, spec.mode),
      delegationId,
      targetDid,
      mode: spec.mode,
      topics: spec.topics,
      metadataOnly: spec.metadataOnly,
      ws: null,
      lastSeq: 0,
      stopping: false,
      sseClients: new Set(),
    };
    this.delegationConnections.set(conn.key, conn);
    this.connectDelegationWs(conn);
    return conn;
  }

  private listDelegationConnections(targetDid: string): DelegationWsState[] {
    return [...this.delegationConnections.values()].filter((conn) => conn.targetDid === targetDid);
  }

  private delegationKey(targetDid: string, mode: DelegationMode): string {
    return `${targetDid}::${mode}`;
  }

  private extractReceiptEnvelopeId(payload: string | undefined): string | undefined {
    if (!payload) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(payload) as { envelopeId?: unknown };
      return typeof parsed.envelopeId === 'string' ? parsed.envelopeId : undefined;
    } catch {
      logger.warn('[event-push] Failed to parse delegated receipt payload');
      return undefined;
    }
  }

  // ── SSE helpers ────────────────────────────────────────

  private initSseResponse(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Send initial comment to flush headers
    res.write(':ok\n\n');
  }

  private sendSseEvent(res: ServerResponse, eventType: string, data: string): void {
    if (res.writableEnded) return;
    res.write(`event: ${eventType}\ndata: ${data}\n\n`);
  }

  private sendSseComment(res: ServerResponse, comment: string): void {
    if (res.writableEnded) return;
    res.write(`:${comment}\n\n`);
  }

  // ── Cleanup ────────────────────────────────────────────

  dispose(): void {
    // Close all local clients
    for (const client of this.localClients.values()) {
      clearInterval(client.heartbeatTimer);
      if (!client.res.writableEnded) {
        client.res.end();
      }
    }
    this.localClients.clear();

    // Close all gateway clients
    for (const entry of this.gatewayClients.values()) {
      clearInterval(entry.sseClient.heartbeatTimer);
      if (!entry.sseClient.res.writableEnded) {
        entry.sseClient.res.end();
      }
    }
    this.gatewayClients.clear();

    // Teardown all delegation connections (synchronously close WS, skip API revoke)
    for (const conn of this.delegationConnections.values()) {
      conn.stopping = true;
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
      if (conn.ws) conn.ws.close();
    }
    this.delegationConnections.clear();
  }
}
