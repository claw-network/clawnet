/**
 * Service layer barrel exports.
 *
 * Re-exports the chain configuration schema and the ContractProvider —
 * the foundational building blocks on which individual module services
 * (WalletService, IdentityService, …) will be built in later phases.
 */

export {
  ChainConfigSchema,
  ContractAddressesSchema,
  SignerConfigSchema,
  parseDeploymentAddresses,
  CONTRACT_NAMES,
  CONTRACT_KEYS,
  type ChainConfig,
  type ContractAddresses,
  type ContractKey,
  type SignerConfig,
} from './chain-config.js';

export { ContractProvider } from './contract-provider.js';

export { WalletService } from './wallet-service.js';
export type {
  TransferResult,
  BalanceResult,
  EscrowView,
  EscrowActionResult,
  EscrowCreateResult,
  TransactionHistoryResult,
} from './wallet-service.js';

export { IdentityService } from './identity-service.js';
export type {
  KeyPurpose,
  DIDRegistrationResult,
  KeyRotationResult,
  DIDRevocationResult,
  PlatformLinkResult,
  DIDDocument,
} from './identity-service.js';

export { ReputationService } from './reputation-service.js';
export type {
  ReputationDimensionName,
  ReputationProfile,
  ReviewRecordResult,
  AnchorResult,
  ReviewListResult,
  ReviewItem,
} from './reputation-service.js';
