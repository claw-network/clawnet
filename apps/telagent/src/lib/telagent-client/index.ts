/**
 * Telagent SDK
 *
 * Modular TypeScript SDK for the TelAgent API.
 * Organized into functional modules for cleaner code organization.
 */

// Re-export types
export type {
  ApiLinks,
  PaginationMeta,
  ApiDataEnvelope,
  ApiListEnvelope,
  QueryValue,
  TelagentSdkOptions,
  AgentIdentityView,
  // Group types
  CreateGroupInput,
  InviteMemberInput,
  AcceptInviteInput,
  RemoveMemberInput,
  GroupMemberListInput,
  // Message types
  SendMessageInput,
  SendMessageResult,
  PullMessageInput,
  // Attachment types
  InitAttachmentUploadInput,
  CompleteAttachmentUploadInput,
  // Session types
  SessionOperationScope,
  UnlockSessionInput,
  SessionInfo,
  SessionUnlockResult,
  // Wallet types
  WalletHistoryInput,
  TransferInput,
  CreateEscrowInput,
  // Marketplace types
  SearchMarketsInput,
  PublishTaskInput,
  BidTaskInput,
  ReviewInput,
  PublishInfoInput,
  DeliverInput,
  PublishCapabilityInput,
  LeaseCapabilityInput,
  InvokeCapabilityInput,
  OpenDisputeInput,
  RespondDisputeInput,
  ResolveDisputeInput,
  // Conversation types
  ConversationListInput,
} from './types.js';

// Re-export enums/types from protocol
export type {
  AgentDID,
  Contact,
  ConversationSummary,
  CreateContactInput,
  CreateConversationInput,
  Envelope,
  GroupChainState,
  GroupMemberRecord,
  GroupRecord,
  OwnerPermissions,
  PeerProfile,
  RedactedEnvelope,
  SelfProfile,
  UpdateContactInput,
} from '@claw-network/client/protocol';

// Re-export error class
export { TelagentSdkError } from './errors.js';

// Import modules
import { ApiClient } from './client.js';
import { TelagentSdkOptions } from './types.js';

import {
  IdentityModule,
  ConversationsModule,
  ContactsModule,
  ProfileModule,
  GroupsModule,
  MessagesModule,
  AttachmentsModule,
  SessionModule,
  WalletModule,
  ClawnetModule,
  MarketplaceModule,
  FaucetModule,
} from './modules/index.js';

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('TelagentSdk requires a non-empty baseUrl');
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/**
 * TelAgent SDK client.
 *
 * Composes all functional modules into a single client with full API coverage.
 *
 * @example
 * ```typescript
 * import { TelagentSdk } from '@/lib/telagent-client';
 *
 * const sdk = new TelagentSdk({ baseUrl: 'http://127.0.0.1:9529' });
 *
 * // Use identity
 * const identity = await sdk.identity.getSelf();
 *
 * // Use conversations
 * const { data: conversations } = await sdk.conversations.list();
 *
 * // Use messages
 * await sdk.messages.send({ ... });
 * ```
 */
export class TelagentSdk {
  /** Identity and permissions */
  readonly identity: IdentityModule;
  /** Conversations */
  readonly conversations: ConversationsModule;
  /** Contacts */
  readonly contacts: ContactsModule;
  /** Profile (self and peer) */
  readonly profile: ProfileModule;
  /** Groups */
  readonly groups: GroupsModule;
  /** Messages */
  readonly messages: MessagesModule;
  /** Attachments */
  readonly attachments: AttachmentsModule;
  /** Session management */
  readonly session: SessionModule;
  /** Wallet operations */
  readonly wallet: WalletModule;
  /** ClawNet identity, profile, reputation */
  readonly clawnet: ClawnetModule;
  /** Marketplace (tasks, info, capabilities, disputes) */
  readonly marketplace: MarketplaceModule;
  /** Faucet */
  readonly faucet: FaucetModule;

  constructor(options: TelagentSdkOptions) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const fetchFn = options.fetchImpl ?? fetch;

    const client = new ApiClient({
      baseUrl,
      accessToken: options.accessToken,
      fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => fetchFn(input, init),
      defaultHeaders: {
        accept: 'application/json',
        ...(options.defaultHeaders ?? {}),
      },
    });

    // Initialize all modules with the shared client
    this.identity = new IdentityModule(client);
    this.conversations = new ConversationsModule(client);
    this.contacts = new ContactsModule(client);
    this.profile = new ProfileModule(client);
    this.groups = new GroupsModule(client);
    this.messages = new MessagesModule(client);
    this.attachments = new AttachmentsModule(client);
    this.session = new SessionModule(client);
    this.wallet = new WalletModule(client);
    this.clawnet = new ClawnetModule(client);
    this.marketplace = new MarketplaceModule(client);
    this.faucet = new FaucetModule(client);
  }
}
