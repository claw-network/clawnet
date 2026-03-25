import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

/**
 * ClawNet 写操作的 scope 类型
 */
export type OperationScope =
  | 'transfer'
  | 'escrow'
  | 'market'
  | 'contract'
  | 'reputation'
  | 'identity';

const ALL_SCOPES: OperationScope[] = [
  'transfer', 'escrow', 'market', 'contract', 'reputation', 'identity',
];

interface Session {
  tokenHash: Buffer;          // 存储 hash 而非明文 token
  did: string;
  passphrase: string;         // 仅内存中持有
  scope: OperationScope[];
  expiresAt: number;          // Unix ms
  createdAt: number;
  operationsUsed: number;
  maxOperations?: number;
}

export interface UnlockParams {
  passphrase: string;
  did: string;
  ttlSeconds?: number;
  scope?: OperationScope[];
  maxOperations?: number;
  validatePassphrase: (did: string, passphrase: string) => Promise<boolean>;
}

export interface UnlockResult {
  sessionToken: string;
  expiresAt: Date;
  scope: OperationScope[];
}

export interface ResolveResult {
  did: string;
  passphrase: string;
}

export interface SessionInfo {
  active: boolean;
  expiresAt: Date;
  scope: OperationScope[];
  operationsUsed: number;
  createdAt: Date;
}

export class SessionManager {
  private sessions = new Map<string, Session>();  // key = tokenHash hex
  private cleanupTimer: ReturnType<typeof setInterval>;

  // 安全常量
  private static readonly TOKEN_BYTES = 32;
  private static readonly TOKEN_PREFIX = 'tses_';
  private static readonly DEFAULT_TTL_MS = 30 * 60 * 1000;       // 30 分钟
  private static readonly MAX_TTL_MS = 24 * 60 * 60 * 1000;      // 24 小时上限
  private static readonly MAX_CONCURRENT_SESSIONS = 5;
  private static readonly CLEANUP_INTERVAL_MS = 60 * 1000;

  constructor() {
    this.cleanupTimer = setInterval(
      () => this.evictExpired(),
      SessionManager.CLEANUP_INTERVAL_MS,
    );
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * 解锁：验证 passphrase 后创建 session
   */
  async unlock(params: UnlockParams): Promise<UnlockResult> {
    this.evictExpired();
    if (this.sessions.size >= SessionManager.MAX_CONCURRENT_SESSIONS) {
      // Evict the oldest session to make room instead of hard-blocking
      this.evictOldest();
    }

    // 验证 passphrase
    const valid = await params.validatePassphrase(params.did, params.passphrase);
    if (!valid) {
      throw new Error('Invalid passphrase');
    }

    // 生成 token
    const tokenRaw = randomBytes(SessionManager.TOKEN_BYTES);
    const token = SessionManager.TOKEN_PREFIX + tokenRaw.toString('base64url');
    const tokenHash = this.hashToken(token);

    // 计算 TTL
    const ttlMs = Math.min(
      (params.ttlSeconds ?? 1800) * 1000,
      SessionManager.MAX_TTL_MS,
    );
    const scope = params.scope?.length ? params.scope : ALL_SCOPES;

    const session: Session = {
      tokenHash,
      did: params.did,
      passphrase: params.passphrase,
      scope,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
      operationsUsed: 0,
      maxOperations: params.maxOperations,
    };

    this.sessions.set(tokenHash.toString('hex'), session);

    return {
      sessionToken: token,
      expiresAt: new Date(session.expiresAt),
      scope,
    };
  }

  /**
   * 从 session token 解析出 passphrase
   */
  resolvePassphrase(token: string, requiredScope: OperationScope): ResolveResult {
    const tokenHash = this.hashToken(token);
    const key = tokenHash.toString('hex');
    const session = this.sessions.get(key);

    if (!session) {
      throw new Error('Invalid or expired session token');
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(key);
      throw new Error('Session expired. Please unlock again.');
    }

    if (!session.scope.includes(requiredScope)) {
      throw new Error(
        `Session does not have '${requiredScope}' scope. Authorized: ${session.scope.join(', ')}`,
      );
    }

    if (session.maxOperations && session.operationsUsed >= session.maxOperations) {
      this.sessions.delete(key);
      throw new Error('Session operation limit reached. Please unlock a new session.');
    }

    session.operationsUsed++;
    return { did: session.did, passphrase: session.passphrase };
  }

  /**
   * 查询 session 状态
   */
  getSessionInfo(token: string): SessionInfo | null {
    const tokenHash = this.hashToken(token);
    const session = this.sessions.get(tokenHash.toString('hex'));
    if (!session) return null;

    return {
      active: Date.now() <= session.expiresAt,
      expiresAt: new Date(session.expiresAt),
      scope: session.scope,
      operationsUsed: session.operationsUsed,
      createdAt: new Date(session.createdAt),
    };
  }

  /**
   * 锁定 / 销毁 session
   */
  lock(token: string): void {
    const tokenHash = this.hashToken(token);
    const key = tokenHash.toString('hex');
    const session = this.sessions.get(key);
    if (session) {
      // 安全擦除 passphrase
      session.passphrase = '\0'.repeat(session.passphrase.length);
      this.sessions.delete(key);
    }
  }

  /**
   * 销毁所有 session（Node 停止时调用）
   */
  lockAll(): void {
    for (const [, session] of this.sessions) {
      session.passphrase = '\0'.repeat(session.passphrase.length);
    }
    this.sessions.clear();
    clearInterval(this.cleanupTimer);
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now > session.expiresAt) {
        session.passphrase = '\0'.repeat(session.passphrase.length);
        this.sessions.delete(key);
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestCreatedAt = Infinity;
    for (const [key, session] of this.sessions) {
      if (session.createdAt < oldestCreatedAt) {
        oldestCreatedAt = session.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const session = this.sessions.get(oldestKey)!;
      session.passphrase = '\0'.repeat(session.passphrase.length);
      this.sessions.delete(oldestKey);
    }
  }

  private hashToken(token: string): Buffer {
    return createHmac('sha256', 'telagent-session')
      .update(token)
      .digest();
  }
}
