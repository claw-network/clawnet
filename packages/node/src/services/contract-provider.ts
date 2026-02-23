/**
 * ContractProvider — manages ethers.js Provider, Signer, and typed contract instances.
 *
 * Loads ABIs from hardhat artifacts at startup, resolves a Signer from the
 * configured key source, and exposes contract accessors for each ClawNet
 * Solidity contract.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  Contract,
  HDNodeWallet,
  InterfaceAbi,
  JsonRpcProvider,
  Wallet,
} from 'ethers';

import {
  type ChainConfig,
  type ContractKey,
  CONTRACT_KEYS,
  CONTRACT_NAMES,
} from './chain-config.js';

// ---------------------------------------------------------------------------
// ABI loading
// ---------------------------------------------------------------------------

/**
 * Load a single contract ABI from the hardhat artifacts directory.
 *
 * @param contractName Solidity contract name (e.g. `ClawToken`)
 * @param artifactsDir Path to `packages/contracts/artifacts`
 */
function loadAbi(contractName: string, artifactsDir: string): InterfaceAbi {
  const artifactPath = join(
    artifactsDir,
    'contracts',
    `${contractName}.sol`,
    `${contractName}.json`,
  );
  const raw = readFileSync(artifactPath, 'utf-8');
  const artifact = JSON.parse(raw) as { abi: InterfaceAbi };
  return artifact.abi;
}

// ---------------------------------------------------------------------------
// ContractProvider
// ---------------------------------------------------------------------------

export class ContractProvider {
  readonly provider: JsonRpcProvider;
  readonly signer: Wallet;

  private readonly instances = new Map<ContractKey, Contract>();

  constructor(private readonly config: ChainConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl, {
      chainId: config.chainId,
      name: 'clawnet',
    });

    this.signer = this.resolveSigner();
    this.initContracts();
  }

  // ── Typed accessors ─────────────────────────────────────────────────────

  /** ClawToken (ERC-20) */
  get token(): Contract {
    return this.get('token');
  }

  /** ClawEscrow */
  get escrow(): Contract {
    return this.get('escrow');
  }

  /** ClawIdentity (DID registry) */
  get identity(): Contract {
    return this.get('identity');
  }

  /** ClawReputation */
  get reputation(): Contract {
    return this.get('reputation');
  }

  /** ClawContracts (service contract lifecycle) */
  get serviceContracts(): Contract {
    return this.get('contracts');
  }

  /** ClawDAO (governance) */
  get dao(): Contract {
    return this.get('dao');
  }

  /** ClawStaking */
  get staking(): Contract {
    return this.get('staking');
  }

  /** ParamRegistry (governance parameters) */
  get paramRegistry(): Contract {
    return this.get('paramRegistry');
  }

  // ── Utility ─────────────────────────────────────────────────────────────

  /** Retrieve a contract by config key. Throws if not initialised. */
  get(key: ContractKey): Contract {
    const c = this.instances.get(key);
    if (!c) {
      throw new Error(
        `Contract "${key}" (${CONTRACT_NAMES[key]}) is not initialised. ` +
          'Ensure the ABI is available and the address is configured.',
      );
    }
    return c;
  }

  /** Current block number on the connected chain. */
  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  /** Returns the address of the node's signer. */
  get signerAddress(): string {
    return this.signer.address;
  }

  /** Tear down provider connection. */
  async destroy(): Promise<void> {
    this.provider.destroy();
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private resolveSigner(): Wallet {
    const { signer: cfg } = this.config;

    switch (cfg.type) {
      case 'keyfile': {
        const raw = readFileSync(cfg.path, 'utf-8').trim();
        // Support both a raw hex key file and a JSON { "privateKey": "0x..." } file.
        let privateKey: string;
        try {
          const parsed = JSON.parse(raw) as { privateKey?: string };
          privateKey = parsed.privateKey ?? raw;
        } catch {
          privateKey = raw;
        }
        return new Wallet(privateKey, this.provider);
      }

      case 'env': {
        const pk = process.env[cfg.envVar];
        if (!pk) {
          throw new Error(
            `Signer env var "${cfg.envVar}" is not set. ` +
              'Set it to a hex-encoded private key (with 0x prefix).',
          );
        }
        return new Wallet(pk, this.provider);
      }

      case 'mnemonic': {
        const phrase = process.env[cfg.envVar];
        if (!phrase) {
          throw new Error(
            `Mnemonic env var "${cfg.envVar}" is not set.`,
          );
        }
        const path = `m/44'/60'/0'/0/${cfg.index}`;
        const hd = HDNodeWallet.fromPhrase(phrase, undefined, path);
        return new Wallet(hd.privateKey, this.provider);
      }
    }
  }

  private initContracts(): void {
    const { contracts: addresses, artifactsDir } = this.config;

    for (const key of CONTRACT_KEYS) {
      const address = (addresses as Record<string, string>)[key];
      if (!address) continue;

      const contractName = CONTRACT_NAMES[key];
      try {
        const abi = loadAbi(contractName, artifactsDir);
        this.instances.set(key, new Contract(address, abi, this.signer));
      } catch (err) {
        // ABI not found — contract will be unavailable at runtime.
        // This is acceptable for partially-deployed environments.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ContractProvider] Skipping ${contractName}: ABI not loaded (${msg})`,
        );
      }
    }
  }
}
