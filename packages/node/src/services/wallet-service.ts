/**
 * WalletService — on-chain wallet operations for ClawToken and ClawEscrow.
 *
 * This service is the **single point of truth** for all wallet write/read
 * operations.  API route handlers delegate to it; it calls the smart
 * contracts via ContractProvider and reads indexed history from
 * IndexerQuery.
 *
 * Design decisions:
 * - Token amounts are **integers** (ClawToken has 0 decimals).
 * - Escrow ID is an opaque string at the REST layer; it's hashed to
 *   `bytes32` (keccak256) before hitting the chain.
 * - DID-to-address resolution goes through ClawIdentity.getController()
 *   when an on-chain lookup is desired, or through the local
 *   `addressFromDid` helper for off-chain derivation.
 * - All write methods return a receipt-like object that matches the
 *   existing REST response shape (txHash, amount, status, timestamp).
 */

import { keccak256, toUtf8Bytes } from 'ethers';

import { createLogger } from '../logger.js';
import type { ContractProvider } from '../services/contract-provider.js';
import type { IndexerQuery, EscrowFilter } from '../indexer/query.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Logger = ReturnType<typeof createLogger>;

// ── Response shapes (match existing REST API) ─────────────────────────────

export interface TransferResult {
  txHash: string;
  from: string;
  to: string;
  amount: string;
  fee?: string;
  status: string;
  timestamp: number;
}

export interface BalanceResult {
  balance: string;
  available: string;
  pending: string;
  locked: string;
}

export interface EscrowView {
  id: string;
  depositor: string;
  beneficiary: string;
  arbiter: string;
  amount: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  expired: boolean;
}

export interface EscrowActionResult {
  txHash: string;
  amount: string;
  status: string;
  timestamp: number;
}

export interface EscrowCreateResult {
  id: string;
  amount: string;
  released: string;
  remaining: string;
  status: string;
  createdAt: number;
  expiresAt?: number;
  expired: boolean;
}

export interface TransactionHistoryResult {
  transactions: TransferRow[];
  total: number;
  hasMore: boolean;
  pagination: { limit: number; offset: number };
}

interface TransferRow {
  txHash: string;
  from: string;
  to: string;
  amount: string;
  type: string;
  status: string;
  timestamp: number;
}

// ── Escrow status mapping ─────────────────────────────────────────────────

const ESCROW_STATUS_MAP: Record<number, string> = {
  0: 'active',
  1: 'released',
  2: 'refunded',
  3: 'expired',
  4: 'disputed',
};

// ---------------------------------------------------------------------------
// WalletService
// ---------------------------------------------------------------------------

export class WalletService {
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
   * Fetch on-chain Token balance for a given EVM address.
   *
   * ClawToken has 0 decimals, so balanceOf returns an integer directly.
   */
  async getBalance(address: string): Promise<BalanceResult> {
    const raw: bigint = await this.contracts.token.balanceOf(address);
    const balance = raw;

    // Locked / pending breakdown requires indexer data (escrow balances).
    // For now, the "locked" amount is the sum of all active escrows where
    // the address is the depositor.
    let locked = 0n;
    if (this.indexer) {
      const escrows = this.indexer.getEscrows({
        address,
        status: 0, // Active
        limit: 200,
      });
      for (const e of escrows.items) {
        locked += BigInt(e.amount);
      }
    }

    return {
      balance: String(balance),
      available: String(balance - locked),
      pending: '0',
      locked: String(locked),
    };
  }

  /**
   * Return the EVM transaction count (nonce) for a given address.
   *
   * This is the standard Ethereum nonce — the number of transactions
   * sent from the address. Useful for clients that need to construct
   * or sequence their own transactions.
   */
  async getNonce(address: string): Promise<{ nonce: number; address: string }> {
    const count = await this.contracts.provider.getTransactionCount(address, 'latest');
    return { nonce: count, address };
  }

