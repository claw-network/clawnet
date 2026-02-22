/**
 * On-chain Reputation API — calls ClawReputation smart contract directly.
 *
 * @example
 * ```ts
 * import { ethers } from 'ethers';
 * import { ReputationOnChainApi } from '@claw-network/sdk';
 *
 * const provider = new ethers.JsonRpcProvider('https://rpc.clawnetd.com');
 * const signer = new ethers.Wallet(privateKey, provider);
 * const reputation = new ReputationOnChainApi(signer, {
 *   reputationAddress: '0x...',
 * });
 * const score = await reputation.getTrustScore('0x...');
 * ```
 */
import {
  type ContractTransactionReceipt,
  Contract,
  type Signer,
  type Provider,
} from 'ethers';

// ---------------------------------------------------------------------------
// Minimal ABI fragments
// ---------------------------------------------------------------------------

const REPUTATION_ABI = [
  // Write (ANCHOR_ROLE)
  'function anchorReputation(bytes32 agentDIDHash, uint16 overallScore, uint16[5] dimensionScores, bytes32 merkleRoot)',
  'function batchAnchorReputation(bytes32[] agentDIDHashes, uint16[] overallScores, uint16[] dimensionScoresFlat, bytes32[] merkleRoots)',
  'function recordReview(bytes32 reviewHash, bytes32 reviewerDIDHash, bytes32 subjectDIDHash, bytes32 txHash)',
  'function linkAddressToDID(address account, bytes32 agentDIDHash)',
  // Views
  'function getReputation(bytes32 agentDIDHash) view returns (uint16 score, uint64 epoch)',
  'function getLatestSnapshot(bytes32 agentDIDHash) view returns (tuple(uint16 overallScore, uint16[5] dimensionScores, bytes32 merkleRoot, uint64 epoch, uint64 timestamp))',
  'function getSnapshotHistory(bytes32 agentDIDHash, uint64 epoch) view returns (tuple(uint16 overallScore, uint16[5] dimensionScores, bytes32 merkleRoot, uint64 epoch, uint64 timestamp))',
  'function verifyReview(bytes32 reviewHash) view returns (tuple(bytes32 reviewerDIDHash, bytes32 subjectDIDHash, bytes32 txHash, uint64 timestamp))',
  'function verifyMerkleProof(bytes32 agentDIDHash, uint64 epoch, bytes32 leaf, bytes32[] proof) view returns (bool)',
  'function getTrustScore(address account) view returns (uint256)',
  'function getCurrentEpoch() view returns (uint64)',
  'function totalAgents() view returns (uint256)',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Reputation dimension names (indices 0-4). */
export enum ReputationDimension {
  TaskCompletion = 0,
  QualityOfWork = 1,
  Timeliness = 2,
  Communication = 3,
  Trustworthiness = 4,
}

/** Reputation snapshot returned from the contract. */
export interface ReputationSnapshot {
  overallScore: number;
  dimensionScores: [number, number, number, number, number];
  merkleRoot: string;
  epoch: number;
  timestamp: number;
}

/** Review anchor returned from the contract. */
export interface ReviewAnchor {
  reviewerDIDHash: string;
  subjectDIDHash: string;
  txHash: string;
  timestamp: number;
}

/** Reputation summary (score + epoch). */
export interface ReputationSummary {
  score: number;
  epoch: number;
}

/** Transaction result. */
export interface ReputationTxResult {
  txHash: string;
  status: 'confirmed' | 'failed';
}

/** Configuration. */
export interface OnChainReputationConfig {
  /** ClawReputation proxy address. */
  reputationAddress: string;
}

// ---------------------------------------------------------------------------
// ReputationOnChainApi
// ---------------------------------------------------------------------------

/**
 * On-chain reputation implementation that calls ClawReputation contract.
 *
 * Write operations require ANCHOR_ROLE.
 * Read operations are available to anyone.
 */
export class ReputationOnChainApi {
  private readonly reputation: Contract;
  private readonly signer: Signer;

  constructor(signer: Signer, config: OnChainReputationConfig) {
    this.signer = signer;
    this.reputation = new Contract(config.reputationAddress, REPUTATION_ABI, signer);
  }

  /**
   * Create a read-only instance (no signer needed, just a provider).
   */
  static readOnly(provider: Provider, config: OnChainReputationConfig): ReputationOnChainApi {
    // Create a contract connected to provider only
    const contract = new Contract(config.reputationAddress, REPUTATION_ABI, provider);
    const api = Object.create(ReputationOnChainApi.prototype);
    api.reputation = contract;
    api.signer = null;
    return api;
  }

  // ── Write operations (ANCHOR_ROLE) ───────────────────────────────

  /**
   * Anchor a single agent's reputation on-chain.
   *
   * @param agentDIDHash    keccak256 of the DID string.
   * @param overallScore    Overall score (0–1000).
   * @param dimensionScores Array of 5 dimension scores.
   * @param merkleRoot      Merkle root of detailed reputation data.
   */
  async anchorReputation(
    agentDIDHash: string,
    overallScore: number,
    dimensionScores: [number, number, number, number, number],
    merkleRoot: string,
  ): Promise<ReputationTxResult> {
    const tx = await this.reputation.anchorReputation(
      agentDIDHash, overallScore, dimensionScores, merkleRoot,
    );
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /**
   * Batch anchor multiple agents' reputations.
   *
   * @param agents         Array of DID hashes.
   * @param scores         Array of overall scores.
   * @param dimensionsFlat Flat array of dimension scores (5 per agent).
   * @param merkleRoots    Array of merkle roots.
   */
  async batchAnchorReputation(
    agents: string[],
    scores: number[],
    dimensionsFlat: number[],
    merkleRoots: string[],
  ): Promise<ReputationTxResult> {
    const tx = await this.reputation.batchAnchorReputation(
      agents, scores, dimensionsFlat, merkleRoots,
    );
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Record a review between two DIDs. */
  async recordReview(
    reviewHash: string,
    reviewerDIDHash: string,
    subjectDIDHash: string,
    txHash: string,
  ): Promise<ReputationTxResult> {
    const tx = await this.reputation.recordReview(
      reviewHash, reviewerDIDHash, subjectDIDHash, txHash,
    );
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Link an EVM address to a DID hash (for getTrustScore lookups). */
  async linkAddressToDID(account: string, agentDIDHash: string): Promise<ReputationTxResult> {
    const tx = await this.reputation.linkAddressToDID(account, agentDIDHash);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  // ── Read operations ──────────────────────────────────────────────

  /** Get overall reputation score and epoch for a DID. */
  async getReputation(agentDIDHash: string): Promise<ReputationSummary> {
    const [score, epoch] = await this.reputation.getReputation(agentDIDHash);
    return { score: Number(score), epoch: Number(epoch) };
  }

  /** Get the latest reputation snapshot for a DID. */
  async getLatestSnapshot(agentDIDHash: string): Promise<ReputationSnapshot> {
    const s = await this.reputation.getLatestSnapshot(agentDIDHash);
    return this._parseSnapshot(s);
  }

  /** Get a historical reputation snapshot by epoch. */
  async getSnapshotHistory(agentDIDHash: string, epoch: number): Promise<ReputationSnapshot> {
    const s = await this.reputation.getSnapshotHistory(agentDIDHash, epoch);
    return this._parseSnapshot(s);
  }

  /** Verify a review anchor exists on-chain. */
  async verifyReview(reviewHash: string): Promise<ReviewAnchor> {
    const r = await this.reputation.verifyReview(reviewHash);
    return {
      reviewerDIDHash: r.reviewerDIDHash,
      subjectDIDHash: r.subjectDIDHash,
      txHash: r.txHash,
      timestamp: Number(r.timestamp),
    };
  }

  /** Verify a Merkle proof for detailed reputation data. */
  async verifyMerkleProof(
    agentDIDHash: string,
    epoch: number,
    leaf: string,
    proof: string[],
  ): Promise<boolean> {
    return this.reputation.verifyMerkleProof(agentDIDHash, epoch, leaf, proof);
  }

  /** Get trust score for an EVM address (requires linkAddressToDID). */
  async getTrustScore(account: string): Promise<number> {
    return Number(await this.reputation.getTrustScore(account));
  }

  /** Get current epoch number. */
  async getCurrentEpoch(): Promise<number> {
    return Number(await this.reputation.getCurrentEpoch());
  }

  /** Get total number of agents with reputation data. */
  async totalAgents(): Promise<number> {
    return Number(await this.reputation.totalAgents());
  }

  // ── Private helpers ──────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _parseSnapshot(s: any): ReputationSnapshot {
    return {
      overallScore: Number(s.overallScore),
      dimensionScores: [
        Number(s.dimensionScores[0]),
        Number(s.dimensionScores[1]),
        Number(s.dimensionScores[2]),
        Number(s.dimensionScores[3]),
        Number(s.dimensionScores[4]),
      ],
      merkleRoot: s.merkleRoot,
      epoch: Number(s.epoch),
      timestamp: Number(s.timestamp),
    };
  }
}
