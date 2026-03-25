import type { AttachmentService } from '../services/attachment-service.js';
import type { ClawNetGatewayService } from '../clawnet/gateway-service.js';
import type { ClawNetTransportService } from '../services/clawnet-transport-service.js';
import type { NonceManager } from '../clawnet/nonce-manager.js';
import type { SessionManager } from '../clawnet/session-manager.js';
import type { ContactService } from '../services/contact-service.js';
import type { GroupService } from '../services/group-service.js';
import type { IdentityAdapterService } from '../services/identity-adapter-service.js';
import type { KeyLifecycleService } from '../services/key-lifecycle-service.js';
import type { MessageService } from '../services/message-service.js';
import type { NodeMonitoringService } from '../services/node-monitoring-service.js';
import type { OwnerPermissionService } from '../services/owner-permission-service.js';
import type { SelfProfileStore } from '../storage/profile-store.js';
import type { PeerProfileRepository } from '../storage/peer-profile-repository.js';
import type { ApiProxyService } from '../services/api-proxy-service.js';
import type { EventPushService } from '../services/event-push-service.js';

export interface TlsServerConfig {
  certPath: string;
  keyPath: string;
  httpsPort: number;
}

export interface ApiServerConfig {
  host: string;
  port: number;
  publicUrl?: string;
  tls?: TlsServerConfig;
}

export interface RuntimeContext {
  config: ApiServerConfig;
  identityService: IdentityAdapterService;
  groupService: GroupService;
  messageService: MessageService;
  attachmentService: AttachmentService;
  monitoringService: NodeMonitoringService;
  keyLifecycleService: KeyLifecycleService;
  clawnetGateway: ClawNetGatewayService;
  clawnetTransportService: ClawNetTransportService;
  sessionManager: SessionManager;
  nonceManager: NonceManager;
  ownerPermissionService?: OwnerPermissionService;
  contactService: ContactService;
  selfProfileStore: SelfProfileStore;
  peerProfileRepository: PeerProfileRepository;
  configuredPassphrase?: string;
  apiProxyService?: ApiProxyService;
  eventPushService?: EventPushService;
}