  /**
   * Resolve a DID `did:claw:…` to an EVM address via the on-chain
   * ClawIdentity registry.
   *
   * @returns The controller address, or `null` if the DID is not registered.
   */
  async resolveDidToAddress(did: string): Promise<string | null> {
    const didHash = keccak256(toUtf8Bytes(did));
    try {
      const controller: string = await this.contracts.identity.getController(didHash);
      // Zero-address means not registered.
      if (controller === '0x0000000000000000000000000000000000000000') {
        return null;
      }
      return controller;
    } catch {
      return null;
    }
  }

  // ========================================================================
  // WRITE operations — Token transfers
  // ========================================================================

  /**
   * Execute an on-chain Token transfer.
   *
   * Uses the burn+mint pattern: tokens are burned from the sender's
   * per-DID address and minted to the receiver's address.  This avoids
   * the need for per-DID private keys or ETH gas funding — the node
   * signer holds MINTER_ROLE and BURNER_ROLE.
   *
   * For the special case where `from` is `'faucet'` or the node signer,
   * a direct `transfer()` is used instead (since the signer actually
   * holds those tokens).
   */
  async transfer(
    from: string,
    to: string,
    amount: bigint | number,
    memo?: string,
  ): Promise<TransferResult> {
    this.log.info(
      'Wallet transfer: %s → %s, %s Token(s)%s',
      from,
      to,
      String(amount),
      memo ? ` (${memo})` : '',
    );

    const isSigner = from === 'faucet' ||
      from.toLowerCase() === this.contracts.signerAddress.toLowerCase();

    let receipt;
    if (isSigner) {
      // Direct transfer from node signer's own balance
      const tx = await this.contracts.token.transfer(to, amount);
      receipt = await tx.wait();
    } else {
      // Burn from sender and mint to receiver (per-DID isolation)
      const burnTx = await this.contracts.token.burn(from, amount);
      await burnTx.wait();
      const mintTx = await this.contracts.token.mint(to, amount);
      receipt = await mintTx.wait();
    }

    const timestamp = Date.now();

    return {
      txHash: receipt.hash,
      from,
      to,
      amount: String(amount),
      status: receipt.status === 1 ? 'confirmed' : 'failed',
      timestamp,
    };
  }

  /**
   * Mint new Tokens to a target address.
   *
   * The node's signer **must** hold MINTER_ROLE on ClawToken for this to
   * succeed.  Typically used by the dev faucet so it can create fresh Tokens
   * without requiring a pre-funded balance.
   *
   * @param to   Target EVM address.
   * @param amount Number of Tokens to mint (integer, 0 decimals).
   * @param memo Optional human-readable memo (logged, not stored on-chain).
   */
  async mint(
    to: string,
    amount: bigint | number,
    memo?: string,
  ): Promise<TransferResult> {
    this.log.info(
      'Wallet mint: → %s, %s Token(s)%s',
      to,
      String(amount),
      memo ? ` (${memo})` : '',
    );

    const tx = await this.contracts.token.mint(to, amount);
    const receipt = await tx.wait();
    const timestamp = Date.now();

    return {
      txHash: receipt.hash,
      from: '0x0000000000000000000000000000000000000000',
      to,
      amount: String(amount),
      status: receipt.status === 1 ? 'confirmed' : 'failed',
      timestamp,
    };
  }

  // ========================================================================
  // WRITE operations — Escrow lifecycle
  // ========================================================================

