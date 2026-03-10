export const TOPIC_EVENTS = '/clawnet/1.0.0/events';
export const TOPIC_MARKETS = '/clawnet/1.0.0/markets';
export const TOPIC_REQUESTS = '/clawnet/1.0.0/requests';
export const TOPIC_RESPONSES = '/clawnet/1.0.0/responses';

/** Point-to-point stream protocol for credential delivery (not a gossip topic). */
export const PROTOCOL_DELIVERY_AUTH = '/clawnet/1.0.0/delivery-auth';

/** Point-to-point stream protocol for binary attachment relay between nodes. */
export const PROTOCOL_ATTACHMENT = '/clawnet/1.0.0/attachment';

/** Point-to-point stream protocol for external deliverable transfer between nodes. */
export const PROTOCOL_DELIVERY_EXTERNAL = '/clawnet/1.0.0/delivery-external';

export const ALL_TOPICS = [TOPIC_EVENTS, TOPIC_MARKETS, TOPIC_REQUESTS, TOPIC_RESPONSES];
