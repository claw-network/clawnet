/**
 * IdentityService — on-chain identity operations for ClawIdentity.
 *
 * This service is the single point of truth for all DID write/read
 * operations that hit the chain.  API route handlers delegate to it;
 * it calls the ClawIdentity smart contract via ContractProvider and
 * reads cached DID data from IndexerQuery when available.
 *
 * Design decisions:
 * - DID string → bytes32 hash via `keccak256(toUtf8Bytes(did))`.
 * - Ed25519 public keys are 32-byte `Uint8Array`/hex strings.
 * - `rotationProof` is accepted but NOT verified on-chain in the
 *   current contract version (deferred to Phase 2 T-0.14).
 * - Capability CRUD stays off-chain (P2P / event store); this
 *   service covers only registerDID / rotateKey / revokeDID /
 *   addPlatformLink and their view counterparts.
 */

import { getBytes, keccak256, solidityPacked, toUtf8Bytes } from 'ethers';

import { createLogger } from '../logger.js';
import type { ContractProvider } from './contract-provider.js';
import type { IndexerQuery } from '../indexer/query.js';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Derive a unique, deterministic EVM address for a DID.
 *
 * The address is a pseudo-address (no one holds its private key) used
 * solely as a balance-holding account on the ERC-20 token contract.
 * Token operations (mint / burn) are executed by the node signer which
 * holds MINTER_ROLE and BURNER_ROLE.
 *
 * Formula: `'0x' + keccak256("clawnet:did-address:" + did)[last 20 bytes]`
 */
