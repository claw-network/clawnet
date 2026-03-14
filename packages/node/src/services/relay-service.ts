/**
 * Relay service — circuit-relay-v2 statistics, per-peer rate limiting,
 * access control (blacklist / whitelist), self-diagnosis, relay
 * discovery integration, period proof generation, and co-sign collection.
 *
 * Phase 1: F3, F6, F7, F8, F9.
 * Phase 2: F2 (discovery support), F5 (scorer integration), F12 (drain).
 * Phase 3: F4 (period proof), F10 (co-sign collection), F11 (reward formula).
 */

import type { RelayConfig, P2PNode, RelayConfirmRequest } from '@claw-network/core';
import { DEFAULT_RELAY_CONFIG } from '@claw-network/core';
import type { RelayScore } from '@claw-network/core';

// ── Public types ────────────────────────────────────────────────

export interface RelayStats {
  relayEnabled: boolean;
  totalCircuitsServed: number;
  activeCircuits: number;
  totalBytesRelayed: number;
  totalMessagesRelayed: number;
  /** Attachment relay bytes — tracked separately for reward weighting (F8). */
  totalAttachmentBytesRelayed: number;
  uptimeSeconds: number;
  periodStats: RelayPeriodStats;
}

export interface RelayPeriodStats {
  periodStart: number;
  periodEnd: number;
  bytesRelayed: number;
  attachmentBytesRelayed: number;
  circuitsServed: number;
  uniquePeersServed: number;
}

export interface RelayHealthInfo {
  relayEnabled: boolean;
  natStatus: 'public' | 'private' | 'unknown';
  publicAddresses: string[];
  isReachable: boolean;
  load: {
    activeCircuits: number;
    maxCircuits: number;
    utilizationPercent: number;
  };
  warnings: string[];
}

export interface RelayAccessInfo {
  mode: 'open' | 'whitelist' | 'blacklist';
  list: string[];
}

/** Result of relay discovery + scoring (F2 + F5). */
export interface RelayDiscoveryResult {
  /** Relay candidates with scores, sorted best-first. */
  relays: RelayScore[];
  /** Where the candidates came from. */
  source: 'dht' | 'bootstrap' | 'cache';
  discoveredAt: number;
}

/** A single peer's co-signed confirmation of relay traffic (F10). */
export interface PeerConfirmation {
  peerDid: string;
  bytesConfirmed: number;
  circuitsConfirmed: number;
  /** base58-encoded Ed25519 signature. */
  signature: string;
}

/** Period contribution proof with co-signatures (F4). */
export interface RelayPeriodProof {
  relayDid: string;
  periodId: number;
  periodStart: number;
  periodEnd: number;
  bytesRelayed: number;
  attachmentBytesRelayed: number;
  circuitsServed: number;
  uniquePeersServed: number;
  peerConfirmations: PeerConfirmation[];
  /** base58-encoded Ed25519 signature from the relay node itself. */
  relaySignature: string;
}

// ── Internal per-peer state ─────────────────────────────────────

interface PeerCircuitState {
  activeCircuits: number;
  recentReservations: number[];
  bannedUntil: number;
}
/** Tracks per-peer bytes relayed during the current period (F10). */
interface PeerPeriodTraffic {
  bytesRelayed: number;
  attachmentBytesRelayed: number;
  circuitsServed: number;
}
// ── Service Implementation ──────────────────────────────────────

const PERIOD_DURATION_SEC = 3600; // 1-hour periods

export class RelayService {
  private config: RelayConfig;
  private startedAt = 0;
  private rotateTimer?: ReturnType<typeof setInterval>;

  // ── Cumulative counters ─────────────────────────────────────
  private _totalCircuitsServed = 0;
  private _activeCircuits = 0;
  private _totalBytesRelayed = 0;
  private _totalMessagesRelayed = 0;
  private _totalAttachmentBytesRelayed = 0;

  // ── Current period counters ─────────────────────────────────
  private _periodStart = 0;
  private _periodBytesRelayed = 0;
  private _periodAttachmentBytesRelayed = 0;
  private _periodCircuitsServed = 0;
  private _periodUniquePeers = new Set<string>();

  // ── Per-peer tracking (F6) ──────────────────────────────────
  private peerState = new Map<string, PeerCircuitState>();

  // ── Access control (F7) ─────────────────────────────────────
  private _accessMode: 'open' | 'whitelist' | 'blacklist';
  private _accessList: string[];

  // ── NAT status cache (F9) ──────────────────────────────────
  private _natStatus: 'public' | 'private' | 'unknown' = 'unknown';
  private _publicAddresses: string[] = [];

