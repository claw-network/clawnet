/**
 * ClawNet Nonce 管理器
 *
 * ClawNet 所有写操作需要单调递增的 nonce。
 * 此模块在本地维护计数器，支持：
 * - next(did): 获取下一个 nonce（串行化）
 * - nextBatch(did, count): 批量预分配（如 accept-bid 消耗 5 个）
 * - rollback(did, nonce): 失败回滚
 * - sync(did): 从 ClawNet 同步当前已提交 nonce
 */

export class NonceManager {
  private counters = new Map<string, number>();
  private locks = new Map<string, Promise<void>>();

  constructor(
    private readonly eventStore?: any,    // 嵌入式模式: EventStore 实例
    private readonly clawnetClient?: any, // 外部模式: ClawNetClient 实例
  ) {}

  /**
   * 获取下一个可用 nonce（串行化同一 DID 的请求）
   */
  async next(did: string): Promise<number> {
    await this.acquireLock(did);
    try {
      if (!this.counters.has(did)) {
        await this.sync(did);
      }
      const current = this.counters.get(did) ?? 0;
      const next = current + 1;
      this.counters.set(did, next);
      return next;
    } finally {
      this.releaseLock(did);
    }
  }

  /**
   * 批量预分配 nonce
   * 返回起始 nonce，调用者使用 [start, start+1, ..., start+count-1]
   *
   * 已知批量操作 nonce 消耗:
   * - transfer: 1
   * - createEscrow: 1
   * - releaseEscrow: 1
   * - publishTask: 1
   * - bid: 1
   * - acceptBid: 5 (accept + order + escrow + fund + update)
   * - completeTask: 2-4 (deliver + review + release...)
   */
  async nextBatch(did: string, count: number): Promise<number> {
    await this.acquireLock(did);
    try {
      if (!this.counters.has(did)) {
        await this.sync(did);
      }
      const current = this.counters.get(did) ?? 0;
      const start = current + 1;
      this.counters.set(did, current + count);
      return start;
    } finally {
      this.releaseLock(did);
    }
  }

  /**
   * 写操作失败后回滚 nonce（避免空洞）
   */
  rollback(did: string, failedNonce: number): void {
    const current = this.counters.get(did);
    if (current !== undefined && current >= failedNonce) {
      this.counters.set(did, failedNonce - 1);
    }
  }

  /**
   * 从 ClawNet 同步当前已提交的 nonce
   */
  async sync(did: string): Promise<void> {
    let committedNonce = 0;

    if (this.eventStore) {
      // 嵌入式模式：直读 EventStore（最快、最准确）
      committedNonce = await this.eventStore.getCommittedNonce(did);
    } else if (this.clawnetClient) {
      // 外部模式：通过 wallet.getNonce() API
      const result = await this.clawnetClient.wallet.getNonce({ did });
      committedNonce = result.nonce;
    }

    this.counters.set(did, committedNonce);
  }

  /**
   * 处理 nonce 冲突：重新同步
   */
  async handleNonceConflict(did: string): Promise<void> {
    await this.sync(did);
  }

  // ── 串行化锁 ──────────────────────────────────────────

  private async acquireLock(did: string): Promise<void> {
    while (this.locks.has(did)) {
      await this.locks.get(did);
    }
    let resolve!: () => void;
    this.locks.set(did, new Promise<void>((r) => { resolve = r; }));
    (this.locks.get(did) as any).__resolve = resolve;
  }

  private releaseLock(did: string): void {
    const lock = this.locks.get(did) as any;
    this.locks.delete(did);
    if (lock?.__resolve) lock.__resolve();
  }
}