  /**
   * Create a new escrow.
   *
   * Steps:
   * 1. `token.approve(escrowAddress, amount)` — allow the escrow contract
   *    to pull Tokens from the signer.
   * 2. `escrow.createEscrow(id, beneficiary, arbiter, amount, expiresAt)`
   */
  async createEscrow(params: {
    escrowId: string;
    beneficiary: string;
    arbiter?: string;
    amount: bigint | number;
    expiresAt?: number;
  }): Promise<EscrowCreateResult> {
    const {
      escrowId,
      beneficiary,
      arbiter = this.contracts.signerAddress,
      amount,
      expiresAt = 0,
    } = params;
    const id32 = keccak256(toUtf8Bytes(escrowId));

    this.log.info(
      'Creating escrow %s: %s Token(s), beneficiary=%s',
      escrowId,
      String(amount),
      beneficiary,
    );

    // Approve escrow contract to spend Tokens on behalf of the signer.
    const escrowAddr = await this.contracts.escrow.getAddress();
    const approveTx = await this.contracts.token.approve(escrowAddr, amount);
    await approveTx.wait();

    // Create the escrow on-chain.
    const tx = await this.contracts.escrow.createEscrow(
      id32,
      beneficiary,
      arbiter,
      amount,
      expiresAt,
    );
    const receipt = await tx.wait();
    const ts = Date.now();

    if (receipt.status !== 1) {
      throw new Error(`createEscrow tx failed: ${receipt.hash}`);
    }

    return {
      id: escrowId,
      amount: String(amount),
      released: '0',
      remaining: String(amount),
      status: 'active',
      createdAt: ts,
      expiresAt: expiresAt || undefined,
      expired: false,
    };
  }

