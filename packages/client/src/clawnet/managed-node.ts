import { readFileSync, createWriteStream, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { format } from 'node:util';
import type { WriteStream } from 'node:fs';
import { getGlobalLogger } from '../logger.js';

const logger = getGlobalLogger();

/**
 * 嵌入式 ClawNet Node 生命周期管理
 *
 * 当 TelAgent 自动启动 ClawNet Node 时，创建此实例。
 * TelAgent.stop() 时调用 managedNode.stop() 同步关闭。
 */
export class ManagedClawNetNode {
  private node: any = null;  // ClawNetNode 实例
  private readonly killClawnetdOnStart: boolean;
  private logStream: WriteStream | undefined;
  // Stash original console methods so we can restore them on stop
  private readonly origConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  constructor(
    private readonly dataDir: string,
    private readonly passphrase: string,
    private readonly apiPort: number = 9528,
    options?: { killClawnetdOnStart?: boolean },
  ) {
    this.killClawnetdOnStart = options?.killClawnetdOnStart ?? false;
  }

  /**
   * Open a write stream to <dataDir>/logs/clawnet.log and intercept all
   * console.* calls so that the embedded ClawNetNode's output (which goes
   * directly to console) is also persisted to file.
   */
  private startLogFile(): void {
    const logsDir = resolve(this.dataDir, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const logFilePath = resolve(logsDir, 'clawnet.log');
    this.logStream = createWriteStream(logFilePath, { flags: 'a' });

    const stream = this.logStream;
    const write = (level: string, args: unknown[]): void => {
      const ts = new Date().toISOString();
      const msg = format(...(args as Parameters<typeof format>));
      stream.write(`${ts} [${level}] ${msg}\n`);
    };

    console.log   = (...a) => { this.origConsole.log(...a);   write('INFO',  a); };
    console.info  = (...a) => { this.origConsole.info(...a);  write('INFO',  a); };
    console.warn  = (...a) => { this.origConsole.warn(...a);  write('WARN',  a); };
    console.error = (...a) => { this.origConsole.error(...a); write('ERROR', a); };
  }

  private stopLogFile(): void {
    // Restore original console methods
    console.log   = this.origConsole.log;
    console.info  = this.origConsole.info;
    console.warn  = this.origConsole.warn;
    console.error = this.origConsole.error;
    this.logStream?.end();
    this.logStream = undefined;
  }

  /**
   * Build chain config from environment variables (CLAW_CHAIN_*).
   * Returns undefined if required vars are missing.
   */
  private buildChainConfig(): Record<string, unknown> | undefined {
    const rpcUrl = process.env.CLAW_CHAIN_RPC_URL;
    if (!rpcUrl) return undefined;

    const chainId = Number(process.env.CLAW_CHAIN_ID || 7625);

    // Contract addresses — all must be present for chain services to work
    const identity = process.env.CLAW_CHAIN_IDENTITY_CONTRACT;
    if (!identity) {
      logger.info('[telagent] CLAW_CHAIN_IDENTITY_CONTRACT not set — chain services will be unavailable');
      return undefined;
    }

    const rawArtifactsDir = process.env.CLAW_CHAIN_ARTIFACTS_DIR;
    // artifactsDir is optional — @claw-network/node 2026.2.10+ falls back to @claw-network/contracts npm
    const artifactsDir = rawArtifactsDir ? resolve(rawArtifactsDir) : undefined;

    const contracts: Record<string, string> = { identity };
    // Optional contracts — chain services degrade gracefully for missing ones
    const optionalContracts = {
      token: process.env.CLAW_CHAIN_TOKEN_CONTRACT,
      escrow: process.env.CLAW_CHAIN_ESCROW_CONTRACT,
      reputation: process.env.CLAW_CHAIN_REPUTATION_CONTRACT,
      contracts: process.env.CLAW_CHAIN_CONTRACTS_CONTRACT,
      dao: process.env.CLAW_CHAIN_DAO_CONTRACT,
      staking: process.env.CLAW_CHAIN_STAKING_CONTRACT,
      paramRegistry: process.env.CLAW_CHAIN_PARAM_REGISTRY_CONTRACT,
    };
    for (const [key, val] of Object.entries(optionalContracts)) {
      if (val) contracts[key] = val;
    }

    const signerType = process.env.CLAW_SIGNER_TYPE || 'env';
    const signer = signerType === 'keyfile'
      ? { type: 'keyfile' as const, path: process.env.CLAW_SIGNER_PATH || '' }
      : { type: 'env' as const, envVar: process.env.CLAW_SIGNER_ENV || 'CLAW_PRIVATE_KEY' };

    return { rpcUrl, chainId, contracts, signer, artifactsDir };
  }

  /**
   * Try to read chain config from config.yaml in the data directory.
   * Falls back to env-var-based config.
   */
  private resolveChainConfig(): Record<string, unknown> | undefined {
    // 1. Try config.yaml (same behaviour as `clawnetd` daemon)
    try {
      const configPath = resolve(this.dataDir, 'config.yaml');
      const raw = readFileSync(configPath, 'utf8');
      // Lightweight YAML parse for the chain section
      // We only need to detect if a 'chain:' block exists to hand off to ClawNetNode
      if (raw.includes('\nchain:') || raw.startsWith('chain:')) {
        // Full YAML parsing happens inside ClawNetNode via the persisted config
        // We just need to signal its presence so the daemon code path is triggered.
        // However, ClawNetNode constructor doesn't read config.yaml for chain —
        // it only accepts chain config as a constructor parameter.
        // So we still need env vars or manual parsing.
      }
    } catch {
      // config.yaml not found — OK
    }

    // 2. Build from CLAW_CHAIN_* env vars
    return this.buildChainConfig();
  }

  /**
   * 在已有数据目录上启动 ClawNet Node
   * 如果指定端口被占用，自动尝试 +1 端口（最多 5 次）（RFC §7 风险表）
   */
  async start(): Promise<void> {
    this.startLogFile();
    const { killClawnetdOnPort } = await import('./clawnetd-process.js');
    const { ClawNetNode } = await import('@claw-network/node');
    const chainConfig = this.resolveChainConfig();
    if (chainConfig) {
      logger.info('[telagent] ClawNet embedded chain config resolved — identity service will be available');
    }
    let port = this.apiPort;
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        this.node = new ClawNetNode({
          dataDir: this.dataDir,
          passphrase: this.passphrase,
          api: { host: '127.0.0.1', port, enabled: true },
          chain: chainConfig as any,
          faucetUrl: process.env.CLAW_FAUCET_URL ?? 'https://api.clawnetd.com',
          network: (process.env.CLAW_NETWORK as 'mainnet' | 'testnet' | 'devnet') ?? 'testnet',
        });
        await this.node.start();
        if (port !== this.apiPort) {
          getGlobalLogger().warn('[telagent] ClawNet Node started on fallback port %d (original %d was busy)', port, this.apiPort);
        }
        return;
      } catch (err: unknown) {
        const msg = (err as Error)?.message ?? '';
        if ((msg.includes('EADDRINUSE') || msg.includes('address already in use')) && attempt < maxAttempts - 1) {
          if (this.killClawnetdOnStart && await killClawnetdOnPort(port)) {
            continue;
          }
          port++;
          continue;
        }
        throw err;
      }
    }
    throw new Error(`[telagent] FATAL: Could not start ClawNet Node — ports ${this.apiPort}-${port} all in use`);
  }

  /**
   * 获取实际使用的 API 端口（端口回退后可能与构造参数不同）
   */
  getApiPort(): number {
    return this.node?.apiPort ?? this.apiPort;
  }

  /**
   * 全新初始化 + 启动（首次运行）
   * ClawNetNode@0.4.0 的 start() 会自动检测数据目录，若为空则初始化密钥
   */
  async initAndStart(): Promise<void> {
    await this.start();
  }

  async stop(): Promise<void> {
    if (this.node) {
      await this.node.stop();
      this.node = null;
    }
    this.stopLogFile();
  }

  getDid(): string | null {
    if (!this.node) throw new Error('ClawNet Node not started');
    return this.node.getDid();
  }

  getEventStore(): any | undefined {
    return this.node?.eventStore;
  }

  /**
   * Create an API key via ClawNetNode's public API (v0.6.14+).
   * Creates a fresh key each call — the SDK's ApiKeyStore manages persistence.
   */
  createApiKey(label: string): string | undefined {
    if (!this.node?.createApiKey) {
      logger.warn('[telagent] createApiKey: node.createApiKey not available');
      return undefined;
    }
    try {
      const result = this.node.createApiKey(label);
      logger.info('[telagent] createApiKey("%s") => id=%d label="%s" key="%s..."',
        label, result?.id, result?.label, result?.key?.slice(0, 8));
      return result?.key;
    } catch (err) {
      logger.warn('[telagent] createApiKey failed: %s', (err as Error)?.message ?? String(err));
      return undefined;
    }
  }

  isRunning(): boolean {
    return this.node !== null;
  }
}
