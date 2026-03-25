export { discoverOrStartClawNet, probeNodeHealth } from './discovery.js';
export type { ClawNetDiscoveryResult } from './discovery.js';

export { ManagedClawNetNode } from './managed-node.js';

export { killClawnetdOnPort, killStaleTelagentOnPort, killProcessOnPort } from './clawnetd-process.js';

export { verifyPassphrase } from './verify-passphrase.js';

export { SessionManager } from './session-manager.js';
export type { OperationScope, UnlockParams, UnlockResult, ResolveResult, SessionInfo } from './session-manager.js';

export { NonceManager } from './nonce-manager.js';

export { ClawNetGatewayService } from './gateway-service.js';
export type { ClawNetGatewayConfig, IdentityInfo, BalanceInfo } from './gateway-service.js';