export function deriveAddressForDid(did: string): string {
  const hash = keccak256(toUtf8Bytes('clawnet:did-address:' + did));
  // Take last 20 bytes (40 hex chars) of the 32-byte hash
  return '0x' + hash.slice(26);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Logger = ReturnType<typeof createLogger>;

/** Mirrors Solidity enum KeyPurpose. */
export type KeyPurpose = 'authentication' | 'assertion' | 'keyAgreement' | 'recovery';

const KEY_PURPOSE_MAP: Record<KeyPurpose, number> = {
  authentication: 0,
  assertion: 1,
  keyAgreement: 2,
  recovery: 3,
};

const KEY_PURPOSE_REVERSE: Record<number, KeyPurpose> = {
  0: 'authentication',
  1: 'assertion',
  2: 'keyAgreement',
  3: 'recovery',
};

// ── Response shapes ───────────────────────────────────────────────────────

export interface DIDRegistrationResult {
  txHash: string;
  did: string;
  controller: string;
  timestamp: number;
}

export interface KeyRotationResult {
  txHash: string;
  did: string;
  oldKeyHash: string;
  newKeyHash: string;
  timestamp: number;
}

export interface DIDRevocationResult {
  txHash: string;
  did: string;
  timestamp: number;
}

export interface PlatformLinkResult {
  txHash: string;
  did: string;
  linkHash: string;
  timestamp: number;
}

export interface DIDDocument {
  did: string;
  didHash: string;
  controller: string;
  publicKey: string;
  keyPurpose: KeyPurpose;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  platformLinks: string[];
}

// ---------------------------------------------------------------------------
// IdentityService
// ---------------------------------------------------------------------------

export class IdentityService {
  private readonly log: Logger;

  constructor(
    private readonly contracts: ContractProvider,
    private readonly indexer?: IndexerQuery,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ level: 'info' });
  }

  // ========================================================================
  // READ operations
  // ========================================================================

  /**
   * Resolve a DID to its full on-chain document.
   *
   * Reads the DIDRecord + active KeyRecord + platform links from the
   * ClawIdentity contract.
   *
   * @returns The DID document, or `null` if not registered.
   */
  async resolve(did: string): Promise<DIDDocument | null> {
    const didHash = this.hashDid(did);
    const identity = this.contracts.identity;

    try {
      const active: boolean = await identity.isActive(didHash);
      const controller: string = await identity.getController(didHash);
      if (controller === '0x0000000000000000000000000000000000000000') {
        return null;
      }

      const publicKeyBytes: string = await identity.getActiveKey(didHash);
      const activeKeyHash = keccak256(getBytes(publicKeyBytes));

      // Get key record for purpose
      const keyRecord = await identity.getKeyRecord(didHash, activeKeyHash);
      const purpose = KEY_PURPOSE_REVERSE[Number(keyRecord.purpose)] ?? 'authentication';

      // DID record for timestamps
      const didRecord = await identity.dids(didHash);
      const createdAt = Number(didRecord.createdAt);
      const updatedAt = Number(didRecord.updatedAt);

      // Platform links
      const linkHashes: string[] = await identity.getPlatformLinks(didHash);

      return {
        did,
        didHash,
        controller,
        publicKey: publicKeyBytes,
        keyPurpose: purpose,
        isActive: active,
        createdAt,
        updatedAt,
        platformLinks: linkHashes,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the controller EVM address for a DID.
   *
   * @returns The controller address, or `null` if not registered.
   */
  async getController(did: string): Promise<string | null> {
    const didHash = this.hashDid(did);
    try {
      const controller: string = await this.contracts.identity.getController(didHash);
      if (controller === '0x0000000000000000000000000000000000000000') {
        return null;
      }
      return controller;
    } catch {
      return null;
    }
  }

  /**
   * Check if a DID is active on-chain.
   */
  async isActive(did: string): Promise<boolean> {
    const didHash = this.hashDid(did);
    try {
      return await this.contracts.identity.isActive(didHash);
    } catch {
      return false;
    }
  }

  /**
   * Resolve a DID from the indexer cache (faster, eventually consistent).
   *
   * @returns Cached DID record or `null`.
   */
  getCachedDid(did: string): { controller: string; activeKey: string; isActive: boolean; updatedAt: number } | null {
    if (!this.indexer) return null;
    const didHash = this.hashDid(did);
    return this.indexer.getDid(didHash);
  }

  // ========================================================================
  // WRITE operations
  // ========================================================================

  /**
   * Register a new DID on-chain.
   *
   * @param did        Full DID string (`did:claw:z6Mk...`)
   * @param publicKey  Ed25519 public key (32 bytes, hex-encoded with `0x` prefix)
   * @param purpose    Key purpose (default: `authentication`)
   * @param evmAddress EVM address for cross-reference (default: signer address)
   */
  async registerDID(
    did: string,
    publicKey: string,
    purpose: KeyPurpose = 'authentication',
    evmAddress?: string,
  ): Promise<DIDRegistrationResult> {
    const didHash = this.hashDid(did);
    const purposeNum = KEY_PURPOSE_MAP[purpose];
    const evmAddr = evmAddress ?? '0x0000000000000000000000000000000000000000';
    // Contract defaults controller to msg.sender when evmAddress is zero
    const controller = evmAddr === '0x0000000000000000000000000000000000000000'
      ? this.contracts.signerAddress
      : evmAddr;

    this.log.info('Identity register: %s (purpose=%s)', did, purpose);

    // H-01: sign registration digest for on-chain verification
    // _verifyControllerSig domain-separates with (chainId, contractAddress, message)
    const message = solidityPacked(
      ['string', 'bytes32', 'address'],
      ['clawnet:register:v1:', didHash, controller],
    );
    const identityAddr = await this.contracts.identity.getAddress();
    const { chainId } = await this.contracts.provider.getNetwork();
    const digest = keccak256(solidityPacked(
      ['uint256', 'address', 'bytes'],
      [chainId, identityAddr, message],
    ));
    const evmSig = await this.contracts.signer.signMessage(getBytes(digest));

    const tx = await this.contracts.identity.registerDID(
      didHash,
      publicKey,
      purposeNum,
      evmAddr,
      evmSig,
    );
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      did,
      controller,
      timestamp: Date.now(),
    };
  }

  /**
   * Rotate the active key for a DID.
   *
   * @param did           Full DID string
   * @param newPublicKey  New Ed25519 public key (hex, 32 bytes)
   * @param rotationProof Signature proof from old key (hex).
   *                      Not verified on-chain in current contract version.
   */
  async rotateKey(
    did: string,
    newPublicKey: string,
    rotationProof: string = '0x',
  ): Promise<KeyRotationResult> {
    const didHash = this.hashDid(did);

    this.log.info('Identity rotate key: %s', did);

    const tx = await this.contracts.identity.rotateKey(
      didHash,
      newPublicKey,
      rotationProof,
    );
    const receipt = await tx.wait();

    // Extract old/new key hashes from the KeyRotated event
    let oldKeyHash = '';
    let newKeyHash = '';
    for (const log of receipt.logs) {
      try {
        const parsed = this.contracts.identity.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === 'KeyRotated') {
          oldKeyHash = parsed.args[1] as string;
          newKeyHash = parsed.args[2] as string;
          break;
        }
      } catch {
        // Not our event — skip.
      }
    }

    return {
      txHash: receipt.hash,
      did,
      oldKeyHash,
      newKeyHash,
      timestamp: Date.now(),
    };
  }

  /**
   * Permanently revoke a DID.  This cannot be undone.
   */
  async revokeDID(did: string): Promise<DIDRevocationResult> {
    const didHash = this.hashDid(did);

    this.log.info('Identity revoke: %s', did);

    const tx = await this.contracts.identity.revokeDID(didHash);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      did,
      timestamp: Date.now(),
    };
  }

  /**
   * Anchor a platform link hash to a DID on-chain.
   */
  async addPlatformLink(
    did: string,
    linkHash: string,
  ): Promise<PlatformLinkResult> {
    const didHash = this.hashDid(did);

    this.log.info('Identity add platform link: %s', did);

    const tx = await this.contracts.identity.addPlatformLink(didHash, linkHash);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      did,
      linkHash,
      timestamp: Date.now(),
    };
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  /**
   * Ensure a DID is registered on-chain.  If already registered, returns
   * the existing controller.  If not, auto-registers via `batchRegisterDID`
   * (REGISTRAR_ROLE — no ECDSA signature needed) with a **unique derived
   * address** as controller so each DID has its own balance slot.
   *
   * @param did       Full DID string (`did:claw:z...`)
   * @param publicKey Ed25519 public key (32 bytes, hex 0x-prefixed)
   * @returns The controller (EVM) address (unique per DID).
   */
  async ensureRegistered(
    did: string,
    publicKey: string,
  ): Promise<string> {
    // Check if already registered
    const existing = await this.getController(did);
    if (existing) return existing;

    const didHash = this.hashDid(did);
    const controller = deriveAddressForDid(did);

    this.log.info('Identity auto-register (batchRegisterDID): %s → %s', did, controller);

    const tx = await this.contracts.identity.batchRegisterDID(
      [didHash],
      [publicKey],
      [KEY_PURPOSE_MAP.authentication],
      [controller],
    );
    await tx.wait();

    return controller;
  }

  /**
   * Hash a DID string to bytes32 for on-chain use.
   *
   * Uses keccak256(toUtf8Bytes(did)) — consistent with WalletService.
   */
  private hashDid(did: string): string {
    return keccak256(toUtf8Bytes(did));
  }
}