  /**
   * Fund (top up) an existing escrow.
   */
  async fundEscrow(escrowId: string, amount: bigint | number): Promise<EscrowActionResult> {
    const id32 = keccak256(toUtf8Bytes(escrowId));

    this.log.info('Funding escrow %s: %s Token(s)', escrowId, String(amount));

    // Approve and fund.
    const escrowAddr = await this.contracts.escrow.getAddress();
    const appTx = await this.contracts.token.approve(escrowAddr, amount);
    await appTx.wait();

    const tx = await this.contracts.escrow.fund(id32, amount);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      amount: String(amount),
      status: receipt.status === 1 ? 'funded' : 'failed',
      timestamp: Date.now(),
    };
  }

  /**
   * Release escrow funds to the beneficiary.
   */
  async releaseEscrow(escrowId: string): Promise<EscrowActionResult> {
    const id32 = keccak256(toUtf8Bytes(escrowId));

    this.log.info('Releasing escrow %s', escrowId);

    const tx = await this.contracts.escrow.release(id32);
    const receipt = await tx.wait();

    // Read on-chain amount for the response.
    const amount = await this.getEscrowAmount(id32);

    return {
      txHash: receipt.hash,
      amount,
      status: receipt.status === 1 ? 'released' : 'failed',
      timestamp: Date.now(),
    };
  }

  /**
   * Refund escrow funds to the depositor.
   */
  async refundEscrow(escrowId: string): Promise<EscrowActionResult> {
    const id32 = keccak256(toUtf8Bytes(escrowId));

    this.log.info('Refunding escrow %s', escrowId);

    const tx = await this.contracts.escrow.refund(id32);
    const receipt = await tx.wait();

    const amount = await this.getEscrowAmount(id32);

    return {
      txHash: receipt.hash,
      amount,
      status: receipt.status === 1 ? 'refunded' : 'failed',
      timestamp: Date.now(),
    };
  }

  /**
   * Expire an escrow that has passed its `expiresAt` timestamp.
   */
  async expireEscrow(escrowId: string): Promise<EscrowActionResult> {
    const id32 = keccak256(toUtf8Bytes(escrowId));

    this.log.info('Expiring escrow %s', escrowId);

    const tx = await this.contracts.escrow.expire(id32);
    const receipt = await tx.wait();

    const amount = await this.getEscrowAmount(id32);

    return {
      txHash: receipt.hash,
      amount,
      status: receipt.status === 1 ? 'expired' : 'failed',
      timestamp: Date.now(),
    };
  }

  /**
   * Open a dispute on an active escrow.
   */
  async disputeEscrow(escrowId: string): Promise<EscrowActionResult> {
    const id32 = keccak256(toUtf8Bytes(escrowId));

    this.log.info('Disputing escrow %s', escrowId);

    const tx = await this.contracts.escrow.dispute(id32);
    const receipt = await tx.wait();

    const amount = await this.getEscrowAmount(id32);

    return {
      txHash: receipt.hash,
      amount,
      status: receipt.status === 1 ? 'disputed' : 'failed',
      timestamp: Date.now(),
    };
  }

  /**
   * Resolve a disputed escrow (arbiter only).
   *
   * @param releaseToBeneficiary `true` → release to beneficiary; `false` → refund to depositor.
   */
  async resolveEscrow(
    escrowId: string,
    releaseToBeneficiary: boolean,
  ): Promise<EscrowActionResult> {
    const id32 = keccak256(toUtf8Bytes(escrowId));

    this.log.info(
      'Resolving escrow %s → %s',
      escrowId,
      releaseToBeneficiary ? 'beneficiary' : 'depositor',
    );

    const tx = await this.contracts.escrow.resolve(id32, releaseToBeneficiary);
    const receipt = await tx.wait();

    const amount = await this.getEscrowAmount(id32);

    return {
      txHash: receipt.hash,
      amount,
      status: receipt.status === 1
        ? releaseToBeneficiary ? 'released' : 'refunded'
        : 'failed',
      timestamp: Date.now(),
    };
  }

  // ========================================================================
  // READ operations — Escrow
  // ========================================================================

  /**
   * Fetch on-chain escrow state.
   */
  async getEscrow(escrowId: string): Promise<EscrowView | null> {
    // If the input already looks like a bytes32 hex (from indexer list),
    // use it directly; otherwise hash the human-readable ID.
    const id32 = escrowId.startsWith('0x') && escrowId.length === 66
      ? escrowId
      : keccak256(toUtf8Bytes(escrowId));

    try {
      const [depositor, beneficiary, arbiter, amount, createdAt, expiresAt, status] =
        await this.contracts.escrow.getEscrow(id32);

      // Zero depositor means escrow doesn't exist.
      if (depositor === '0x0000000000000000000000000000000000000000') {
        return null;
      }

      const now = Math.floor(Date.now() / 1000);

      return {
        id: escrowId,
        depositor: depositor as string,
        beneficiary: beneficiary as string,
        arbiter: arbiter as string,
        amount: String(amount as bigint),
        status: ESCROW_STATUS_MAP[Number(status)] ?? 'unknown',
        createdAt: Number(createdAt as bigint),
        expiresAt: Number(expiresAt as bigint),
        expired: Number(expiresAt as bigint) > 0 && now > Number(expiresAt as bigint),
      };
    } catch {
      return null;
    }
  }

  // ========================================================================
  // READ operations — History (indexer)
  // ========================================================================

  /**
   * Query transfer history from the indexer.
   */
  getHistory(
    address: string,
    opts: { limit?: number; offset?: number; type?: string } = {},
  ): TransactionHistoryResult {
    if (!this.indexer) {
      return { transactions: [], total: 0, hasMore: false, pagination: { limit: 20, offset: 0 } };
    }

    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const result = this.indexer.getTransfers({ address, limit, offset });

    const transactions: TransferRow[] = result.items.map((row) => ({
      txHash: row.txHash,
      from: row.fromAddr,
      to: row.toAddr,
      amount: String(row.amount),
      type: row.fromAddr.toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
      status: 'confirmed',
      timestamp: row.timestamp,
    }));

    return {
      transactions,
      total: result.total,
      hasMore: offset + limit < result.total,
      pagination: { limit, offset },
    };
  }

  /**
   * Query escrow records from the indexer.
   */
  getEscrows(filter: EscrowFilter = {}) {
    if (!this.indexer) {
      return { items: [], total: 0, limit: 50, offset: 0 };
    }
    return this.indexer.getEscrows(filter);
  }

  // ========================================================================
  // Internal helpers
  // ========================================================================

  /**
   * Read the stored amount for an escrow (post-tx).
   * Returns 0 if the escrow can't be read.
   */
  private async getEscrowAmount(id32: string): Promise<string> {
    try {
      const [, , , amount] = await this.contracts.escrow.getEscrow(id32);
      return String(amount as bigint);
    } catch {
      return '0';
    }
  }
}
