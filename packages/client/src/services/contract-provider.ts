import { readFileSync } from 'node:fs';

import {
  Contract,
  FeeData,
  HDNodeWallet,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  type Signer,
} from 'ethers';

import type { ChainConfig } from './chain-config.js';
import { TELAGENT_GROUP_REGISTRY_ABI } from './abis.js';

export class ContractProvider {
  readonly provider: JsonRpcProvider;
  readonly signer: NonceManager;
  readonly signerAddress: string;

  // 仅保留 TelAgent 自有合约
  readonly telagentGroupRegistry: Contract;

  private constructor(
    readonly config: ChainConfig,
    provider: JsonRpcProvider,
    signer: Wallet,
  ) {
    this.provider = provider;
    this.signer = new NonceManager(signer);
    this.signerAddress = signer.address;

    this.telagentGroupRegistry = new Contract(
      config.contracts.telagentGroupRegistry,
      TELAGENT_GROUP_REGISTRY_ABI,
      this.signer,
    );
  }

  static async create(config: ChainConfig): Promise<ContractProvider> {
    const provider = new JsonRpcProvider(config.rpcUrl, {
      chainId: config.chainId,
      name: 'clawnet',
    });

    // ClawNet chain has a minimal baseFee (~7 wei); override to avoid high estimates
    provider.getFeeData = async () => new FeeData(7n, 7n, 0n);

    const signer = await ContractProvider.resolveSigner(config, provider);
    return new ContractProvider(config, provider, signer);
  }

  async destroy(): Promise<void> {
    this.provider.destroy();
  }

  private static async resolveSigner(config: ChainConfig, provider: JsonRpcProvider): Promise<Wallet> {
    const cfg = config.signer;

    if (cfg.type === 'env') {
      const privateKey = process.env[cfg.envVar];
      if (!privateKey) {
        throw new Error(`Signer env var ${cfg.envVar} is not set`);
      }
      return new Wallet(privateKey, provider);
    }

    if (cfg.type === 'keyfile') {
      const raw = readFileSync(cfg.path, 'utf8').trim();
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Raw private key string
        return new Wallet(raw, provider);
      }
      // Plain JSON keyfile with { privateKey: "0x..." }
      if (typeof parsed.privateKey === 'string') {
        return new Wallet(parsed.privateKey, provider);
      }
      // Encrypted keystore (ethers v3 format)
      if (parsed.crypto || parsed.Crypto) {
        const password = process.env.TELAGENT_SIGNER_PASSWORD;
        if (!password) {
          throw new Error('Encrypted keystore found but TELAGENT_SIGNER_PASSWORD is not set');
        }
        const wallet = await Wallet.fromEncryptedJson(raw, password);
        return wallet.connect(provider) as Wallet;
      }
      throw new Error(`Keyfile at ${cfg.path} has unrecognized format`);
    }

    const mnemonic = process.env[cfg.envVar];
    if (!mnemonic) {
      throw new Error(`Mnemonic env var ${cfg.envVar} is not set`);
    }
    const path = `m/44'/60'/0'/0/${cfg.index}`;
    const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, path);
    return new Wallet(wallet.privateKey, provider);
  }
}
