/**
 * On-chain Identity API — calls ClawIdentity smart contract directly.
 *
 * Drop-in replacement for the REST-based `IdentityApi` when running in on-chain mode.
 * Requires ethers v6 as a peer dependency.
 *
 * @example
 * ```ts
 * import { ethers } from 'ethers';
 * import { IdentityOnChainApi } from '@claw-network/sdk';
 *
 * const provider = new ethers.JsonRpcProvider('https://rpc.clawnetd.com');
 * const signer = new ethers.Wallet(privateKey, provider);
 * const identity = new IdentityOnChainApi(signer, {
 *   identityAddress: '0x...',
 * });
 * await identity.register(didHash, publicKey);
 * ```
 */
import {
  type ContractTransactionReceipt,
  Contract,
  type Signer,
  hexlify,
} from 'ethers';
import type { Identity } from './types.js';

// ---------------------------------------------------------------------------
// Minimal ABI fragments
// ---------------------------------------------------------------------------

const IDENTITY_ABI = [
  'function registerDID(bytes32 didHash, bytes publicKey, uint8 purpose, address evmAddress)',
  'function rotateKey(bytes32 didHash, bytes newPublicKey, bytes rotationProof)',
  'function revokeDID(bytes32 didHash)',
  'function addPlatformLink(bytes32 didHash, bytes32 linkHash)',
  'function isActive(bytes32 didHash) view returns (bool)',
  'function getActiveKey(bytes32 didHash) view returns (bytes)',
  'function getController(bytes32 didHash) view returns (address)',
  'function getKeyRecord(bytes32 didHash, bytes32 keyHash) view returns (bytes publicKey, uint64 addedAt, uint64 revokedAt, uint8 purpose)',
  'function getPlatformLinks(bytes32 didHash) view returns (bytes32[])',
  'function getPlatformLinkCount(bytes32 didHash) view returns (uint256)',
  'function didCount() view returns (uint256)',
] as const;

/** KeyPurpose enum mirroring ClawIdentity.KeyPurpose */
export enum KeyPurpose {
  Authentication = 0,
  Assertion = 1,
  KeyAgreement = 2,
  Recovery = 3,
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Addresses of deployed identity contracts. */
export interface OnChainIdentityConfig {
  /** ClawIdentity proxy address. */
  identityAddress: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Registration result. */
export interface RegisterResult {
  txHash: string;
  didHash: string;
  controller: string;
}

/** Key rotation result. */
export interface RotateKeyResult {
  txHash: string;
  didHash: string;
}

/** Key record from on-chain storage. */
export interface OnChainKeyRecord {
  publicKey: string;
  addedAt: number;
  revokedAt: number;
  purpose: KeyPurpose;
}

/** Platform link addition result. */
export interface AddPlatformLinkResult {
  txHash: string;
  didHash: string;
  linkHash: string;
}

// ---------------------------------------------------------------------------
// IdentityOnChainApi
// ---------------------------------------------------------------------------

/**
 * On-chain identity implementation that calls ClawIdentity contract.
 *
 * Mirrors the method signatures of the REST-based `IdentityApi` where applicable.
 */
export class IdentityOnChainApi {
  private readonly identity: Contract;
  private readonly signer: Signer;

  constructor(signer: Signer, config: OnChainIdentityConfig) {
    this.signer = signer;
    this.identity = new Contract(config.identityAddress, IDENTITY_ABI, signer);
  }

  // -----------------------------------------------------------------------
  // Write operations
  // -----------------------------------------------------------------------

  /**
   * Register a new DID on-chain.
   *
   * @param didHash    keccak256 hash of the DID string (bytes32).
   * @param publicKey  Ed25519 public key (32 bytes, hex-encoded or Uint8Array).
   * @param purpose    Key purpose (default: Authentication).
   * @param evmAddress Controller address (defaults to signer's address if zero/omitted).
   */
  async register(
    didHash: string,
    publicKey: string | Uint8Array,
    purpose: KeyPurpose = KeyPurpose.Authentication,
    evmAddress?: string,
  ): Promise<RegisterResult> {
    const keyBytes = typeof publicKey === 'string' ? publicKey : hexlify(publicKey);
    const controller = evmAddress ?? '0x0000000000000000000000000000000000000000';

    const tx = await this.identity.registerDID(didHash, keyBytes, purpose, controller);
    const receipt: ContractTransactionReceipt | null = await tx.wait();

    return {
      txHash: receipt?.hash ?? tx.hash,
      didHash,
      controller: controller === '0x0000000000000000000000000000000000000000'
        ? await this.signer.getAddress()
        : controller,
    };
  }

