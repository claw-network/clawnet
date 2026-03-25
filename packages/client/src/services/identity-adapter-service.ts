import { readFileSync } from 'node:fs';

import { ErrorCodes, TelagentError, hashDid, isDidClaw, type AgentDID } from '../protocol/index.js';
import { publicKeyFromDid, bytesToHex } from '@claw-network/core';
import { ethers } from 'ethers';

import type { ClawNetGatewayService, IdentityInfo } from '../clawnet/gateway-service.js';
import type { IdentityCache } from '../storage/identity-cache.js';
import { getGlobalLogger } from '../logger.js';

const logger = getGlobalLogger();

/** Minimal ABI for on-chain DID identity ops (no artifacts needed) */
const IDENTITY_ABI = [
  'function getController(bytes32 didHash) view returns (address)',
  'function isActive(bytes32 didHash) view returns (bool)',
  'function selfRegisterDID(bytes32 didHash, bytes publicKey, uint8 purpose)',
];

export interface ResolvedIdentity {
  did: AgentDID;
  didHash: string;
  controller: string;
  publicKey: string;
  isActive: boolean;
  resolvedAtMs: number;
  address: string;
  activeKey: string;
}

export interface DidRevocationEvent {
  did: AgentDID;
  didHash: string;
  revokedAtMs: number;
  source: string;
}

export type DidRevocationListener = (event: DidRevocationEvent) => void;

export class IdentityAdapterService {
  private selfDidCache: AgentDID | null = null;
  private selfAddressCache: string | null = null;
  private readonly revocationListeners = new Set<DidRevocationListener>();
  private identityCache?: IdentityCache;

  constructor(
    private readonly gateway: ClawNetGatewayService,
    options?: { identityCache?: IdentityCache },
  ) {
    this.identityCache = options?.identityCache;
  }

  subscribeDidRevocations(listener: DidRevocationListener): () => void {
    this.revocationListeners.add(listener);
    return () => {
      this.revocationListeners.delete(listener);
    };
  }

