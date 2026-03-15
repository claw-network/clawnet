/**
 * Chain configuration schema and helpers.
 *
 * Defines the Zod-validated configuration for connecting to the EVM chain,
 * including RPC endpoint, contract addresses, and signer management.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const EthAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

export const ContractAddressesSchema = z.object({
  token: EthAddressSchema,
  escrow: EthAddressSchema,
  identity: EthAddressSchema,
  reputation: EthAddressSchema,
  contracts: EthAddressSchema,
  dao: EthAddressSchema,
  staking: EthAddressSchema,
  paramRegistry: EthAddressSchema,
  relayReward: EthAddressSchema.optional(),
});

export const SignerConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('keyfile'),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal('env'),
    envVar: z.string().min(1).default('CLAW_PRIVATE_KEY'),
  }),
  z.object({
    type: z.literal('mnemonic'),
    envVar: z.string().min(1).default('CLAW_MNEMONIC'),
    index: z.number().int().nonnegative().default(0),
  }),
]);

export const ChainConfigSchema = z.object({
  /** JSON-RPC endpoint URL (e.g. http://127.0.0.1:8545) */
  rpcUrl: z.string().min(1),

  /** EVM chain ID (31337 for hardhat, 7625 for ClawNet devnet/testnet) */
  chainId: z.number().int().positive(),

  /** Deployed contract proxy addresses */
  contracts: ContractAddressesSchema,

  /** Signer configuration for submitting on-chain transactions */
  signer: SignerConfigSchema,

  /**
   * Path to hardhat artifacts directory.
   * Used to load contract ABIs at runtime.
   * In monorepo dev: typically `packages/contracts/artifacts`.
   */
  artifactsDir: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChainConfig = z.infer<typeof ChainConfigSchema>;
export type ContractAddresses = z.infer<typeof ContractAddressesSchema>;
export type SignerConfig = z.infer<typeof SignerConfigSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Mapping from config key to Solidity contract name (used for ABI file lookup).
 */
export const CONTRACT_NAMES = {
  token: 'ClawToken',
  escrow: 'ClawEscrow',
  identity: 'ClawIdentity',
  reputation: 'ClawReputation',
  contracts: 'ClawContracts',
  dao: 'ClawDAO',
  staking: 'ClawStaking',
  paramRegistry: 'ParamRegistry',
  relayReward: 'ClawRelayReward',
} as const;

export type ContractKey = keyof typeof CONTRACT_NAMES;

/** All contract keys for iteration. */
export const CONTRACT_KEYS = Object.keys(CONTRACT_NAMES) as ContractKey[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load and parse a deployment JSON produced by `hardhat run scripts/deploy-helpers.ts`.
 *
 * Format:
 * ```json
 * {
 *   "chainId": 31337,
 *   "contracts": {
 *     "ClawToken": { "proxy": "0x...", "impl": "0x..." },
 *     ...
 *   }
 * }
 * ```
 *
 * Returns a partial `ContractAddresses` with only the contracts present in the file.
 */
export function parseDeploymentAddresses(
  deployment: Record<string, unknown>,
): Partial<ContractAddresses> {
  const deployed = deployment.contracts as
    | Record<string, { proxy?: string }>
    | undefined;
  if (!deployed) return {};

  const result: Partial<ContractAddresses> = {};
  for (const [key, solName] of Object.entries(CONTRACT_NAMES)) {
    const entry = deployed[solName];
    if (entry?.proxy) {
      (result as Record<string, string>)[key] = entry.proxy;
    }
  }
  return result;
}
