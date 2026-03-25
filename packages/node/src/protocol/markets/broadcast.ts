import { EventEnvelope } from '../../core/protocol/index.js';

export const MARKET_EVENT_PREFIX = 'market.';

export function isMarketEventType(value: string): boolean {
  return value.startsWith(MARKET_EVENT_PREFIX);
}

export function isMarketEventEnvelope(envelope: EventEnvelope): boolean {
  const type = typeof envelope.type === 'string' ? envelope.type : '';
  return isMarketEventType(type);
}
