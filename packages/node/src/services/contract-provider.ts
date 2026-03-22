/**
 * ContractProvider — manages ethers.js Provider, Signer, and typed contract instances.
 *
 * Loads ABIs from hardhat artifacts at startup, resolves a Signer from the
 * configured key source, and exposes contract accessors for each ClawNet
 * Solidity contract.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  Contract,
  HDNodeWallet,
  InterfaceAbi,
  JsonRpcProvider,
  NonceManager,
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
 * Resolve the artifact file path, checking the local artifacts directory first,
 * then falling back to the `@claw-network/contracts` npm package.
 */
function resolveArtifactPath(contractName: string, artifactsDir: string | undefined): string {
  // If artifactsDir is provided, try local path first
  if (artifactsDir !== undefined) {
    const localPath = join(
      artifactsDir,
      'contracts',
      `${contractName}.sol`,
      `${contractName}.json`,
    );

    try {
      readFileSync(localPath, 'utf-8');
      return localPath;
    } catch {
      // Fall through to npm package fallback
    }
  }

  // Fallback: resolve from @claw-network/contracts npm package
  // The npm package ships artifacts at:
  // node_modules/@claw-network/contracts/artifacts/contracts/<Name>.sol/<Name>.json
  const npmRequire = createRequire(import.meta.url);
  const npmPath = npmRequire.resolve(
    `@claw-network/contracts/artifacts/contracts/${contractName}.sol/${contractName}.json`,
  );
  console.warn(
    `[ContractProvider] Artifact not found locally for "${contractName}" — using @claw-network/contracts npm package`,
  );
  return npmPath;
}

/**
 * Load a single contract ABI from the hardhat artifacts directory.
 *
 * Tries the local `artifactsDir` first; if the artifact is not found there,
 * falls back to the `@claw-network/contracts` npm package which ships the
 * official ClawNet contract artifacts.
 *
 * @param contractName Solidity contract name (e.g. `ClawToken`)
 * @param artifactsDir Path to `packages/contracts/artifacts` (optional, falls back to npm package)
 */
function loadAbi(contractName: string, artifactsDir: string | undefined): InterfaceAbi {
  const artifactPath = resolveArtifactPath(contractName, artifactsDir);

  let raw: string;
  try {
    raw = readFileSync(artifactPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Failed to read artifact for "${contractName}" at "${artifactPath}": ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let artifact: { abi: InterfaceAbi };
  try {
    artifact = JSON.parse(raw) as { abi: InterfaceAbi };
  } catch {
    throw new Error(
      `Failed to parse artifact JSON for "${contractName}" at "${artifactPath}". ` +
      'The artifact file may be corrupted or not valid JSON.',
    );
  }

  if (!artifact.abi || !Array.isArray(artifact.abi)) {
    throw new Error(
      `Artifact for "${contractName}" is missing or has invalid "abi" field.`,
    );
  }

  return artifact.abi;
}

// ---------------------------------------------------------------------------
// ContractProvider
// ---------------------------------------------------------------------------

export class ContractProvider {
  readonly provider: JsonRpcProvider;
  readonly signer: NonceManager;
  private readonly _signerAddress: string;

  private readonly instances = new Map<ContractKey, Contract>();

  constructor(private readonly config: ChainConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl, {
      chainId: config.chainId,
      name: 'clawnet',
    });

    const resolved = this.resolveSigner();
    this.signer = resolved.signer;
    this._signerAddress = resolved.address;
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

  /** ClawRelayReward (relay incentive pool). May be undefined if not deployed. */
  get relayReward(): Contract | undefined {
    return this.instances.get('relayReward');
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
    return this._signerAddress;
  }

  /** Tear down provider connection. */
  async destroy(): Promise<void> {
    try {
      this.provider.destroy();
    } catch {
      // Ignore errors from pending requests being cancelled
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private resolveSigner(): { signer: NonceManager; address: string } {
    const { signer: cfg } = this.config;

    const wrapWallet = (wallet: Wallet): { signer: NonceManager; address: string } => ({
      signer: new NonceManager(wallet),
      address: wallet.address,
    });

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
        return wrapWallet(new Wallet(privateKey, this.provider));
      }

      case 'env': {
        const pk = process.env[cfg.envVar];
        if (!pk) {
          throw new Error(
            `Signer env var "${cfg.envVar}" is not set. ` +
              'Set it to a hex-encoded private key (with 0x prefix).',
          );
        }
        return wrapWallet(new Wallet(pk, this.provider));
      }

      case 'mnemonic': {
        const phrase = process.env[cfg.envVar];
        if (!phrase) {
          throw new Error(`Mnemonic env var "${cfg.envVar}" is not set.`);
        }
        const path = `m/44'/60'/0'/0/${cfg.index}`;
        const hd = HDNodeWallet.fromPhrase(phrase, undefined, path);
        return wrapWallet(new Wallet(hd.privateKey, this.provider));
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
        console.warn(`[ContractProvider] Skipping ${contractName}: ABI not loaded (${msg})`);
      }
    }
  }
}