  notifyDidRevoked(
    rawDid: string,
    options?: {
      source?: string;
      revokedAtMs?: number;
      didHash?: string;
    },
  ): DidRevocationEvent {
    if (!isDidClaw(rawDid)) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'DID must use did:claw format');
    }

    const did = rawDid as AgentDID;
    const event: DidRevocationEvent = {
      did,
      didHash: options?.didHash ?? hashDid(did),
      revokedAtMs: options?.revokedAtMs ?? Date.now(),
      source: options?.source?.trim() || 'manual',
    };

    for (const listener of this.revocationListeners) {
      try {
        listener(event);
      } catch {
        // keep revocation fan-out best-effort to avoid blocking caller path
      }
    }

    return event;
  }

  async getSelf(): Promise<ResolvedIdentity> {
    const info = await this.gateway.getSelfIdentity();
    const resolved = this.toResolvedIdentity(info);
    this.selfDidCache = resolved.did;
    this.selfAddressCache = resolved.address;
    return resolved;
  }

  getSelfDid(): AgentDID {
    if (!this.selfDidCache) {
      throw new TelagentError(ErrorCodes.CONFLICT, 'Identity not initialized. Call init() first.');
    }
    return this.selfDidCache;
  }

  async init(): Promise<void> {
    await this.getSelf();
  }

  /**
   * Ensure the node's own DID is registered on-chain.
   * Strategy:
   * 1. If a managed ClawNet node is available, use its identity service (batchRegisterDID)
   * 2. Otherwise, fall back to direct ethers.js contract call using CLAW_CHAIN_* env vars
   */
  async ensureRegistered(): Promise<void> {
    const self = await this.getSelf();
    // If controller is a real EVM address (starts with 0x), it's already on-chain
    if (self.controller.startsWith('0x')) {
      return;
    }
    // Double-check on-chain directly (ClawNet DHT may not include chain data)
    const onChain = await this.resolveOnChain(self.did);
    if (onChain) {
      return;
    }
    // Convert the multibase public key to 0x-prefixed hex for the smart contract
    const rawBytes = publicKeyFromDid(self.did);
    const hexKey = `0x${bytesToHex(rawBytes)}`;

    // Direct ethers.js call — uses selfRegisterDID (permissionless, controller = msg.sender)
    await this.registerOnChainDirect(self.did, hexKey);
    // Refresh self identity to pick up chain data
    await this.getSelf();
  }

  /**
   * Resolve a wallet for chain operations using CLAW_SIGNER_* / TELAGENT_SIGNER_* env vars.
   * Supports: env (raw private key), keyfile (plain JSON or encrypted keystore), mnemonic.
   */
  private async resolveChainWallet(provider: ethers.JsonRpcProvider): Promise<ethers.Wallet> {
    const signerType = process.env.CLAW_SIGNER_TYPE || process.env.TELAGENT_SIGNER_TYPE || 'env';

    if (signerType === 'keyfile') {
      const keyPath = process.env.CLAW_SIGNER_PATH || process.env.TELAGENT_SIGNER_PATH;
      if (!keyPath) {
        throw new Error('Signer type is keyfile but no path set (CLAW_SIGNER_PATH / TELAGENT_SIGNER_PATH)');
      }
      const raw = readFileSync(keyPath, 'utf8').trim();
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Raw private key string
        return new ethers.Wallet(raw, provider);
      }
      // Plain JSON keyfile with { privateKey: "0x..." }
      if (typeof parsed.privateKey === 'string') {
        return new ethers.Wallet(parsed.privateKey, provider);
      }
      // Encrypted keystore (ethers v3 format — has "crypto" or "Crypto" field)
      if (parsed.crypto || parsed.Crypto) {
        const password = process.env.CLAW_SIGNER_PASSWORD || process.env.TELAGENT_SIGNER_PASSWORD;
        if (!password) {
          throw new Error('Encrypted keystore found but no password set (CLAW_SIGNER_PASSWORD / TELAGENT_SIGNER_PASSWORD)');
        }
        const wallet = await ethers.Wallet.fromEncryptedJson(raw, password);
        return wallet.connect(provider) as ethers.Wallet;
      }
      throw new Error(`Keyfile at ${keyPath} has unrecognized format`);
    }

    if (signerType === 'mnemonic') {
      const envVar = process.env.CLAW_SIGNER_ENV || process.env.TELAGENT_SIGNER_ENV || 'TELAGENT_MNEMONIC';
      const mnemonic = process.env[envVar];
      if (!mnemonic) throw new Error(`Mnemonic env var ${envVar} is not set`);
      const index = parseInt(process.env.TELAGENT_SIGNER_INDEX || '0', 10);
      const path = `m/44'/60'/0'/0/${index}`;
      const hdWallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, path);
      return new ethers.Wallet(hdWallet.privateKey, provider);
    }

    // Default: env type — read raw private key from env var
    const envVar = process.env.CLAW_SIGNER_ENV || 'CLAW_PRIVATE_KEY';
    const privateKey = process.env[envVar];
    if (!privateKey) {
      throw new Error(
        `Signer env var ${envVar} is not set. ` +
        'Set CLAW_SIGNER_ENV to the env var name containing the private key, or use keyfile/mnemonic signer.',
      );
    }
    return new ethers.Wallet(privateKey, provider);
  }

  /** Minimum balance required to send a chain tx (0.001 ETH) */
  private static readonly MIN_GAS_BALANCE = ethers.parseEther('0.001');

  /**
   * Ensure the wallet has enough gas. If balance is below threshold,
   * claims tokens from the ClawNet public faucet via the ClawNet node SDK.
   * The ClawNet node handles Ed25519 signing internally.
   */
  private async ensureGas(wallet: ethers.Wallet, provider: ethers.JsonRpcProvider): Promise<void> {
    // Zero-gas chains (gasPrice == 0) don't require balance — skip check
    const feeData = await provider.getFeeData();
    if (feeData.gasPrice !== null && feeData.gasPrice === 0n) return;

    const balance = await provider.getBalance(wallet.address);
    if (balance >= IdentityAdapterService.MIN_GAS_BALANCE) return;

    logger.info('[telagent] Wallet %s has %s ETH — requesting tokens from faucet via ClawNet node',
      wallet.address, ethers.formatEther(balance));

    try {
      const result = await this.gateway.claimFaucet();
      logger.info('[telagent] Faucet claim succeeded: did=%s amount=%s tx=%s',
        result.did, result.amount, result.txHash);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Wallet ${wallet.address} has insufficient gas (${ethers.formatEther(balance)} ETH) ` +
        `and faucet claim failed: ${msg}. Fund the wallet manually.`,
      );
    }
  }

  /**
   * Register DID on-chain directly using ethers.js and CLAW_CHAIN_* env vars.
   * Used as fallback when no managed ClawNet node is available.
   */
  private async registerOnChainDirect(did: string, publicKeyHex: string): Promise<void> {
    const rpcUrl = process.env.CLAW_CHAIN_RPC_URL;
    const identityAddr = process.env.CLAW_CHAIN_IDENTITY_CONTRACT;

    if (!rpcUrl || !identityAddr) {
      throw new Error(
        'Missing chain config for direct registration. ' +
        'Set CLAW_CHAIN_RPC_URL and CLAW_CHAIN_IDENTITY_CONTRACT.',
      );
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = await this.resolveChainWallet(provider);
    const contract = new ethers.Contract(identityAddr, IDENTITY_ABI, wallet);
    const didHash = ethers.keccak256(ethers.toUtf8Bytes(did));

    // Check if already registered on-chain
    try {
      const controller = await contract.getController(didHash);
      if (controller !== ethers.ZeroAddress) {
        logger.info('[telagent] DID already on-chain: %s → controller %s', did, controller);
        return;
      }
    } catch {
      // getController reverts when DID not found — proceed to register
    }

    // Ensure the wallet has gas for the transaction
    await this.ensureGas(wallet, provider);

    // Register via selfRegisterDID — permissionless, controller = msg.sender
    logger.info('[telagent] Direct chain registration: %s → controller %s', did, wallet.address);
    const tx = await contract.selfRegisterDID(
      didHash,
      publicKeyHex,
      0, // authentication purpose
    );
    await tx.wait();
    logger.info('[telagent] DID registered on-chain successfully: %s', did);
  }

  /**
   * Resolve a DID by querying the on-chain ClawIdentity contract.
   * Returns null if chain config is missing or DID is not registered.
   */
  private async resolveOnChain(did: string): Promise<ResolvedIdentity | null> {
    const rpcUrl = process.env.CLAW_CHAIN_RPC_URL;
    const identityAddr = process.env.CLAW_CHAIN_IDENTITY_CONTRACT;
    if (!rpcUrl || !identityAddr) return null;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(identityAddr, IDENTITY_ABI, provider);
    const didHash = ethers.keccak256(ethers.toUtf8Bytes(did));

    try {
      const [controller, active] = await Promise.all([
        contract.getController(didHash),
        contract.isActive(didHash),
      ]);
      if (controller === ethers.ZeroAddress) return null;

      // Extract multibase public key from DID (last segment)
      const keyPart = did.split(':').pop() || did;
      return {
        did: did as AgentDID,
        didHash,
        controller,
        publicKey: keyPart,
        isActive: active,
        resolvedAtMs: Date.now(),
        address: controller,
        activeKey: keyPart,
      };
    } catch {
      // getController reverts when DID not registered
      return null;
    }
  }

  async resolve(rawDid: string): Promise<ResolvedIdentity> {
    if (!isDidClaw(rawDid)) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'DID must use did:claw format');
    }

    if (this.selfDidCache && rawDid === this.selfDidCache) {
      return this.getSelf();
    }

    // Check disk cache
    const cached = this.identityCache?.get(rawDid);
    if (cached) {
      return {
        did: cached.did as AgentDID,
        didHash: cached.didHash,
        controller: cached.controller,
        publicKey: cached.publicKey,
        isActive: cached.isActive,
        resolvedAtMs: cached.resolvedAtMs,
        address: cached.address,
        activeKey: cached.activeKey,
      };
    }

    let resolved: ResolvedIdentity;
    try {
      const info = await this.gateway.resolveIdentity(rawDid);
      resolved = this.toResolvedIdentity(info);
    } catch (error) {
      // DHT resolution failed — try on-chain fallback
      if (this.isDidNotFoundError(error)) {
        const chainResolved = await this.resolveOnChain(rawDid);
        if (chainResolved) {
          resolved = chainResolved;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    // Write to disk cache
    if (this.identityCache) {
      this.identityCache.set(resolved);
      void this.identityCache.flush();
    }

    return resolved;
  }

  async assertActiveDid(rawDid: string): Promise<ResolvedIdentity> {
    try {
      const identity = await this.resolve(rawDid);
      if (!identity.isActive) {
        this.notifyDidRevoked(identity.did, {
          source: 'identity-active-check',
          revokedAtMs: identity.resolvedAtMs,
          didHash: identity.didHash,
        });
        throw new TelagentError(ErrorCodes.UNPROCESSABLE, 'DID is revoked or inactive');
      }
      return identity;
    } catch (error) {
      if (this.isDidNotFoundError(error) && isDidClaw(rawDid)) {
        const did = rawDid as AgentDID;
        return {
          did,
          didHash: hashDid(did),
          controller: did,
          publicKey: did,
          isActive: true,
          resolvedAtMs: Date.now(),
          address: did,
          activeKey: did,
        };
      }
      throw error;
    }
  }

  private isDidNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes('did not found');
  }

  async assertControllerBySigner(rawDid: string): Promise<ResolvedIdentity> {
    const identity = await this.assertActiveDid(rawDid);
    const self = await this.getSelf();
    const signerAddress = (this.selfAddressCache ?? self.address).toLowerCase();
    if (identity.controller.toLowerCase() !== signerAddress) {
      throw new TelagentError(
        ErrorCodes.FORBIDDEN,
        `Signer ${self.address} is not controller for DID ${identity.did}`,
      );
    }
    return identity;
  }

  private toResolvedIdentity(info: IdentityInfo): ResolvedIdentity {
    const did = info.did as AgentDID;
    const controller = (info.controller || info.address || info.did || '').trim();
    const address = (info.address || info.controller || info.did || '').trim();
    const publicKey = (info.activeKey || info.publicKey || info.did || '').trim();

    return {
      did,
      didHash: hashDid(did),
      controller: controller || did,
      publicKey: publicKey || did,
      isActive: info.isActive ?? true,
      resolvedAtMs: Date.now(),
      address: address || did,
      activeKey: publicKey || did,
    };
  }
}
