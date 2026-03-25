import { readFileSync, writeFileSync } from 'node:fs';
import type { Envelope, ApiProxyRequest, ApiProxyResponse } from '../protocol/index.js';
import type { ProfileCardPayload } from '../protocol/index.js';
import type { ClawNetGatewayService } from '../clawnet/gateway-service.js';

const logger = console;

const TOPIC_ENVELOPE = 'telagent/envelope';
const TOPIC_RECEIPT = 'telagent/receipt';
const TOPIC_GROUP_SYNC = 'telagent/group-sync';
const TOPIC_PROFILE_CARD = 'telagent/profile-card';
const TOPIC_ATTACHMENT = 'telagent/attachment';
const TOPIC_API_PROXY = 'telagent/api-proxy';
const TOPIC_API_PROXY_RESPONSE = 'telagent/api-proxy-response';
const TOPIC_API_PROXY_PING = 'telagent/api-proxy-ping';
const TOPIC_API_PROXY_PONG = 'telagent/api-proxy-pong';
const RECONNECT_DELAY_MS = 3_000;

/** JSON replacer that converts BigInt to string (needed for Envelope.seq). */
const bigintReplacer = (_k: string, v: unknown) => typeof v === 'bigint' ? v.toString() : v;

export interface DeliveryReceipt {
  envelopeId: string;
  status: 'delivered' | 'read';
  timestampMs: number;
}

export interface GroupSyncPayload {
  groupId: string;
  epoch: number;
  commitHash: string;
  memberDids: string[];
}

export interface AttachmentNotification {
  attachmentId: string;
  contentType: string;
  fileName?: string;
  totalSize: number;
}

export type TopicCallbacks = {
  onEnvelope?: (raw: Record<string, unknown>, sourceDid: string) => Promise<unknown>;
  onReceipt?: (receipt: DeliveryReceipt, sourceDid: string) => Promise<unknown>;
  onGroupSync?: (payload: GroupSyncPayload, sourceDid: string) => Promise<unknown>;
  onProfileCard?: (payload: ProfileCardPayload, sourceDid: string) => Promise<unknown>;
  /** Receives binary attachment data directly — no separate download step needed. */
  onAttachment?: (info: AttachmentNotification, data: Buffer, sourceDid: string) => Promise<void>;
  onApiProxyRequest?: (request: ApiProxyRequest, sourceDid: string) => Promise<void>;
  onApiProxyResponse?: (response: ApiProxyResponse) => void;
  onApiProxyPing?: (pingId: string, sourceDid: string) => Promise<void>;
  onApiProxyPong?: (pingId: string) => void;
};

