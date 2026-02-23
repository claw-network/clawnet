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
