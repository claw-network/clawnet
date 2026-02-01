/**
 * ClawWallet - AI Agent 钱包实现
 * 管理 Token 的存储、转账和托管
 */

import { EventEmitter } from 'events';
import {
  AgentId,
  Wallet,
  Transaction,
  TransactionId,
  TransactionType,
  TransactionStatus,
  TokenRestriction,
  ApiResponse,
} from './types';

// ============================================
// 常量
// ============================================

/** 1 Token = 1,000,000 microtoken */
export const TOKEN_DECIMALS = 6;
export const MICROTOKEN_PER_TOKEN = BigInt(10 ** TOKEN_DECIMALS);

// ============================================
// 工具函数
// ============================================

/**
 * 将 Token 转换为 microtoken
 */
export function tokenToMicrotoken(token: number): bigint {
  return BigInt(Math.floor(token * Number(MICROTOKEN_PER_TOKEN)));
}

/**
 * 将 microtoken 转换为 Token
 */
export function microtokenToToken(microtoken: bigint): number {
  return Number(microtoken) / Number(MICROTOKEN_PER_TOKEN);
}

/**
 * 格式化显示 Token 金额
 */
export function formatToken(microtoken: bigint): string {
  const token = microtokenToToken(microtoken);
  return `${token.toFixed(2)} Token`;
}

// ============================================
// 钱包配置
// ============================================

export interface WalletConfig {
  /** Agent ID */
  agentId: AgentId;
  
  /** 钱包存储路径 */
  storagePath?: string;
  
  /** API 端点 */
  apiEndpoint?: string;
  
  /** 自动保存 */
  autoSave?: boolean;
}

// ============================================
// ClawWallet 实现
// ============================================

export class ClawWallet extends EventEmitter {
  private wallet: Wallet;
  private transactions: Map<TransactionId, Transaction> = new Map();
  private config: WalletConfig;
  
  private constructor(config: WalletConfig) {
    super();
    this.config = config;
    this.wallet = {
      walletId: this.generateWalletId(),
      agentId: config.agentId,
      balance: BigInt(0),
      lockedBalance: BigInt(0),
      availableBalance: BigInt(0),
      createdAt: Date.now(),
    };
  }
  
  /**
   * 创建新钱包
   */
  static async create(config: WalletConfig): Promise<ClawWallet> {
    const wallet = new ClawWallet(config);
    await wallet.initialize();
    return wallet;
  }
  
  /**
   * 从存储加载钱包
   */
  static async load(storagePath: string): Promise<ClawWallet> {
    // TODO: 实现从文件/数据库加载
    throw new Error('Not implemented');
  }
  
  // ============================================
  // 基础操作
  // ============================================
  
  /**
   * 获取钱包信息
   */
  getInfo(): Wallet {
    return { ...this.wallet };
  }
  
  /**
   * 获取余额
   */
  getBalance(): bigint {
    return this.wallet.balance;
  }
  
  /**
   * 获取可用余额
   */
  getAvailableBalance(): bigint {
    return this.wallet.availableBalance;
  }
  
  /**
   * 获取锁定余额
   */
  getLockedBalance(): bigint {
    return this.wallet.lockedBalance;
  }
  
  // ============================================
  // 转账操作
  // ============================================
  