  // ── Draining mode (F12) ───────────────────────────────────
  private _draining = false;
  // ── Per-peer traffic tracking (F10) ───────────────────
  private _peerPeriodTraffic = new Map<string, PeerPeriodTraffic>();

  // ── Period proof state (F4) ────────────────────────────
  private _periodId = 0;
  private _lastProof: RelayPeriodProof | null = null;
  constructor(config?: Partial<RelayConfig>) {
    this.config = { ...DEFAULT_RELAY_CONFIG, ...config };
    this._accessMode = this.config.accessMode;
    this._accessList = [...this.config.accessList];
  }

  start(): void {
    this.startedAt = Date.now();
    this._periodStart = Math.floor(this.startedAt / 1000);
    this.rotateTimer = setInterval(() => this.rotatePeriod(), PERIOD_DURATION_SEC * 1000);
  }

  stop(): void {
    if (this.rotateTimer) {
      clearInterval(this.rotateTimer);
      this.rotateTimer = undefined;
    }
  }

  // ── F3: Statistics ────────────────────────────────────────────

  getStats(): RelayStats {
    const now = Math.floor(Date.now() / 1000);
    return {
      relayEnabled: this.config.enabled,
      totalCircuitsServed: this._totalCircuitsServed,
      activeCircuits: this._activeCircuits,
      totalBytesRelayed: this._totalBytesRelayed,
      totalMessagesRelayed: this._totalMessagesRelayed,
      totalAttachmentBytesRelayed: this._totalAttachmentBytesRelayed,
      uptimeSeconds: this.startedAt > 0 ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      periodStats: {
        periodStart: this._periodStart,
        periodEnd: now,
        bytesRelayed: this._periodBytesRelayed,
        attachmentBytesRelayed: this._periodAttachmentBytesRelayed,
        circuitsServed: this._periodCircuitsServed,
        uniquePeersServed: this._periodUniquePeers.size,
      },
    };
  }

  /** Reset period counters and start a new period. */
  rotatePeriod(): RelayPeriodStats {
    const now = Math.floor(Date.now() / 1000);
    const snapshot: RelayPeriodStats = {
      periodStart: this._periodStart,
      periodEnd: now,
      bytesRelayed: this._periodBytesRelayed,
      attachmentBytesRelayed: this._periodAttachmentBytesRelayed,
      circuitsServed: this._periodCircuitsServed,
      uniquePeersServed: this._periodUniquePeers.size,
    };
    this._periodStart = now;
    this._periodBytesRelayed = 0;
    this._periodAttachmentBytesRelayed = 0;
    this._periodCircuitsServed = 0;
    this._periodUniquePeers.clear();
    return snapshot;
  }

  /**
   * Record a circuit being opened.
   * Returns false if the circuit should be rejected (disabled, draining, rate-limit, or access denied).
   */
  onCircuitOpen(peerId: string): boolean {
    if (!this.config.enabled) {
      return false;
    }
    if (this._draining) {
      return false;
    }
    if (!this.checkAccess(peerId)) {
      return false;
    }
    if (!this.checkPeerRateLimit(peerId)) {
      return false;
    }

    this._totalCircuitsServed++;
    this._activeCircuits++;
    this._periodCircuitsServed++;
    this._periodUniquePeers.add(peerId);

    // Update per-peer state
    const state = this.getOrCreatePeerState(peerId);
    state.activeCircuits++;
    const now = Date.now();
    state.recentReservations.push(now);

    // Track per-peer circuits for co-sign (F10)
    const traffic = this.getOrCreatePeerTraffic(peerId);
    traffic.circuitsServed++;

    return true;
  }

  /** Record a circuit being closed. */
  onCircuitClose(peerId: string): void {
    this._activeCircuits = Math.max(0, this._activeCircuits - 1);
    const state = this.peerState.get(peerId);
    if (state) {
      state.activeCircuits = Math.max(0, state.activeCircuits - 1);
    }
  }

  /**
   * Record bytes relayed through a circuit.
   * @param isAttachment Whether this is attachment protocol traffic (F8).
   * @param peerId The peer this traffic belongs to (for F10 co-sign tracking).
   */
  recordBytesRelayed(bytes: number, isAttachment = false, peerId?: string): void {
    this._totalBytesRelayed += bytes;
    this._periodBytesRelayed += bytes;
    if (isAttachment) {
      this._totalAttachmentBytesRelayed += bytes;
      this._periodAttachmentBytesRelayed += bytes;
    }
    // Track per-peer traffic for co-sign (F10)
    if (peerId) {
      const traffic = this.getOrCreatePeerTraffic(peerId);
      traffic.bytesRelayed += bytes;
      if (isAttachment) {
        traffic.attachmentBytesRelayed += bytes;
      }
    }
  }

