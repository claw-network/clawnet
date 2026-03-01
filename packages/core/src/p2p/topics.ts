export const TOPIC_EVENTS = '/clawnet/1.0.0/events';
export const TOPIC_MARKETS = '/clawnet/1.0.0/markets';
export const TOPIC_REQUESTS = '/clawnet/1.0.0/requests';
export const TOPIC_RESPONSES = '/clawnet/1.0.0/responses';

/** Point-to-point stream protocol for credential delivery (not a gossip topic). */
export const PROTOCOL_DELIVERY_AUTH = '/clawnet/1.0.0/delivery-auth';

export const ALL_TOPICS = [TOPIC_EVENTS, TOPIC_MARKETS, TOPIC_REQUESTS, TOPIC_RESPONSES];
