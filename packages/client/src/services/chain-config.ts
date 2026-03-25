import { z } from 'zod';

const EthAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

export const ContractAddressesSchema = z.object({
  // identity: 已删除 — Identity 通过 ClawNet SDK 获取
  // token: 已删除 — Token 余额通过 ClawNet SDK 查询
  // router: 已删除 — Router 不再直连
  telagentGroupRegistry: EthAddress,
});

export const SignerConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('env'),
    envVar: z.string().default('TELAGENT_PRIVATE_KEY'),
  }),
  z.object({
    type: z.literal('keyfile'),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal('mnemonic'),
    envVar: z.string().default('TELAGENT_MNEMONIC'),
    index: z.number().int().nonnegative().default(0),
  }),
]);

export const ChainConfigSchema = z.object({
  rpcUrl: z.string().min(1),
  chainId: z.number().int().positive(),
  contracts: ContractAddressesSchema,
  signer: SignerConfigSchema,
  // selfDid 已删除 — DID 从 ClawNet Node 获取，不再手动配置
  finalityDepth: z.number().int().min(1).default(12),
});

export type ChainConfig = z.infer<typeof ChainConfigSchema>;
export type ContractAddresses = z.infer<typeof ContractAddressesSchema>;
export type SignerConfig = z.infer<typeof SignerConfigSchema>;