  /** Record a message relayed. */
  recordMessageRelayed(): void {
    this._totalMessagesRelayed++;
  }

  // ── F6: Per-peer rate limiting ────────────────────────────────

  private checkPeerRateLimit(peerId: string): boolean {
    const state = this.getOrCreatePeerState(peerId);
    const now = Date.now();

    // Check temporary ban
    if (state.bannedUntil > now) {
      return false;
    }

    // Check per-peer concurrent circuit limit
    if (state.activeCircuits >= this.config.maxCircuitsPerPeer) {
      return false;
    }

    // Check rate limit (reservations per minute)
    const oneMinuteAgo = now - 60_000;
    state.recentReservations = state.recentReservations.filter((t) => t > oneMinuteAgo);
    if (state.recentReservations.length >= this.config.maxReservationsPerPeerPerMin) {
      // Check for abuse: 3x over limit → temporary ban (10 minutes)
      if (state.recentReservations.length >= this.config.maxReservationsPerPeerPerMin * 3) {
        state.bannedUntil = now + 10 * 60_000;
      }
      return false;
    }

    // Check global circuit limit
    if (this._activeCircuits >= this.config.maxCircuits) {
      return false;
    }

    return true;
  }

  isPeerBanned(peerId: string): boolean {
    const state = this.peerState.get(peerId);
    return !!state && state.bannedUntil > Date.now();
  }

  private getOrCreatePeerState(peerId: string): PeerCircuitState {
    let state = this.peerState.get(peerId);
    if (!state) {
      state = { activeCircuits: 0, recentReservations: [], bannedUntil: 0 };
      this.peerState.set(peerId, state);
    }
    return state;
  }

  // ── F7: Access control ────────────────────────────────────────

  getAccessInfo(): RelayAccessInfo {
    return { mode: this._accessMode, list: [...this._accessList] };
  }

  setAccessMode(mode: 'open' | 'whitelist' | 'blacklist'): void {
    this._accessMode = mode;
  }

  addToAccessList(did: string): boolean {
    if (this._accessList.includes(did)) return false;
    this._accessList.push(did);
    return true;
  }

  removeFromAccessList(did: string): boolean {
    const idx = this._accessList.indexOf(did);
    if (idx === -1) return false;
    this._accessList.splice(idx, 1);
    return true;
  }

  private checkAccess(peerId: string): boolean {
    if (this._accessMode === 'open') return true;
    // In a real implementation, peerId would be resolved to a DID.
    // For now, we match directly against both peerId and DID entries.
    if (this._accessMode === 'whitelist') {
      return this._accessList.includes(peerId);
    }
    // blacklist
    return !this._accessList.includes(peerId);
  }

  // ── F9: Self-diagnosis ────────────────────────────────────────

  /** Update the cached NAT status (called by the node when autoNAT completes). */
  updateNatStatus(status: 'public' | 'private' | 'unknown', publicAddresses: string[]): void {
    this._natStatus = status;
    this._publicAddresses = publicAddresses;
  }

  getHealth(): RelayHealthInfo {
    const warnings: string[] = [];
    const utilizationPercent = this.config.maxCircuits > 0
      ? Math.round((this._activeCircuits / this.config.maxCircuits) * 100)
      : 0;

    if (this._natStatus === 'private') {
      warnings.push('Node is behind NAT — cannot serve as effective relay');
    }
    if (this._publicAddresses.length === 0) {
      warnings.push('No public addresses detected');
    }
    if (utilizationPercent > 90) {
      warnings.push('Relay load above 90% — consider increasing maxCircuits or limiting connections');
    }

    return {
      relayEnabled: this.config.enabled,
      natStatus: this._natStatus,
      publicAddresses: [...this._publicAddresses],
      isReachable: this._natStatus === 'public' && this._publicAddresses.length > 0,
      load: {
        activeCircuits: this._activeCircuits,
        maxCircuits: this.config.maxCircuits,
        utilizationPercent,
      },
      warnings,
    };
  }

  /** Periodically clean up stale per-peer entries. Call every ~5 minutes. */
  cleanupPeerState(): void {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60_000;
    for (const [peerId, state] of this.peerState) {
      // Remove peers with no active circuits and no recent reservations
      if (
        state.activeCircuits === 0 &&
        state.bannedUntil < now &&
        state.recentReservations.every((t) => t < fiveMinutesAgo)
      ) {
        this.peerState.delete(peerId);
      }
    }
  }

  // ── F2/F5/F12: Phase 2 — Discovery & Migration ─────────────

