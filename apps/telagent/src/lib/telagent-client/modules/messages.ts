import type { Envelope, RedactedEnvelope } from '@claw-network/client/protocol';
import type { QueryValue, SendMessageInput, PullMessageInput, SendMessageResult } from '../types.js';
import type { ApiClient } from '../client.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hydrateEnvelope(raw: unknown): Envelope {
  if (!isRecord(raw)) {
    throw new Error('Envelope payload must be an object');
  }

  const seqRaw = raw.seq;
  let seq: bigint;
  if (typeof seqRaw === 'bigint') {
    seq = seqRaw;
  } else if (typeof seqRaw === 'string' && /^[0-9]+$/.test(seqRaw)) {
    seq = BigInt(seqRaw);
  } else if (typeof seqRaw === 'number' && Number.isFinite(seqRaw) && Number.isInteger(seqRaw) && seqRaw >= 0) {
    seq = BigInt(seqRaw);
  } else {
    throw new Error('Envelope seq must be a non-negative integer encoded as string/number/bigint');
  }

  return {
    ...(raw as Omit<Envelope, 'seq'>),
    seq,
  };
}

export class MessagesModule {
  constructor(private client: ApiClient) {}

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    const response = await this.client.requestData<{ envelope: Envelope; p2pDelivered?: boolean }>(
      'POST',
      '/api/v1/messages',
      input,
    );
    return {
      envelope: hydrateEnvelope(response.data.envelope),
      p2pDelivered: response.data.p2pDelivered !== false,
    };
  }

  async pull(input: PullMessageInput = {}): Promise<{ items: Envelope[]; cursor: string | null }> {
    const query: Record<string, QueryValue> = {
      cursor: input.cursor,
      limit: input.limit,
      conversation_id: input.conversationId,
    };
    const envelope = await this.client.requestData<{ items: Envelope[]; cursor: string | null }>(
      'GET',
      '/api/v1/messages/pull',
      undefined,
      query,
    );
    return {
      items: envelope.data.items.map((item) => hydrateEnvelope(item)),
      cursor: envelope.data.cursor,
    };
  }

  /**
   * Fetch messages via the Owner view endpoint.
   * Owner tokens receive redacted envelopes (ciphertext/sealedHeader replaced).
   * Agent tokens receive full envelopes.
   */
  async view(input: PullMessageInput = {}): Promise<{ items: (Envelope | RedactedEnvelope)[]; cursor: string | null }> {
    const query: Record<string, QueryValue> = {
      cursor: input.cursor,
      limit: input.limit,
      conversation_id: input.conversationId,
    };
    const envelope = await this.client.requestData<{ items: (Envelope | RedactedEnvelope)[]; cursor: string | null }>(
      'GET',
      '/api/v1/messages/view',
      undefined,
      query,
    );
    return {
      items: envelope.data.items.map((item) =>
        item.ciphertext === '[redacted]' ? item : hydrateEnvelope(item as Envelope),
      ),
      cursor: envelope.data.cursor,
    };
  }
}