  /**
   * Rotate the active key for a DID.
   *
   * @param didHash       DID hash (bytes32).
   * @param newPublicKey  New Ed25519 public key (32 bytes).
   * @param rotationProof Signature proof from old key (stored, verified in Phase 2).
   */
  async rotateKey(
    didHash: string,
    newPublicKey: string | Uint8Array,
    rotationProof: string | Uint8Array = '0x',
  ): Promise<RotateKeyResult> {
    const keyBytes = typeof newPublicKey === 'string' ? newPublicKey : hexlify(newPublicKey);
    const proofBytes = typeof rotationProof === 'string' ? rotationProof : hexlify(rotationProof);

    const tx = await this.identity.rotateKey(didHash, keyBytes, proofBytes);
    const receipt: ContractTransactionReceipt | null = await tx.wait();

    return {
      txHash: receipt?.hash ?? tx.hash,
      didHash,
    };
  }

  /**
   * Revoke a DID permanently.
   *
   * @param didHash DID hash (bytes32).
   */
  async revokeDID(didHash: string): Promise<string> {
    const tx = await this.identity.revokeDID(didHash);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return receipt?.hash ?? tx.hash;
  }

  /**
   * Add a platform link to a DID.
   *
   * @param didHash  DID hash (bytes32).
   * @param linkHash keccak256 hash of the platform link data (bytes32).
   */
  async addPlatformLink(
    didHash: string,
    linkHash: string,
  ): Promise<AddPlatformLinkResult> {
    const tx = await this.identity.addPlatformLink(didHash, linkHash);
    const receipt: ContractTransactionReceipt | null = await tx.wait();

    return {
      txHash: receipt?.hash ?? tx.hash,
      didHash,
      linkHash,
    };
  }

  // -----------------------------------------------------------------------
  // Read / Resolve operations
  // -----------------------------------------------------------------------

  /**
   * Resolve a DID — fetch active key and controller from on-chain state.
   *
   * @param didHash DID hash (bytes32).
   * @returns Identity object matching the REST API shape.
   */
  async resolve(didHash: string): Promise<Identity> {
    const [active, publicKey, controller] = await Promise.all([
      this.identity.isActive(didHash) as Promise<boolean>,
      this.identity.getActiveKey(didHash) as Promise<string>,
      this.identity.getController(didHash) as Promise<string>,
    ]);

    return {
      did: didHash,
      publicKey: publicKey as string,
      created: 0, // Not available via current view functions
      updated: 0,
      active,
      controller,
    };
  }

  /**
   * Check whether a DID is active (registered and not revoked).
   */
  async isActive(didHash: string): Promise<boolean> {
    return this.identity.isActive(didHash) as Promise<boolean>;
  }

  /**
   * Get the active public key for a DID.
   */
  async getActiveKey(didHash: string): Promise<string> {
    return this.identity.getActiveKey(didHash) as Promise<string>;
  }

  /**
   * Get the controller address for a DID.
   */
  async getController(didHash: string): Promise<string> {
    return this.identity.getController(didHash) as Promise<string>;
  }

  /**
   * Get a specific key record by DID hash and key hash.
   */
  async getKeyRecord(didHash: string, keyHash: string): Promise<OnChainKeyRecord> {
    const result = await this.identity.getKeyRecord(didHash, keyHash);
    const [publicKey, addedAt, revokedAt, purpose] = result;
    return {
      publicKey: publicKey as string,
      addedAt: Number(addedAt as bigint),
      revokedAt: Number(revokedAt as bigint),
      purpose: Number(purpose) as KeyPurpose,
    };
  }

  /**
   * Get all platform link hashes for a DID.
   */
  async getPlatformLinks(didHash: string): Promise<string[]> {
    return this.identity.getPlatformLinks(didHash) as Promise<string[]>;
  }

  /**
   * Get the total number of registered DIDs.
   */
  async getDIDCount(): Promise<number> {
    const raw: bigint = await this.identity.didCount();
    return Number(raw);
  }

  /** Get the connected signer's address. */
  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }
}