  /**
   * Get the list of peer IDs that currently have active circuits
   * through this relay node (used by F12 graceful drain).
   */
  getActivePeers(): string[] {
    const peers: string[] = [];
    for (const [peerId, state] of this.peerState) {
      if (state.activeCircuits > 0) {
        peers.push(peerId);
      }
    }
    return peers;
  }

  /** Whether the relay is in draining mode (F12). */
  get draining(): boolean {
    return this._draining;
  }

  /** Set draining mode — stops accepting new circuits. */
  setDraining(draining: boolean): void {
    this._draining = draining;
  }

  /** Whether the relay is currently enabled. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Enable or disable the relay at runtime (soft toggle — does not restart libp2p). */
  setEnabled(enabled: boolean): void {
    this.config = { ...this.config, enabled };
  }

  // ── F4/F10: Period Proof & Co-sign Collection ─────────────

  /** Get per-peer traffic for the current period (F10). */
  getPeerPeriodTraffic(): Map<string, PeerPeriodTraffic> {
    return new Map(this._peerPeriodTraffic);
  }

  /** Get per-peer traffic for a specific peer. */
  getPeerTraffic(peerId: string): PeerPeriodTraffic | undefined {
    return this._peerPeriodTraffic.get(peerId);
  }

  /**
   * Collect co-sign confirmations from served peers (F10).
   * Sends relay-confirm requests to each peer that has traffic in the current period.
   * @param p2pNode The P2P node used to send protocol messages.
   * @param relayDid The relay node's DID (for the confirmation request).
   * @returns Array of valid peer confirmations.
   */
  async collectConfirmations(
    p2pNode: P2PNode,
    relayDid: string,
  ): Promise<PeerConfirmation[]> {
    const confirmations: PeerConfirmation[] = [];
    const periodId = this._periodId;

    const requests: Promise<void>[] = [];
    for (const [peerId, traffic] of this._peerPeriodTraffic) {
      if (traffic.bytesRelayed === 0) continue;

      const request: RelayConfirmRequest = {
        relayDid,
        periodId,
        bytesRelayed: traffic.bytesRelayed,
        circuitsServed: traffic.circuitsServed,
      };

      requests.push(
        p2pNode.requestRelayConfirmation(peerId, request).then((resp) => {
          if (resp) {
            confirmations.push({
              peerDid: resp.peerDid,
              bytesConfirmed: resp.bytesConfirmed,
              circuitsConfirmed: resp.circuitsConfirmed,
              signature: resp.signature,
            });
          }
        }),
      );
    }

    await Promise.allSettled(requests);
    return confirmations;
  }

  /**
   * Generate a period contribution proof (F4).
   * Rotates the period, collects co-sign confirmations, and produces the proof.
   * @param p2pNode The P2P node for co-sign requests.
   * @param relayDid The relay node's DID.
   * @param signFn Function to sign the proof payload (returns base58 signature).
   * @returns The period proof (also cached as `lastProof`).
   */
  async generatePeriodProof(
    p2pNode: P2PNode,
    relayDid: string,
    signFn: (data: Uint8Array) => Promise<string>,
  ): Promise<RelayPeriodProof> {
    // Collect co-sign confirmations before rotating
    const confirmations = await this.collectConfirmations(p2pNode, relayDid);

    // Snapshot and rotate the period
    const snapshot = this.rotatePeriod();
    this._periodId++;

    // Build the proof data (without relay signature)
    const proofData = {
      relayDid,
      periodId: this._periodId - 1,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
      bytesRelayed: snapshot.bytesRelayed,
      attachmentBytesRelayed: snapshot.attachmentBytesRelayed,
      circuitsServed: snapshot.circuitsServed,
      uniquePeersServed: snapshot.uniquePeersServed,
      peerConfirmations: confirmations,
    };

    // Sign the canonical proof payload
    const signingPayload = new TextEncoder().encode(JSON.stringify(proofData));
    const relaySignature = await signFn(signingPayload);

    const proof: RelayPeriodProof = {
      ...proofData,
      relaySignature,
    };

    // Clear per-peer traffic for the new period
    this._peerPeriodTraffic.clear();

    this._lastProof = proof;
    return proof;
  }

  /** Get the most recently generated period proof (F4). */
  getLastProof(): RelayPeriodProof | null {
    return this._lastProof;
  }

  /** Current period ID (monotonically increasing). */
  get periodId(): number {
    return this._periodId;
  }

  private getOrCreatePeerTraffic(peerId: string): PeerPeriodTraffic {
    let t = this._peerPeriodTraffic.get(peerId);
    if (!t) {
      t = { bytesRelayed: 0, attachmentBytesRelayed: 0, circuitsServed: 0 };
      this._peerPeriodTraffic.set(peerId, t);
    }
    return t;
  }
}