  /**
   * 转账到另一个 Agent
   */
  async transfer(
    to: AgentId,
    amount: bigint,
    options?: {
      memo?: string;
      restriction?: TokenRestriction;
    }
  ): Promise<ApiResponse<Transaction>> {
    // 验证余额
    if (amount > this.wallet.availableBalance) {
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: `Insufficient balance. Available: ${formatToken(this.wallet.availableBalance)}, Required: ${formatToken(amount)}`,
        },
      };
    }
    
    // 验证金额
    if (amount <= BigInt(0)) {
      return {
        success: false,
        error: {
          code: 'INVALID_AMOUNT',
          message: 'Amount must be greater than 0',
        },
      };
    }
    
    // 计算手续费 (0.1%)
    const fee = amount / BigInt(1000);
    const totalDeduction = amount + fee;
    
    if (totalDeduction > this.wallet.availableBalance) {
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE_WITH_FEE',
          message: `Insufficient balance including fee. Available: ${formatToken(this.wallet.availableBalance)}, Required: ${formatToken(totalDeduction)}`,
        },
      };
    }
    
    // 创建交易
    const tx: Transaction = {
      txId: this.generateTxId(),
      type: TransactionType.TRANSFER,
      from: this.wallet.agentId,
      to,
      amount,
      fee,
      status: TransactionStatus.PENDING,
      memo: options?.memo,
      createdAt: Date.now(),
    };
    
    // 扣除余额
    this.wallet.balance -= totalDeduction;
    this.wallet.availableBalance -= totalDeduction;
    
    // 保存交易
    this.transactions.set(tx.txId, tx);
    
    // 模拟确认 (实际应通过网络)
    tx.status = TransactionStatus.CONFIRMED;
    tx.confirmedAt = Date.now();
    
    this.emit('transfer', tx);
    
    return { success: true, data: tx };
  }
  
  /**
   * 接收转账
   */
  async receive(tx: Transaction): Promise<void> {
    if (tx.to !== this.wallet.agentId) {
      throw new Error('Transaction not intended for this wallet');
    }
    
    this.wallet.balance += tx.amount;
    this.wallet.availableBalance += tx.amount;
    this.transactions.set(tx.txId, tx);
    
    this.emit('receive', tx);
  }
  
  // ============================================
  // 托管操作
  // ============================================
  
  /**
   * 锁定资金到托管
   */
  async lockToEscrow(
    contractId: string,
    amount: bigint
  ): Promise<ApiResponse<Transaction>> {
    if (amount > this.wallet.availableBalance) {
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient available balance for escrow',
        },
      };
    }
    
    const tx: Transaction = {
      txId: this.generateTxId(),
      type: TransactionType.ESCROW_LOCK,
      from: this.wallet.agentId,
      to: 'escrow_system',
      amount,
      fee: BigInt(0),
      contractId,
      status: TransactionStatus.CONFIRMED,
      createdAt: Date.now(),
      confirmedAt: Date.now(),
    };
    
    this.wallet.availableBalance -= amount;
    this.wallet.lockedBalance += amount;
    this.transactions.set(tx.txId, tx);
    
    this.emit('escrow_lock', tx);
    
    return { success: true, data: tx };
  }
  
  /**
   * 从托管释放资金 (服务完成)
   */
  async releaseFromEscrow(
    contractId: string,
    to: AgentId,
    amount: bigint
  ): Promise<ApiResponse<Transaction>> {
    if (amount > this.wallet.lockedBalance) {
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_LOCKED_BALANCE',
          message: 'Insufficient locked balance',
        },
      };
    }
    
    const tx: Transaction = {
      txId: this.generateTxId(),
      type: TransactionType.ESCROW_RELEASE,
      from: 'escrow_system',
      to,
      amount,
      fee: BigInt(0),
      contractId,
      status: TransactionStatus.CONFIRMED,
      createdAt: Date.now(),
      confirmedAt: Date.now(),
    };
    
    this.wallet.balance -= amount;
    this.wallet.lockedBalance -= amount;
    this.transactions.set(tx.txId, tx);
    
    this.emit('escrow_release', tx);
    
    return { success: true, data: tx };
  }
  
  /**
   * 从托管退款 (服务取消)
   */
  async refundFromEscrow(
    contractId: string,
    amount: bigint
  ): Promise<ApiResponse<Transaction>> {
    if (amount > this.wallet.lockedBalance) {
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_LOCKED_BALANCE',
          message: 'Insufficient locked balance for refund',
        },
      };
    }
    
    const tx: Transaction = {
      txId: this.generateTxId(),
      type: TransactionType.ESCROW_REFUND,
      from: 'escrow_system',
      to: this.wallet.agentId,
      amount,
      fee: BigInt(0),
      contractId,
      status: TransactionStatus.CONFIRMED,
      createdAt: Date.now(),
      confirmedAt: Date.now(),
    };
    
    this.wallet.lockedBalance -= amount;
    this.wallet.availableBalance += amount;
    this.transactions.set(tx.txId, tx);
    
    this.emit('escrow_refund', tx);
    
    return { success: true, data: tx };
  }
  
  // ============================================
  // 交易历史
  // ============================================
  
  /**
   * 获取交易历史
   */
  getTransactionHistory(options?: {
    type?: TransactionType;
    limit?: number;
    offset?: number;
  }): Transaction[] {
    let txs = Array.from(this.transactions.values());
    
    if (options?.type) {
      txs = txs.filter(tx => tx.type === options.type);
    }
    
    txs.sort((a, b) => b.createdAt - a.createdAt);
    
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    
    return txs.slice(offset, offset + limit);
  }
  
  /**
   * 获取单笔交易
   */
  getTransaction(txId: TransactionId): Transaction | undefined {
    return this.transactions.get(txId);
  }
  
  // ============================================
  // 内部方法
  // ============================================
  
  private async initialize(): Promise<void> {
    // 可以从存储加载或同步网络状态
    this.emit('initialized', this.wallet);
  }
  
  private generateWalletId(): string {
    return `wallet_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
  
  private generateTxId(): TransactionId {
    return `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
  
  /**
   * 保存钱包到存储
   */
  async save(): Promise<void> {
    // TODO: 实现持久化存储
    this.emit('saved', this.wallet);
  }
  
  /**
   * 导出钱包数据 (用于备份)
   */
  export(): string {
    return JSON.stringify({
      wallet: {
        ...this.wallet,
        balance: this.wallet.balance.toString(),
        lockedBalance: this.wallet.lockedBalance.toString(),
        availableBalance: this.wallet.availableBalance.toString(),
      },
      transactions: Array.from(this.transactions.entries()).map(([id, tx]) => [
        id,
        {
          ...tx,
          amount: tx.amount.toString(),
          fee: tx.fee.toString(),
        },
      ]),
    });
  }
}

export default ClawWallet;