export class ClawNetTransportService {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly seqStatePath: string | undefined;
  private ws?: WebSocket;
  private lastSeq = 0;
  private stopping = false;
  private callbacks: TopicCallbacks = {};
  private seqFlushTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly gateway: ClawNetGatewayService,
    opts: { baseUrl: string; apiKey?: string; seqStatePath?: string },
  ) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.seqStatePath = opts.seqStatePath;
    // Load persisted lastSeq so reconnects replay missed queued messages
    if (opts.seqStatePath) {
      try {
        const saved = JSON.parse(readFileSync(opts.seqStatePath, 'utf8')) as { seq?: number };
        if (typeof saved.seq === 'number' && saved.seq > 0) {
          this.lastSeq = saved.seq;
          logger.info('[p2p-transport] Restored lastSeq=%d from %s', this.lastSeq, opts.seqStatePath);
        }
      } catch {
        // File doesn't exist yet or is corrupt — start from the beginning
        this.lastSeq = 1;
      }
    }
  }

  /** Persist the current lastSeq (debounced, fire-and-forget). */
  private flushSeq(): void {
    if (!this.seqStatePath) return;
    if (this.seqFlushTimer) return; // already pending
    this.seqFlushTimer = setTimeout(() => {
      this.seqFlushTimer = undefined;
      try {
        writeFileSync(this.seqStatePath!, JSON.stringify({ seq: this.lastSeq }), 'utf8');
      } catch (err) {
        logger.warn('[p2p-transport] Failed to persist seq: %s', (err as Error).message);
      }
    }, 2000);
  }

  // ── outbound ──────────────────────────────────────────────

  async sendEnvelope(targetDid: string, envelope: Envelope): Promise<{ messageId: string; delivered: boolean }> {
    const result = await this.gateway.client.messaging.send({
      targetDid,
      topic: TOPIC_ENVELOPE,
      payload: JSON.stringify(envelope, bigintReplacer),
      ttlSec: envelope.ttlSec,
      priority: envelope.contentType.startsWith('control/') ? 3 : 1,
      compress: true,
      idempotencyKey: envelope.envelopeId,
    });
    if (!result.delivered) {
      logger.info('[p2p-transport] Envelope %s queued for offline delivery to %s', envelope.envelopeId, targetDid);
    }
    return result;
  }

  async sendEnvelopeMulticast(
    targetDids: string[],
    envelope: Envelope,
  ): Promise<void> {
    await this.gateway.client.messaging.sendBatch({
      targetDids,
      topic: TOPIC_ENVELOPE,
      payload: JSON.stringify(envelope, bigintReplacer),
      ttlSec: envelope.ttlSec,
      priority: envelope.contentType.startsWith('control/') ? 3 : 1,
      compress: true,
      idempotencyKey: envelope.envelopeId,
    });
  }

  // ── inbound (WebSocket subscribe) ─────────────────────────

  startListening(callbacks: TopicCallbacks): void {
    this.stopping = false;
    this.callbacks = callbacks;
    this.connect();
  }

  // ── additional outbound topics ────────────────────────────

  async sendReceipt(targetDid: string, receipt: DeliveryReceipt): Promise<void> {
    await this.gateway.client.messaging.send({
      targetDid,
      topic: TOPIC_RECEIPT,
      payload: JSON.stringify(receipt),
      ttlSec: 86_400,
      priority: 1,
      compress: false,
      idempotencyKey: `receipt:${receipt.envelopeId}:${receipt.status}`,
    });
  }

  async sendGroupSync(targetDids: string[], payload: GroupSyncPayload): Promise<void> {
    await this.gateway.client.messaging.sendBatch({
      targetDids,
      topic: TOPIC_GROUP_SYNC,
      payload: JSON.stringify(payload),
      ttlSec: 86_400,
      priority: 2,
      compress: true,
      idempotencyKey: `group-sync:${payload.groupId}:${payload.epoch}`,
    });
  }

  async sendProfileCard(targetDid: string, payload: ProfileCardPayload): Promise<void> {
    logger.info('[transport] sendProfileCard → %s (topic=%s)', targetDid, TOPIC_PROFILE_CARD);
    const result = await this.gateway.client.messaging.send({
      targetDid,
      topic: TOPIC_PROFILE_CARD,
      payload: JSON.stringify(payload),
      ttlSec: 7 * 24 * 3600, // 7 days
      priority: 1,
      compress: false,
      idempotencyKey: `profile-card:${payload.did}:${Date.now()}`,
    });
    logger.info('[transport] sendProfileCard result: %s', JSON.stringify(result));
  }
  /**
   * Relay an attachment to a target DID via ClawNet P2P using raw binary.
   *
   * Frame format: [4-byte BE meta_length][meta JSON (UTF-8)][raw file bytes]
   * Sent as application/octet-stream — no base64 encoding overhead.
   */
  async relayAttachment(
    targetDid: string,
    data: Buffer,
    contentType: string,
    attachmentId: string,
    fileName?: string,
  ): Promise<{ delivered: boolean }> {
    const meta = JSON.stringify({ attachmentId, contentType, fileName, totalSize: data.length });
    const metaBytes = new TextEncoder().encode(meta);
    const frame = new Uint8Array(4 + metaBytes.length + data.length);
    new DataView(frame.buffer).setUint32(0, metaBytes.length);
    frame.set(metaBytes, 4);
    frame.set(data, 4 + metaBytes.length);
    const result = await this.gateway.client.messaging.sendBinary({
      targetDid,
      topic: TOPIC_ATTACHMENT,
      payload: frame,
      ttlSec: 7 * 24 * 3600,
      priority: 1,
      compress: false,
      idempotencyKey: `attachment:${attachmentId}`,
    });
    return { delivered: result.delivered };
  }
  stopListening(): void {
    this.stopping = true;
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }

  // ── private ───────────────────────────────────────────────

  private connect(): void {
    if (this.stopping) return;

    let wsUrl = this.baseUrl.replace(/^http/, 'ws')
      + '/api/v1/messaging/subscribe';
    const params = new URLSearchParams();
    // Subscribe to all telagent topics (covers telagent/attachment binary relay too).
    params.set('topic', 'telagent/*');
    if (this.apiKey) {
      params.set('apiKey', this.apiKey);
    }
    // Always send sinceSeq so ClawNet replays messages queued during offline
    // periods (store-and-forward). Default to 1 if this is the first start.
    params.set('sinceSeq', String(this.lastSeq > 0 ? this.lastSeq : 1));
    const qs = params.toString();
    if (qs) wsUrl += `?${qs}`;

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.addEventListener('open', () => {
      logger.info('[p2p-transport] WS connected to ClawNet (sinceSeq=%d)', this.lastSeq);
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      void this.handleFrame(String(event.data));
    });

    ws.addEventListener('close', () => {
      if (!this.stopping) {
        logger.warn('[p2p-transport] WS closed, reconnecting in %dms...', RECONNECT_DELAY_MS);
        setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    });

    ws.addEventListener('error', (event: Event) => {
      logger.error('[p2p-transport] WS error: %s', (event as ErrorEvent).message ?? 'unknown');
    });
  }

  private async handleFrame(raw: string): Promise<void> {
    try {
      const frame = JSON.parse(raw) as {
        type: string;
        seq?: number;
        lastSeq?: number;
        topicFilter?: string;
        data?: {
          sourceDid: string;
          topic: string;
          payload?: string;
          payloadSize?: number;
          compressed?: boolean;
          encrypted?: boolean;
          messageId: string;
          seq: number;
        };
      };

      switch (frame.type) {
        case 'connected':
          // When lastSeq is 0 (no known state), do NOT skip to current —
          // always start from seq=1 so queued messages (e.g. profile card
          // replies that arrived while the node was offline) are delivered.
          logger.info('[p2p-transport] Subscribed topic=%s seq=%d (sinceSeq=%d)', frame.topicFilter, frame.seq, this.lastSeq);
          break;

        case 'message':
          if (frame.data) {
            await this.routeMessage(frame.data);
            if (frame.data.seq > this.lastSeq) {
              this.lastSeq = frame.data.seq;
              this.flushSeq();
            }
            await this.gateway.client.messaging.ack(frame.data.messageId);
          }
          break;

        case 'replay_done':
          if (frame.lastSeq && frame.lastSeq > this.lastSeq) {
            this.lastSeq = frame.lastSeq;
            this.flushSeq();
          }
          logger.info('[p2p-transport] Replay done, caught up to seq %d', frame.lastSeq);
          break;

        case 'receipt':
          // delivery receipt — informational only at this stage
          break;
      }
    } catch (err) {
      logger.error('[p2p-transport] Failed to process WS frame: %s', (err as Error).message);
    }
  }

  private async routeMessage(data: {
    sourceDid: string;
    topic: string;
    payload?: string;
    messageId: string;
  }): Promise<void> {
    // Binary attachment — frame: [4B meta_len][meta JSON][raw file bytes]
    if (data.topic === TOPIC_ATTACHMENT) {
      const buf = await this.gateway.client.messaging.downloadPayload(data.messageId);
      const bytes = new Uint8Array(buf);
      const metaLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
      const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metaLen))) as {
        attachmentId: string;
        contentType: string;
        fileName?: string;
        totalSize: number;
      };
      const fileBytes = bytes.subarray(4 + metaLen);
      await this.callbacks.onAttachment?.(
        { attachmentId: meta.attachmentId, contentType: meta.contentType, fileName: meta.fileName, totalSize: meta.totalSize },
        Buffer.from(fileBytes),
        data.sourceDid,
      );
      return;
    }

    // Binary proxy response — payload sent via sendBinary(), must be downloaded
    if (data.topic === TOPIC_API_PROXY_RESPONSE) {
      const buf = await this.gateway.client.messaging.downloadPayload(data.messageId);
      const bytes = new Uint8Array(buf);
      const metaLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
      const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metaLen))) as {
        requestId: string;
        status: number;
        headers: Record<string, string>;
      };
      const bodyBytes = bytes.subarray(4 + metaLen);
      this.callbacks.onApiProxyResponse?.({
        requestId: meta.requestId,
        status: meta.status,
        headers: meta.headers,
        bodyBytes: bodyBytes.length > 0 ? bodyBytes : undefined,
      });
      return;
    }

    // All other topics are JSON text messages
    // If payload is absent (compressed/encrypted), download raw bytes and decode
    let payloadText = data.payload;
    if (!payloadText) {
      const buf = await this.gateway.client.messaging.downloadPayload(data.messageId);
      payloadText = new TextDecoder().decode(buf);
    }
    const parsed = JSON.parse(payloadText) as Record<string, unknown>;
    switch (data.topic) {
      case TOPIC_ENVELOPE:
        await this.callbacks.onEnvelope?.(parsed, data.sourceDid);
        break;
      case TOPIC_RECEIPT:
        await this.callbacks.onReceipt?.(parsed as unknown as DeliveryReceipt, data.sourceDid);
        break;
      case TOPIC_GROUP_SYNC:
        await this.callbacks.onGroupSync?.(parsed as unknown as GroupSyncPayload, data.sourceDid);
        break;
      case TOPIC_PROFILE_CARD:
        await this.callbacks.onProfileCard?.(parsed as unknown as ProfileCardPayload, data.sourceDid);
        break;
      // TOPIC_ATTACHMENT is handled above as binary — should not reach here
      case TOPIC_API_PROXY:
        await this.callbacks.onApiProxyRequest?.(parsed as unknown as ApiProxyRequest, data.sourceDid);
        break;
      case TOPIC_API_PROXY_PING:
        await this.callbacks.onApiProxyPing?.((parsed as Record<string, unknown>).pingId as string, data.sourceDid);
        break;
      case TOPIC_API_PROXY_PONG:
        this.callbacks.onApiProxyPong?.((parsed as Record<string, unknown>).pingId as string);
        break;
      default:
        logger.warn('[p2p-transport] Unknown topic: %s', data.topic);
    }
  }

  // ── API Proxy outbound ────────────────────────────────────

  async sendApiProxyRequest(targetDid: string, request: ApiProxyRequest): Promise<void> {
    await this.gateway.client.messaging.send({
      targetDid,
      topic: TOPIC_API_PROXY,
      payload: JSON.stringify(request),
      ttlSec: 60,
      priority: 2,
      compress: true,
      idempotencyKey: `api-proxy:${request.requestId}`,
    });
  }

  async sendApiProxyResponse(targetDid: string, response: ApiProxyResponse): Promise<void> {
    // Encode as binary: [4-byte BE header length][JSON header][raw body bytes]
    const meta = JSON.stringify({
      requestId: response.requestId,
      status: response.status,
      headers: response.headers,
    });
    const metaBytes = new TextEncoder().encode(meta);
    const bodyBytes = response.bodyBytes ?? new Uint8Array(0);
    const frame = new Uint8Array(4 + metaBytes.length + bodyBytes.length);
    new DataView(frame.buffer).setUint32(0, metaBytes.length);
    frame.set(metaBytes, 4);
    frame.set(bodyBytes, 4 + metaBytes.length);
    await this.gateway.client.messaging.sendBinary({
      targetDid,
      topic: TOPIC_API_PROXY_RESPONSE,
      payload: frame,
      ttlSec: 60,
      priority: 2,
      compress: true,
      idempotencyKey: `api-proxy-res:${response.requestId}`,
    });
  }

  async sendApiProxyPing(targetDid: string, pingId: string): Promise<void> {
    await this.gateway.client.messaging.send({
      targetDid,
      topic: TOPIC_API_PROXY_PING,
      payload: JSON.stringify({ pingId }),
      ttlSec: 30,
      priority: 3,
      compress: false,
    });
  }

  async sendApiProxyPong(targetDid: string, pingId: string): Promise<void> {
    await this.gateway.client.messaging.send({
      targetDid,
      topic: TOPIC_API_PROXY_PONG,
      payload: JSON.stringify({ pingId }),
      ttlSec: 30,
      priority: 3,
      compress: false,
    });
  }
}
