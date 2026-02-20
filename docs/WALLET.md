# ClawWallet 钱包系统设计

> AI Agent 钱包的完整技术规范 - 存储、转账、托管、安全

## 概述

ClawWallet 是 ClawNet 协议的核心组件，为 AI Agents 提供：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ClawWallet 功能                                   │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   资产管理   │  │   转账支付   │  │   托管服务   │  │   交易历史   │        │
│  │             │  │             │  │             │  │             │        │
│  │ • Token 余额│  │ • 即时转账  │  │ • 条件托管  │  │ • 完整记录  │        │
│  │ • 锁定资产  │  │ • 批量转账  │  │ • 多签托管  │  │ • 可验证性  │        │
│  │ • 多币种    │  │ • 定时转账  │  │ • 时间锁定  │  │ • 导出报表  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   密钥管理   │  │   权限控制   │  │   恢复机制   │  │   审计日志   │        │
│  │             │  │             │  │             │  │             │        │
│  │ • 分层密钥  │  │ • 支出限额  │  │ • 社交恢复  │  │ • 操作追踪  │        │
│  │ • 硬件支持  │  │ • 白名单    │  │ • 备份恢复  │  │ • 异常检测  │        │
│  │ • 密钥轮换  │  │ • 多签授权  │  │ • 时间锁定  │  │ • 合规报告  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              应用层                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         ClawWallet SDK                                   ││
│  │  wallet.getBalance() | wallet.transfer() | wallet.escrow() | ...        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              核心层                                          │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │    账户管理      │  │    交易引擎      │  │    托管系统      │             │
│  │   AccountMgr    │  │  TransactionEng │  │   EscrowSystem  │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │    密钥管理      │  │    权限管理      │  │    通知系统      │             │
│  │    KeyManager   │  │  PermissionMgr  │  │   Notification  │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              存储层                                          │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │    本地存储      │  │    加密存储      │  │    分布式存储    │             │
│  │  (开发/测试)    │  │   (生产环境)     │  │   (去中心化)    │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              网络层                                          │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │   ClawNet     │  │    P2P 网络     │  │   区块链锚定     │             │
│  │   协议节点      │  │   (去中心化)    │  │   (可选增强)    │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 模块依赖

```
                    ┌─────────────────┐
                    │   ClawWallet    │
                    │   (主入口)      │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  AccountManager │ │TransactionEngine│ │  EscrowSystem   │
│                 │ │                 │ │                 │
│ • 账户创建      │ │ • 交易构建      │ │ • 托管创建      │
│ • 余额管理      │ │ • 签名验证      │ │ • 条件释放      │
│ • 多账户支持    │ │ • 广播确认      │ │ • 争议处理      │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   KeyManager    │
                    │                 │
                    │ • 密钥生成      │
                    │ • 安全存储      │
                    │ • 签名操作      │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  StorageAdapter │
                    │                 │
                    │ • 加密存储      │
                    │ • 多后端支持    │
                    └─────────────────┘
```

---

## 数据结构

### 钱包结构

```typescript
/**
 * ClawWallet 主结构
 */
interface ClawWallet {
  // 钱包标识
  id: string;                    // 钱包唯一 ID
  version: string;               // 钱包版本
  createdAt: number;             // 创建时间
  
  // 身份关联
  ownerDID: string;              // 所有者 DID
  label?: string;                // 用户自定义标签
  
  // 账户列表
  accounts: WalletAccount[];
  defaultAccountIndex: number;
  
  // 设置
  settings: WalletSettings;
  
  // 权限
  permissions: WalletPermissions;
  
  // 恢复信息
  recovery: RecoveryConfig;
  
  // 元数据
  metadata: {
    lastActivity: number;
    transactionCount: number;
    totalVolume: bigint;
  };
}

/**
 * 钱包账户
 */
interface WalletAccount {
  // 账户标识
  index: number;                 // 账户索引
  address: string;               // 账户地址
  label?: string;                // 账户标签
  
  // 密钥引用（不存储私钥本身）
  keyId: string;                 // 密钥管理器中的 ID
  publicKey: string;             // 公钥（用于验证）
  
  // 余额
  balances: AccountBalances;
  
  // 账户设置
  settings: AccountSettings;
  
  // 状态
  status: 'active' | 'frozen' | 'archived';
}

/**
 * 账户余额
 */
interface AccountBalances {
  // 可用余额
  available: bigint;
  
  // 锁定余额（细分）
  locked: {
    // 托管中
    escrow: bigint;
    
    // 质押
    staking: bigint;
    
    // 治理锁定
    governance: bigint;
    
    // 归属中（vesting）
    vesting: bigint;
    
    // 其他锁定
    other: {
      reason: string;
      amount: bigint;
      unlockAt?: number;
    }[];
  };
  
  // 待处理
  pending: {
    incoming: bigint;            // 待确认收入
    outgoing: bigint;            // 待确认支出
  };
  
  // 总余额 = available + locked.* + pending.incoming
  total: bigint;
  
  // 最后更新
  lastUpdated: number;
}

/**
 * 钱包设置
 */
interface WalletSettings {
  // 网络
  network: 'mainnet' | 'testnet' | 'devnet';
  
  // 安全
  security: {
    // 自动锁定
    autoLockTimeout: number;     // 毫秒，0 = 不自动锁定
    
    // 交易确认
    requireConfirmation: {
      always: boolean;
      aboveAmount?: bigint;      // 超过此金额需确认
    };
    
    // 密码保护
    passwordProtected: boolean;
    
    // 生物识别
    biometricEnabled: boolean;
  };
  
  // 通知
  notifications: {
    onReceive: boolean;
    onSend: boolean;
    onEscrow: boolean;
    lowBalanceAlert?: bigint;
  };
  
  // 显示
  display: {
    currency: string;            // 显示货币
    decimals: number;            // 显示精度
    hideSmallBalances: boolean;
    smallBalanceThreshold?: bigint;
  };
  
  // 高级
  advanced: {
    customRPC?: string;
    debugMode: boolean;
    analyticsEnabled: boolean;
  };
}
```

### 交易结构

```typescript
/**
 * 交易类型
 */
type TransactionType = 
  | 'transfer'           // 普通转账
  | 'escrow_create'      // 创建托管
  | 'escrow_release'     // 托管释放
  | 'escrow_refund'      // 托管退款
  | 'stake'              // 质押
  | 'unstake'            // 解除质押
  | 'governance_lock'    // 治理锁定
  | 'governance_unlock'  // 治理解锁
  | 'fee'                // 手续费
  | 'reward'             // 奖励
  | 'mint'               // 铸造（系统）
  | 'burn';              // 销毁

/**
 * 交易状态
 */
type TransactionStatus = 
  | 'pending'            // 待处理
  | 'confirming'         // 确认中
  | 'confirmed'          // 已确认
  | 'failed'             // 失败
  | 'cancelled'          // 已取消
  | 'expired';           // 已过期

/**
 * 交易记录
 */
interface Transaction {
  // 交易标识
  id: string;                    // 交易 ID
  hash: string;                  // 交易哈希
  
  // 类型
  type: TransactionType;
  
  // 参与方
  from: string;                  // 发送方地址
  to: string;                    // 接收方地址
  
  // 金额
  amount: bigint;                // 交易金额
  fee: bigint;                   // 手续费
  
  // 时间
  createdAt: number;             // 创建时间
  confirmedAt?: number;          // 确认时间
  expiresAt?: number;            // 过期时间
  
  // 状态
  status: TransactionStatus;
  confirmations: number;         // 确认数
  
  // 附加数据
  memo?: string;                 // 备注
  metadata?: Record<string, any>; // 元数据
  
  // 关联
  contractId?: string;           // 关联合约
  escrowId?: string;             // 关联托管
  
  // 签名
  signature: string;
  
  // 错误信息（如果失败）
  error?: {
    code: string;
    message: string;
  };
}

/**
 * 转账请求
 */
interface TransferRequest {
  // 接收方
  to: string;                    // 地址或 DID
  
  // 金额
  amount: bigint;
  
  // 可选
  memo?: string;
  
  // 高级选项
  options?: {
    // 费用
    maxFee?: bigint;             // 最大手续费
    priority?: 'low' | 'normal' | 'high';
    
    // 条件
    condition?: TransferCondition;
    
    // 过期
    expiresAt?: number;
    
    // 确认
    requireConfirmations?: number;
  };
}

/**
 * 转账条件
 */
interface TransferCondition {
  type: 'time' | 'approval' | 'multi_sig' | 'oracle';
  
  // 时间条件
  timeCondition?: {
    notBefore?: number;
    notAfter?: number;
  };
  
  // 审批条件
  approvalCondition?: {
    approvers: string[];
    threshold: number;
  };
  
  // 多签条件
  multiSigCondition?: {
    signers: string[];
    threshold: number;
  };
  
  // 预言机条件
  oracleCondition?: {
    oracle: string;
    query: string;
    expectedValue: any;
  };
}
```

### 托管结构

```typescript
/**
 * 托管账户
 */
interface EscrowAccount {
  id: string;
  
  // 关联
  contractId?: string;           // 关联合约
  
  // 参与方
  depositor: string;             // 存款方
  beneficiary: string;           // 受益方
  arbiter?: string;              // 仲裁方
  
  // 资金
  balance: bigint;
  currency: string;
  
  // 释放规则
  releaseRules: EscrowReleaseRule[];
  
  // 退款规则
  refundRules: EscrowRefundRule[];
  
  // 时间限制
  expiresAt?: number;
  
  // 状态
  status: EscrowStatus;
  
  // 历史
  history: EscrowEvent[];
  
  // 创建时间
  createdAt: number;
}

type EscrowStatus = 
  | 'pending'            // 等待存款
  | 'funded'             // 已存款
  | 'releasing'          // 释放中
  | 'released'           // 已释放
  | 'refunding'          // 退款中
  | 'refunded'           // 已退款
  | 'disputed'           // 争议中
  | 'expired';           // 已过期

/**
 * 托管释放规则
 */
interface EscrowReleaseRule {
  id: string;
  
  // 释放金额
  amount: bigint | { percentage: number };
  
  // 条件
  condition: EscrowCondition;
  
  // 状态
  triggered: boolean;
  triggeredAt?: number;
}

/**
 * 托管条件
 */
type EscrowCondition = 
  | { type: 'approval'; approvers: string[]; threshold: number }
  | { type: 'time'; after: number }
  | { type: 'milestone'; milestoneId: string }
  | { type: 'oracle'; oracle: string; query: string; expected: any }
  | { type: 'multi_sig'; signers: string[]; threshold: number }
  | { type: 'compound'; operator: 'AND' | 'OR'; conditions: EscrowCondition[] };
```

---

## 密钥管理

### 密钥层次结构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           密钥层次结构                                       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        主密钥 (Master Key)                          │    │
│  │                                                                      │    │
│  │  • 最高权限                                                          │    │
│  │  • 离线冷存储                                                        │    │
│  │  • 用于派生其他密钥                                                  │    │
│  │  • 仅用于恢复和紧急操作                                              │    │
│  └────────────────────────────────┬────────────────────────────────────┘    │
│                                   │                                          │
│              ┌────────────────────┼────────────────────┐                    │
│              │                    │                    │                    │
│              ▼                    ▼                    ▼                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐            │
│  │   操作密钥       │  │   加密密钥       │  │   恢复密钥       │            │
│  │  (Operational)  │  │  (Encryption)   │  │   (Recovery)    │            │
│  │                 │  │                 │  │                 │            │
│  │ • 日常交易      │  │ • 数据加密      │  │ • 密钥恢复      │            │
│  │ • 签名操作      │  │ • 通信加密      │  │ • 社交恢复      │            │
│  │ • 可轮换        │  │ • 存储加密      │  │ • 分片存储      │            │
│  └────────┬────────┘  └─────────────────┘  └─────────────────┘            │
│           │                                                                  │
│  ┌────────┴────────────────────────────────┐                                │
│  │                                          │                                │
│  ▼                                          ▼                                │
│  ┌─────────────────┐            ┌─────────────────┐                        │
│  │   签名子密钥     │            │   授权子密钥     │                        │
│  │  (Signing)      │            │  (Authorization)│                        │
│  │                 │            │                 │                        │
│  │ • 单次使用      │            │ • 限额授权      │                        │
│  │ • 快速轮换      │            │ • 时间限制      │                        │
│  │ • 限定用途      │            │ • 特定操作      │                        │
│  └─────────────────┘            └─────────────────┘                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 密钥管理器

```typescript
/**
 * 密钥管理器接口
 */
interface KeyManager {
  // 生成密钥
  generateMasterKey(): Promise<MasterKeyInfo>;
  deriveKey(masterKeyId: string, path: string): Promise<DerivedKeyInfo>;
  
  // 导入/导出
  importKey(key: string, password: string): Promise<string>;
  exportKey(keyId: string, password: string): Promise<string>;
  
  // 签名
  sign(keyId: string, data: Uint8Array): Promise<Signature>;
  signTransaction(keyId: string, tx: Transaction): Promise<SignedTransaction>;
  
  // 验证
  verify(publicKey: string, data: Uint8Array, signature: Signature): Promise<boolean>;
  
  // 加密/解密
  encrypt(keyId: string, data: Uint8Array): Promise<EncryptedData>;
  decrypt(keyId: string, encrypted: EncryptedData): Promise<Uint8Array>;
  
  // 密钥生命周期
  rotateKey(keyId: string): Promise<string>;
  revokeKey(keyId: string): Promise<void>;
  
  // 恢复
  setupRecovery(masterKeyId: string, config: RecoveryConfig): Promise<void>;
  initiateRecovery(shares: RecoveryShare[]): Promise<string>;
}

/**
 * 密钥信息
 */
interface KeyInfo {
  id: string;
  type: 'master' | 'operational' | 'encryption' | 'recovery' | 'derived';
  algorithm: 'Ed25519' | 'secp256k1' | 'X25519';
  
  publicKey: string;
  // 私钥不直接暴露，存储在安全存储中
  
  derivationPath?: string;
  parentKeyId?: string;
  
  createdAt: number;
  expiresAt?: number;
  
  permissions: KeyPermission[];
  
  status: 'active' | 'rotated' | 'revoked';
}

/**
 * 密钥权限
 */
interface KeyPermission {
  action: 'sign' | 'encrypt' | 'derive' | 'export';
  
  // 限制
  restrictions?: {
    maxAmount?: bigint;          // 最大交易金额
    maxDaily?: bigint;           // 每日限额
    allowedRecipients?: string[]; // 允许的接收方
    allowedOperations?: string[]; // 允许的操作类型
    expiresAt?: number;          // 过期时间
  };
}
```

### 安全存储

```typescript
/**
 * 安全存储接口
 */
interface SecureStorage {
  // 存储
  store(key: string, value: Uint8Array, options?: StoreOptions): Promise<void>;
  retrieve(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  
  // 加密存储
  storeEncrypted(key: string, value: Uint8Array, password: string): Promise<void>;
  retrieveEncrypted(key: string, password: string): Promise<Uint8Array | null>;
  
  // 密钥派生
  deriveStorageKey(password: string, salt: Uint8Array): Promise<Uint8Array>;
}

/**
 * 存储选项
 */
interface StoreOptions {
  // 加密
  encrypt?: boolean;
  
  // 访问控制
  accessControl?: {
    biometric?: boolean;
    password?: boolean;
    timeout?: number;
  };
  
  // 同步
  sync?: boolean;
  
  // 备份
  backup?: boolean;
}

/**
 * 存储实现
 */
class SecureStorageImpl implements SecureStorage {
  private backend: StorageBackend;
  
  constructor(options: SecureStorageOptions) {
    // 根据环境选择后端
    if (options.hardwareSecurityModule) {
      this.backend = new HSMBackend(options.hsmConfig);
    } else if (options.enclaveAvailable) {
      this.backend = new EnclaveBackend();
    } else {
      this.backend = new EncryptedFileBackend(options.storagePath);
    }
  }
  
  async store(key: string, value: Uint8Array, options?: StoreOptions): Promise<void> {
    // 加密
    let data = value;
    if (options?.encrypt !== false) {
      const encryptionKey = await this.getEncryptionKey();
      data = await encrypt(value, encryptionKey);
    }
    
    // 存储
    await this.backend.write(key, data);
    
    // 备份
    if (options?.backup) {
      await this.backup(key, data);
    }
  }
  
  async retrieve(key: string): Promise<Uint8Array | null> {
    const data = await this.backend.read(key);
    if (!data) return null;
    
    // 解密
    const encryptionKey = await this.getEncryptionKey();
    return await decrypt(data, encryptionKey);
  }
  
  // 密钥派生（使用 Argon2）
  async deriveStorageKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
    return await argon2.hash({
      pass: password,
      salt,
      time: 3,
      mem: 65536,
      parallelism: 4,
      hashLen: 32,
      type: argon2.ArgonType.Argon2id,
    });
  }
}
```

---

## 账户管理

### 账户管理器

```typescript
/**
 * 账户管理器
 */
class AccountManager {
  private wallet: ClawWallet;
  private keyManager: KeyManager;
  private storage: SecureStorage;
  
  /**
   * 创建新账户
   */
  async createAccount(options?: CreateAccountOptions): Promise<WalletAccount> {
    // 派生新密钥
    const keyPath = `m/44'/9999'/${this.wallet.accounts.length}'/0/0`;
    const keyInfo = await this.keyManager.deriveKey(
      this.wallet.masterKeyId,
      keyPath,
    );
    
    // 生成地址
    const address = await this.generateAddress(keyInfo.publicKey);
    
    // 创建账户
    const account: WalletAccount = {
      index: this.wallet.accounts.length,
      address,
      label: options?.label || `Account ${this.wallet.accounts.length + 1}`,
      keyId: keyInfo.id,
      publicKey: keyInfo.publicKey,
      balances: {
        available: 0n,
        locked: {
          escrow: 0n,
          staking: 0n,
          governance: 0n,
          vesting: 0n,
          other: [],
        },
        pending: {
          incoming: 0n,
          outgoing: 0n,
        },
        total: 0n,
        lastUpdated: Date.now(),
      },
      settings: options?.settings || defaultAccountSettings(),
      status: 'active',
    };
    
    this.wallet.accounts.push(account);
    await this.saveWallet();
    
    return account;
  }
  
  /**
   * 获取账户余额
   */
  async getBalance(accountIndex?: number): Promise<AccountBalances> {
    const account = this.getAccount(accountIndex);
    
    // 从网络获取最新余额
    const networkBalance = await this.fetchNetworkBalance(account.address);
    
    // 更新本地缓存
    account.balances = {
      ...networkBalance,
      lastUpdated: Date.now(),
    };
    
    await this.saveWallet();
    
    return account.balances;
  }
  
  /**
   * 获取所有账户余额汇总
   */
  async getTotalBalance(): Promise<AccountBalances> {
    let total: AccountBalances = {
      available: 0n,
      locked: {
        escrow: 0n,
        staking: 0n,
        governance: 0n,
        vesting: 0n,
        other: [],
      },
      pending: {
        incoming: 0n,
        outgoing: 0n,
      },
      total: 0n,
      lastUpdated: Date.now(),
    };
    
    for (const account of this.wallet.accounts) {
      const balance = await this.getBalance(account.index);
      total.available += balance.available;
      total.locked.escrow += balance.locked.escrow;
      total.locked.staking += balance.locked.staking;
      total.locked.governance += balance.locked.governance;
      total.locked.vesting += balance.locked.vesting;
      total.pending.incoming += balance.pending.incoming;
      total.pending.outgoing += balance.pending.outgoing;
      total.total += balance.total;
    }
    
    return total;
  }
  
  /**
   * 冻结账户
   */
  async freezeAccount(accountIndex: number, reason: string): Promise<void> {
    const account = this.getAccount(accountIndex);
    
    account.status = 'frozen';
    account.metadata = {
      ...account.metadata,
      frozenAt: Date.now(),
      frozenReason: reason,
    };
    
    await this.saveWallet();
    
    // 通知
    await this.notify('account_frozen', { accountIndex, reason });
  }
  
  /**
   * 归档账户
   */
  async archiveAccount(accountIndex: number): Promise<void> {
    const account = this.getAccount(accountIndex);
    
    // 检查余额
    if (account.balances.total > 0n) {
      throw new Error('Cannot archive account with balance');
    }
    
    account.status = 'archived';
    
    await this.saveWallet();
  }
  
  // 辅助方法
  private getAccount(index?: number): WalletAccount {
    const idx = index ?? this.wallet.defaultAccountIndex;
    const account = this.wallet.accounts[idx];
    
    if (!account) {
      throw new Error(`Account ${idx} not found`);
    }
    
    return account;
  }
  
  private async generateAddress(publicKey: string): Promise<string> {
    // 使用 Base58Check 编码
    const hash = await sha256(Buffer.from(publicKey, 'hex'));
    const checksum = hash.slice(0, 4);
    const payload = Buffer.concat([
      Buffer.from([0x00]),  // 版本前缀
      Buffer.from(publicKey, 'hex'),
      checksum,
    ]);
    
    return 'claw' + base58.encode(payload);
  }
}
```

---

## 交易引擎

### 交易处理

```typescript
/**
 * 交易引擎
 */
class TransactionEngine {
  private wallet: ClawWallet;
  private keyManager: KeyManager;
  private networkClient: NetworkClient;
  private permissionManager: PermissionManager;
  
  /**
   * 发起转账
   */
  async transfer(request: TransferRequest): Promise<Transaction> {
    // 1. 验证请求
    await this.validateTransferRequest(request);
    
    // 2. 检查权限
    await this.permissionManager.checkPermission('transfer', {
      amount: request.amount,
      to: request.to,
    });
    
    // 3. 检查余额
    const balance = await this.wallet.getBalance();
    const totalNeeded = request.amount + this.estimateFee(request);
    
    if (balance.available < totalNeeded) {
      throw new InsufficientBalanceError(balance.available, totalNeeded);
    }
    
    // 4. 构建交易
    const tx = await this.buildTransaction(request);
    
    // 5. 签名
    const signedTx = await this.signTransaction(tx);
    
    // 6. 广播
    const result = await this.broadcastTransaction(signedTx);
    
    // 7. 更新本地状态
    await this.updateLocalState(result);
    
    // 8. 通知
    await this.notify('transfer_sent', result);
    
    return result;
  }
  
  /**
   * 批量转账
   */
  async batchTransfer(requests: TransferRequest[]): Promise<BatchTransferResult> {
    // 验证总金额
    const totalAmount = requests.reduce((sum, r) => sum + r.amount, 0n);
    const totalFee = this.estimateBatchFee(requests);
    
    const balance = await this.wallet.getBalance();
    if (balance.available < totalAmount + totalFee) {
      throw new InsufficientBalanceError(balance.available, totalAmount + totalFee);
    }
    
    // 构建批量交易
    const batchTx = await this.buildBatchTransaction(requests);
    
    // 签名
    const signedTx = await this.signTransaction(batchTx);
    
    // 广播
    return await this.broadcastBatchTransaction(signedTx);
  }
  
  /**
   * 定时转账
   */
  async scheduleTransfer(
    request: TransferRequest,
    schedule: TransferSchedule,
  ): Promise<ScheduledTransfer> {
    // 验证调度
    this.validateSchedule(schedule);
    
    // 创建调度任务
    const scheduled: ScheduledTransfer = {
      id: generateId(),
      request,
      schedule,
      status: 'scheduled',
      createdAt: Date.now(),
      nextExecutionAt: this.calculateNextExecution(schedule),
      executions: [],
    };
    
    // 保存
    await this.saveScheduledTransfer(scheduled);
    
    // 注册定时器
    await this.registerScheduler(scheduled);
    
    return scheduled;
  }
  
  /**
   * 构建交易
   */
  private async buildTransaction(request: TransferRequest): Promise<Transaction> {
    const account = this.wallet.accounts[this.wallet.defaultAccountIndex];
    
    // 解析接收方地址
    const toAddress = await this.resolveAddress(request.to);
    
    // 获取 nonce
    const nonce = await this.networkClient.getNonce(account.address);
    
    // 估算费用
    const fee = await this.estimateFee(request);
    
    const tx: Transaction = {
      id: generateId(),
      hash: '',  // 签名后计算
      type: 'transfer',
      from: account.address,
      to: toAddress,
      amount: request.amount,
      fee,
      createdAt: Date.now(),
      expiresAt: request.options?.expiresAt,
      status: 'pending',
      confirmations: 0,
      memo: request.memo,
      metadata: {
        nonce,
        ...request.options,
      },
      signature: '',
    };
    
    return tx;
  }
  
  /**
   * 签名交易
   */
  private async signTransaction(tx: Transaction): Promise<SignedTransaction> {
    const account = this.wallet.accounts[this.wallet.defaultAccountIndex];
    
    // 序列化交易数据
    const txData = this.serializeTransaction(tx);
    
    // 计算哈希
    tx.hash = await sha256(txData);
    
    // 签名
    const signature = await this.keyManager.sign(account.keyId, txData);
    tx.signature = signature.toString();
    
    return tx as SignedTransaction;
  }
  
  /**
   * 广播交易
   */
  private async broadcastTransaction(tx: SignedTransaction): Promise<Transaction> {
    // 发送到网络
    const result = await this.networkClient.broadcast(tx);
    
    if (!result.success) {
      tx.status = 'failed';
      tx.error = {
        code: result.errorCode,
        message: result.errorMessage,
      };
      return tx;
    }
    
    tx.status = 'confirming';
    
    // 开始监听确认
    this.watchConfirmations(tx);
    
    return tx;
  }
  
  /**
   * 监听确认
   */
  private async watchConfirmations(tx: Transaction): Promise<void> {
    const requiredConfirmations = tx.metadata?.requireConfirmations || 1;
    
    const checkConfirmations = async () => {
      const status = await this.networkClient.getTransactionStatus(tx.hash);
      
      tx.confirmations = status.confirmations;
      
      if (status.confirmations >= requiredConfirmations) {
        tx.status = 'confirmed';
        tx.confirmedAt = Date.now();
        await this.notify('transfer_confirmed', tx);
      } else if (status.failed) {
        tx.status = 'failed';
        tx.error = status.error;
        await this.notify('transfer_failed', tx);
      } else {
        // 继续等待
        setTimeout(checkConfirmations, 5000);
      }
      
      await this.saveTransaction(tx);
    };
    
    await checkConfirmations();
  }
  
  /**
   * 费用估算
   */
  estimateFee(request: TransferRequest): bigint {
    const baseFee = 1n;  // 1 Token
    
    // 优先级加成
    const priorityMultiplier = {
      low: 0.5,
      normal: 1,
      high: 2,
    }[request.options?.priority || 'normal'];
    
    // 数据大小加成
    const dataSize = request.memo ? Buffer.from(request.memo).length : 0;
    const dataSizeFee = BigInt(Math.ceil(dataSize / 1024)); // 1 Token per KB
    
    // 条件转账加成
    const conditionFee = request.options?.condition ? 1n : 0n;
    
    const totalFee = BigInt(Math.ceil(Number(baseFee) * priorityMultiplier)) 
      + dataSizeFee 
      + conditionFee;
    
    // 检查最大费用限制
    if (request.options?.maxFee && totalFee > request.options.maxFee) {
      throw new Error('Estimated fee exceeds maximum');
    }
    
    return totalFee;
  }
}
```

### 交易历史

```typescript
/**
 * 交易历史管理
 */
class TransactionHistory {
  private storage: SecureStorage;
  private indexer: TransactionIndexer;
  
  /**
   * 获取交易历史
   */
  async getHistory(options?: HistoryOptions): Promise<TransactionHistoryResult> {
    const query: HistoryQuery = {
      accountAddress: options?.account,
      type: options?.type,
      status: options?.status,
      startDate: options?.startDate,
      endDate: options?.endDate,
      minAmount: options?.minAmount,
      maxAmount: options?.maxAmount,
      counterparty: options?.counterparty,
      sortBy: options?.sortBy || 'createdAt',
      sortOrder: options?.sortOrder || 'desc',
      limit: options?.limit || 50,
      offset: options?.offset || 0,
    };
    
    const transactions = await this.indexer.query(query);
    const total = await this.indexer.count(query);
    
    return {
      transactions,
      total,
      hasMore: total > query.offset! + transactions.length,
    };
  }
  
  /**
   * 获取交易详情
   */
  async getTransaction(txId: string): Promise<TransactionDetail> {
    const tx = await this.indexer.get(txId);
    
    if (!tx) {
      throw new Error('Transaction not found');
    }
    
    // 获取额外详情
    const networkStatus = await this.networkClient.getTransactionStatus(tx.hash);
    const relatedTxs = await this.getRelatedTransactions(tx);
    
    return {
      ...tx,
      networkStatus,
      relatedTransactions: relatedTxs,
    };
  }
  
  /**
   * 导出交易记录
   */
  async export(options: ExportOptions): Promise<ExportResult> {
    const history = await this.getHistory({
      startDate: options.startDate,
      endDate: options.endDate,
      limit: 10000,  // 最大导出数量
    });
    
    switch (options.format) {
      case 'csv':
        return this.exportCSV(history.transactions);
      case 'json':
        return this.exportJSON(history.transactions);
      case 'pdf':
        return this.exportPDF(history.transactions, options);
      default:
        throw new Error(`Unsupported format: ${options.format}`);
    }
  }
  
  /**
   * 生成报表
   */
  async generateReport(options: ReportOptions): Promise<TransactionReport> {
    const history = await this.getHistory({
      startDate: options.startDate,
      endDate: options.endDate,
      limit: 100000,
    });
    
    return {
      period: {
        start: options.startDate,
        end: options.endDate,
      },
      
      summary: {
        totalTransactions: history.total,
        totalIncoming: history.transactions
          .filter(t => t.type === 'transfer' && t.to === options.accountAddress)
          .reduce((sum, t) => sum + t.amount, 0n),
        totalOutgoing: history.transactions
          .filter(t => t.type === 'transfer' && t.from === options.accountAddress)
          .reduce((sum, t) => sum + t.amount, 0n),
        totalFees: history.transactions
          .filter(t => t.from === options.accountAddress)
          .reduce((sum, t) => sum + t.fee, 0n),
      },
      
      byType: this.groupByType(history.transactions),
      byCounterparty: this.groupByCounterparty(history.transactions, options.accountAddress),
      byDay: this.groupByDay(history.transactions),
      
      topRecipients: this.getTopRecipients(history.transactions, 10),
      topSenders: this.getTopSenders(history.transactions, 10),
    };
  }
}
```

---

## 托管系统

### 托管管理器

```typescript
/**
 * 托管系统
 */
class EscrowSystem {
  private wallet: ClawWallet;
  private networkClient: NetworkClient;
  
  /**
   * 创建托管
   */
  async createEscrow(config: CreateEscrowConfig): Promise<EscrowAccount> {
    // 验证配置
    this.validateEscrowConfig(config);
    
    // 检查余额
    const balance = await this.wallet.getBalance();
    if (balance.available < config.amount) {
      throw new InsufficientBalanceError(balance.available, config.amount);
    }
    
    // 创建托管账户
    const escrow: EscrowAccount = {
      id: generateEscrowId(),
      contractId: config.contractId,
      depositor: this.wallet.getDefaultAddress(),
      beneficiary: config.beneficiary,
      arbiter: config.arbiter,
      balance: 0n,
      currency: 'Token',
      releaseRules: config.releaseRules,
      refundRules: config.refundRules || [],
      expiresAt: config.expiresAt,
      status: 'pending',
      history: [],
      createdAt: Date.now(),
    };
    
    // 注册到网络
    await this.networkClient.registerEscrow(escrow);
    
    // 存入资金
    await this.fundEscrow(escrow.id, config.amount);
    
    return escrow;
  }
  
  /**
   * 存入资金
   */
  async fundEscrow(escrowId: string, amount: bigint): Promise<void> {
    const escrow = await this.getEscrow(escrowId);
    
    // 验证存款人
    if (escrow.depositor !== this.wallet.getDefaultAddress()) {
      throw new Error('Only depositor can fund escrow');
    }
    
    // 转账到托管
    const tx = await this.wallet.transfer({
      to: escrow.id,
      amount,
      memo: `Escrow funding: ${escrowId}`,
    });
    
    // 等待确认
    await this.waitForConfirmation(tx);
    
    // 更新托管状态
    escrow.balance += amount;
    escrow.status = 'funded';
    escrow.history.push({
      type: 'funded',
      amount,
      txId: tx.id,
      timestamp: Date.now(),
    });
    
    await this.saveEscrow(escrow);
  }
  
  /**
   * 释放托管资金
   */
  async releaseEscrow(
    escrowId: string,
    ruleId?: string,
    signature?: string,
  ): Promise<Transaction> {
    const escrow = await this.getEscrow(escrowId);
    
    // 确定释放规则
    const rule = ruleId 
      ? escrow.releaseRules.find(r => r.id === ruleId)
      : escrow.releaseRules.find(r => !r.triggered);
    
    if (!rule) {
      throw new Error('No valid release rule found');
    }
    
    // 验证条件
    const conditionMet = await this.checkCondition(rule.condition, escrow, signature);
    if (!conditionMet) {
      throw new Error('Release condition not met');
    }
    
    // 计算释放金额
    const amount = typeof rule.amount === 'bigint'
      ? rule.amount
      : escrow.balance * BigInt(rule.amount.percentage) / 100n;
    
    // 执行释放
    const tx = await this.networkClient.releaseEscrow(escrow.id, escrow.beneficiary, amount);
    
    // 更新状态
    escrow.balance -= amount;
    rule.triggered = true;
    rule.triggeredAt = Date.now();
    
    escrow.history.push({
      type: 'released',
      amount,
      to: escrow.beneficiary,
      ruleId: rule.id,
      txId: tx.id,
      timestamp: Date.now(),
    });
    
    if (escrow.balance === 0n) {
      escrow.status = 'released';
    } else {
      escrow.status = 'releasing';
    }
    
    await this.saveEscrow(escrow);
    
    return tx;
  }
  
  /**
   * 退款
   */
  async refundEscrow(escrowId: string, reason: string): Promise<Transaction> {
    const escrow = await this.getEscrow(escrowId);
    
    // 检查退款规则
    const canRefund = await this.checkRefundEligibility(escrow, reason);
    if (!canRefund) {
      throw new Error('Refund not allowed');
    }
    
    // 执行退款
    const tx = await this.networkClient.refundEscrow(
      escrow.id,
      escrow.depositor,
      escrow.balance,
    );
    
    // 更新状态
    escrow.history.push({
      type: 'refunded',
      amount: escrow.balance,
      to: escrow.depositor,
      reason,
      txId: tx.id,
      timestamp: Date.now(),
    });
    
    escrow.balance = 0n;
    escrow.status = 'refunded';
    
    await this.saveEscrow(escrow);
    
    return tx;
  }
  
  /**
   * 发起争议
   */
  async disputeEscrow(escrowId: string, reason: string, evidence: Evidence[]): Promise<Dispute> {
    const escrow = await this.getEscrow(escrowId);
    
    // 验证可以发起争议
    if (escrow.status !== 'funded' && escrow.status !== 'releasing') {
      throw new Error('Cannot dispute escrow in current status');
    }
    
    // 创建争议
    const dispute: Dispute = {
      id: generateId(),
      escrowId,
      initiator: this.wallet.getDefaultAddress(),
      reason,
      evidence,
      status: 'open',
      createdAt: Date.now(),
    };
    
    // 冻结托管
    escrow.status = 'disputed';
    escrow.history.push({
      type: 'disputed',
      disputeId: dispute.id,
      reason,
      timestamp: Date.now(),
    });
    
    await this.saveEscrow(escrow);
    await this.saveDispute(dispute);
    
    // 通知仲裁方
    if (escrow.arbiter) {
      await this.notifyArbiter(escrow.arbiter, dispute);
    }
    
    return dispute;
  }
  
  /**
   * 检查条件
   */
  private async checkCondition(
    condition: EscrowCondition,
    escrow: EscrowAccount,
    signature?: string,
  ): Promise<boolean> {
    switch (condition.type) {
      case 'approval':
        return await this.checkApprovalCondition(condition, signature);
        
      case 'time':
        return Date.now() >= condition.after;
        
      case 'milestone':
        return await this.checkMilestoneCondition(condition.milestoneId);
        
      case 'oracle':
        return await this.checkOracleCondition(condition);
        
      case 'multi_sig':
        return await this.checkMultiSigCondition(condition, signature);
        
      case 'compound':
        if (condition.operator === 'AND') {
          for (const c of condition.conditions) {
            if (!(await this.checkCondition(c, escrow, signature))) {
              return false;
            }
          }
          return true;
        } else {
          for (const c of condition.conditions) {
            if (await this.checkCondition(c, escrow, signature)) {
              return true;
            }
          }
          return false;
        }
    }
  }
}
```

### 多签托管

```typescript
/**
 * 多签托管
 */
class MultiSigEscrow {
  /**
   * 创建多签托管
   */
  async create(config: MultiSigEscrowConfig): Promise<MultiSigEscrowAccount> {
    // 验证签名者
    if (config.signers.length < config.threshold) {
      throw new Error('Not enough signers for threshold');
    }
    
    const escrow: MultiSigEscrowAccount = {
      ...await this.createBaseEscrow(config),
      
      multiSig: {
        signers: config.signers,
        threshold: config.threshold,
        
        pendingOperations: [],
        completedOperations: [],
      },
    };
    
    return escrow;
  }
  
  /**
   * 提议操作
   */
  async proposeOperation(
    escrowId: string,
    operation: EscrowOperation,
  ): Promise<PendingOperation> {
    const escrow = await this.getEscrow(escrowId);
    
    // 验证提议者是签名者
    const proposer = this.wallet.getDefaultAddress();
    if (!escrow.multiSig.signers.includes(proposer)) {
      throw new Error('Only signers can propose operations');
    }
    
    const pending: PendingOperation = {
      id: generateId(),
      operation,
      proposer,
      proposedAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,  // 7 天过期
      signatures: [{
        signer: proposer,
        signature: await this.sign(operation),
        signedAt: Date.now(),
      }],
      status: 'pending',
    };
    
    escrow.multiSig.pendingOperations.push(pending);
    await this.saveEscrow(escrow);
    
    // 通知其他签名者
    await this.notifySigners(escrow, pending);
    
    return pending;
  }
  
  /**
   * 签名操作
   */
  async signOperation(
    escrowId: string,
    operationId: string,
  ): Promise<PendingOperation> {
    const escrow = await this.getEscrow(escrowId);
    const pending = escrow.multiSig.pendingOperations.find(p => p.id === operationId);
    
    if (!pending) {
      throw new Error('Operation not found');
    }
    
    const signer = this.wallet.getDefaultAddress();
    
    // 验证是签名者
    if (!escrow.multiSig.signers.includes(signer)) {
      throw new Error('Not a valid signer');
    }
    
    // 验证未签名
    if (pending.signatures.some(s => s.signer === signer)) {
      throw new Error('Already signed');
    }
    
    // 添加签名
    pending.signatures.push({
      signer,
      signature: await this.sign(pending.operation),
      signedAt: Date.now(),
    });
    
    // 检查是否达到阈值
    if (pending.signatures.length >= escrow.multiSig.threshold) {
      await this.executeOperation(escrow, pending);
    }
    
    await this.saveEscrow(escrow);
    
    return pending;
  }
  
  /**
   * 执行操作
   */
  private async executeOperation(
    escrow: MultiSigEscrowAccount,
    pending: PendingOperation,
  ): Promise<void> {
    const op = pending.operation;
    
    switch (op.type) {
      case 'release':
        await this.escrowSystem.releaseEscrow(
          escrow.id,
          undefined,
          JSON.stringify(pending.signatures),
        );
        break;
        
      case 'refund':
        await this.escrowSystem.refundEscrow(escrow.id, op.reason);
        break;
        
      case 'change_beneficiary':
        escrow.beneficiary = op.newBeneficiary;
        break;
        
      case 'extend_expiry':
        escrow.expiresAt = op.newExpiry;
        break;
    }
    
    pending.status = 'executed';
    pending.executedAt = Date.now();
    
    // 移动到已完成
    escrow.multiSig.pendingOperations = escrow.multiSig.pendingOperations
      .filter(p => p.id !== pending.id);
    escrow.multiSig.completedOperations.push(pending);
  }
}
```

---

## 权限控制

### 权限管理器

```typescript
/**
 * 权限管理
 */
class PermissionManager {
  private wallet: ClawWallet;
  
  /**
   * 检查权限
   */
  async checkPermission(
    action: PermissionAction,
    context: PermissionContext,
  ): Promise<void> {
    const permissions = this.wallet.permissions;
    
    switch (action) {
      case 'transfer':
        await this.checkTransferPermission(context);
        break;
        
      case 'escrow_create':
        await this.checkEscrowPermission(context);
        break;
        
      case 'sign':
        await this.checkSignPermission(context);
        break;
        
      case 'export_key':
        await this.checkExportPermission(context);
        break;
    }
  }
  
  /**
   * 检查转账权限
   */
  private async checkTransferPermission(context: PermissionContext): Promise<void> {
    const limits = this.wallet.permissions.spending;
    const amount = context.amount!;
    
    // 单笔限额
    if (limits.maxPerTransaction && amount > limits.maxPerTransaction) {
      throw new PermissionError(
        'EXCEEDS_SINGLE_LIMIT',
        `Amount ${amount} exceeds single transaction limit ${limits.maxPerTransaction}`,
      );
    }
    
    // 每日限额
    if (limits.maxDaily) {
      const todaySpent = await this.getTodaySpent();
      if (todaySpent + amount > limits.maxDaily) {
        throw new PermissionError(
          'EXCEEDS_DAILY_LIMIT',
          `Would exceed daily limit. Spent: ${todaySpent}, Limit: ${limits.maxDaily}`,
        );
      }
    }
    
    // 白名单检查
    if (limits.whitelist && limits.whitelist.length > 0) {
      if (!limits.whitelist.includes(context.to!)) {
        throw new PermissionError(
          'NOT_WHITELISTED',
          `Recipient ${context.to} is not in whitelist`,
        );
      }
    }
    
    // 黑名单检查
    if (limits.blacklist && limits.blacklist.includes(context.to!)) {
      throw new PermissionError(
        'BLACKLISTED',
        `Recipient ${context.to} is blacklisted`,
      );
    }
    
    // 时间窗口
    if (limits.allowedTimeWindows) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentDay = now.getDay();
      
      const allowed = limits.allowedTimeWindows.some(window => {
        const dayMatch = window.days.includes(currentDay);
        const hourMatch = currentHour >= window.startHour && currentHour < window.endHour;
        return dayMatch && hourMatch;
      });
      
      if (!allowed) {
        throw new PermissionError(
          'OUTSIDE_TIME_WINDOW',
          'Transfer not allowed at this time',
        );
      }
    }
    
    // 需要额外授权
    if (limits.requireApprovalAbove && amount > limits.requireApprovalAbove) {
      await this.requestApproval(context);
    }
  }
  
  /**
   * 设置支出限额
   */
  async setSpendingLimits(limits: SpendingLimits): Promise<void> {
    // 需要主密钥签名
    await this.requireMasterKeyAuth();
    
    this.wallet.permissions.spending = {
      ...this.wallet.permissions.spending,
      ...limits,
    };
    
    await this.saveWallet();
  }
  
  /**
   * 添加白名单
   */
  async addToWhitelist(addresses: string[]): Promise<void> {
    const whitelist = this.wallet.permissions.spending.whitelist || [];
    this.wallet.permissions.spending.whitelist = [...new Set([...whitelist, ...addresses])];
    await this.saveWallet();
  }
  
  /**
   * 移除白名单
   */
  async removeFromWhitelist(addresses: string[]): Promise<void> {
    const whitelist = this.wallet.permissions.spending.whitelist || [];
    this.wallet.permissions.spending.whitelist = whitelist.filter(
      addr => !addresses.includes(addr)
    );
    await this.saveWallet();
  }
  
  /**
   * 创建授权密钥
   */
  async createAuthorizedKey(config: AuthorizedKeyConfig): Promise<AuthorizedKey> {
    const key = await this.keyManager.deriveKey(
      this.wallet.operationalKeyId,
      `m/auth/${Date.now()}`,
    );
    
    const authorizedKey: AuthorizedKey = {
      id: key.id,
      publicKey: key.publicKey,
      permissions: config.permissions,
      restrictions: {
        maxAmount: config.maxAmount,
        maxDaily: config.maxDaily,
        allowedRecipients: config.allowedRecipients,
        allowedOperations: config.allowedOperations,
        expiresAt: config.expiresAt,
      },
      createdAt: Date.now(),
      createdBy: this.wallet.ownerDID,
      status: 'active',
    };
    
    this.wallet.permissions.authorizedKeys.push(authorizedKey);
    await this.saveWallet();
    
    return authorizedKey;
  }
  
  /**
   * 撤销授权密钥
   */
  async revokeAuthorizedKey(keyId: string): Promise<void> {
    const key = this.wallet.permissions.authorizedKeys.find(k => k.id === keyId);
    if (!key) {
      throw new Error('Authorized key not found');
    }
    
    key.status = 'revoked';
    key.revokedAt = Date.now();
    
    await this.keyManager.revokeKey(keyId);
    await this.saveWallet();
  }
}

/**
 * 权限数据结构
 */
interface WalletPermissions {
  // 支出限制
  spending: SpendingLimits;
  
  // 授权密钥
  authorizedKeys: AuthorizedKey[];
  
  // 多签要求
  multiSig?: {
    enabled: boolean;
    threshold: number;
    signers: string[];
  };
  
  // 时间锁
  timeLock?: {
    largeTransactionDelay: number;  // 大额交易延迟
    largeTransactionThreshold: bigint;
  };
}

interface SpendingLimits {
  // 单笔限额
  maxPerTransaction?: bigint;
  
  // 每日限额
  maxDaily?: bigint;
  
  // 每周限额
  maxWeekly?: bigint;
  
  // 每月限额
  maxMonthly?: bigint;
  
  // 白名单
  whitelist?: string[];
  
  // 黑名单
  blacklist?: string[];
  
  // 需要审批的金额
  requireApprovalAbove?: bigint;
  
  // 允许的时间窗口
  allowedTimeWindows?: {
    days: number[];          // 0-6, 0=周日
    startHour: number;       // 0-23
    endHour: number;         // 0-23
  }[];
}
```

---

## 恢复机制

### 恢复配置

```typescript
/**
 * 恢复配置
 */
interface RecoveryConfig {
  // 恢复方式
  methods: RecoveryMethod[];
  
  // 社交恢复
  socialRecovery?: {
    guardians: Guardian[];
    threshold: number;
    timelock: number;  // 恢复延迟
  };
  
  // 备份
  backup?: {
    encrypted: boolean;
    locations: BackupLocation[];
    lastBackupAt?: number;
  };
}

interface Guardian {
  id: string;
  did: string;
  name?: string;
  addedAt: number;
  weight: number;
}

interface BackupLocation {
  type: 'local' | 'cloud' | 'hardware';
  identifier: string;
  encryptedShare?: string;
}

/**
 * 恢复管理器
 */
class RecoveryManager {
  /**
   * 设置社交恢复
   */
  async setupSocialRecovery(config: SocialRecoveryConfig): Promise<void> {
    // 验证守护者数量
    if (config.guardians.length < config.threshold) {
      throw new Error('Not enough guardians for threshold');
    }
    
    // 分割恢复密钥（Shamir's Secret Sharing）
    const recoveryKey = await this.keyManager.getRecoveryKey();
    const shares = await this.splitSecret(
      recoveryKey,
      config.guardians.length,
      config.threshold,
    );
    
    // 加密并分发分片给守护者
    for (let i = 0; i < config.guardians.length; i++) {
      const guardian = config.guardians[i];
      const encryptedShare = await this.encryptForGuardian(shares[i], guardian.did);
      
      await this.distributeShare(guardian.did, encryptedShare);
    }
    
    // 保存配置
    this.wallet.recovery.socialRecovery = {
      guardians: config.guardians,
      threshold: config.threshold,
      timelock: config.timelock || 24 * 60 * 60 * 1000,  // 默认24小时
    };
    
    await this.saveWallet();
  }
  
  /**
   * 发起恢复
   */
  async initiateRecovery(newOwnerDID: string): Promise<RecoveryRequest> {
    const request: RecoveryRequest = {
      id: generateId(),
      walletId: this.wallet.id,
      newOwnerDID,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,  // 7天过期
      approvals: [],
    };
    
    // 通知所有守护者
    for (const guardian of this.wallet.recovery.socialRecovery!.guardians) {
      await this.notifyGuardian(guardian, request);
    }
    
    await this.saveRecoveryRequest(request);
    
    return request;
  }
  
  /**
   * 守护者批准恢复
   */
  async approveRecovery(
    requestId: string,
    guardianDID: string,
    encryptedShare: string,
  ): Promise<RecoveryRequest> {
    const request = await this.getRecoveryRequest(requestId);
    const socialRecovery = this.wallet.recovery.socialRecovery!;
    
    // 验证守护者
    const guardian = socialRecovery.guardians.find(g => g.did === guardianDID);
    if (!guardian) {
      throw new Error('Not a valid guardian');
    }
    
    // 添加批准
    request.approvals.push({
      guardianId: guardian.id,
      guardianDID,
      encryptedShare,
      approvedAt: Date.now(),
    });
    
    // 检查是否达到阈值
    if (request.approvals.length >= socialRecovery.threshold) {
      // 开始时间锁
      request.status = 'approved';
      request.timelockEndsAt = Date.now() + socialRecovery.timelock;
    }
    
    await this.saveRecoveryRequest(request);
    
    return request;
  }
  
  /**
   * 完成恢复
   */
  async completeRecovery(requestId: string): Promise<void> {
    const request = await this.getRecoveryRequest(requestId);
    
    // 检查状态
    if (request.status !== 'approved') {
      throw new Error('Recovery not approved');
    }
    
    // 检查时间锁
    if (Date.now() < request.timelockEndsAt!) {
      throw new Error(`Timelock not expired. Wait until ${new Date(request.timelockEndsAt!)}`);
    }
    
    // 收集分片
    const shares = request.approvals.map(a => a.encryptedShare);
    
    // 解密分片
    const decryptedShares = await Promise.all(
      shares.map(s => this.decryptShare(s, request.newOwnerDID))
    );
    
    // 重建恢复密钥
    const recoveryKey = await this.combineShares(decryptedShares);
    
    // 派生新的主密钥
    const newMasterKey = await this.keyManager.deriveNewMasterKey(recoveryKey);
    
    // 更新钱包
    this.wallet.ownerDID = request.newOwnerDID;
    this.wallet.masterKeyId = newMasterKey.id;
    
    // 轮换所有派生密钥
    await this.rotateAllKeys(newMasterKey);
    
    // 标记恢复完成
    request.status = 'completed';
    request.completedAt = Date.now();
    
    await this.saveWallet();
    await this.saveRecoveryRequest(request);
  }
  
  /**
   * 创建备份
   */
  async createBackup(password: string): Promise<EncryptedBackup> {
    // 导出钱包数据
    const walletData = await this.exportWalletData();
    
    // 加密
    const salt = crypto.randomBytes(32);
    const key = await this.deriveBackupKey(password, salt);
    const encrypted = await this.encrypt(walletData, key);
    
    const backup: EncryptedBackup = {
      version: '1.0',
      algorithm: 'AES-256-GCM',
      salt: salt.toString('base64'),
      data: encrypted.toString('base64'),
      checksum: await sha256(encrypted),
      createdAt: Date.now(),
      walletId: this.wallet.id,
    };
    
    // 更新备份时间
    this.wallet.recovery.backup = {
      ...this.wallet.recovery.backup,
      lastBackupAt: Date.now(),
    };
    
    await this.saveWallet();
    
    return backup;
  }
  
  /**
   * 从备份恢复
   */
  async restoreFromBackup(backup: EncryptedBackup, password: string): Promise<ClawWallet> {
    // 验证备份
    const dataBuffer = Buffer.from(backup.data, 'base64');
    const checksum = await sha256(dataBuffer);
    
    if (checksum !== backup.checksum) {
      throw new Error('Backup corrupted');
    }
    
    // 解密
    const salt = Buffer.from(backup.salt, 'base64');
    const key = await this.deriveBackupKey(password, salt);
    const decrypted = await this.decrypt(dataBuffer, key);
    
    // 恢复钱包
    const walletData = JSON.parse(decrypted.toString());
    const wallet = await this.importWalletData(walletData);
    
    return wallet;
  }
}
```

---

## 通知系统

```typescript
/**
 * 通知管理器
 */
class NotificationManager {
  private subscribers: Map<string, NotificationHandler[]> = new Map();
  
  /**
   * 订阅通知
   */
  subscribe(event: NotificationEvent, handler: NotificationHandler): Unsubscribe {
    const handlers = this.subscribers.get(event) || [];
    handlers.push(handler);
    this.subscribers.set(event, handlers);
    
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
  }
  
  /**
   * 发送通知
   */
  async notify(event: NotificationEvent, data: any): Promise<void> {
    const handlers = this.subscribers.get(event) || [];
    
    for (const handler of handlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error(`Notification handler error:`, error);
      }
    }
    
    // 持久化通知
    await this.saveNotification({
      id: generateId(),
      event,
      data,
      createdAt: Date.now(),
      read: false,
    });
  }
  
  /**
   * 获取通知列表
   */
  async getNotifications(options?: NotificationQueryOptions): Promise<Notification[]> {
    return await this.storage.query('notifications', {
      unreadOnly: options?.unreadOnly,
      limit: options?.limit || 50,
      offset: options?.offset || 0,
    });
  }
  
  /**
   * 标记已读
   */
  async markAsRead(notificationIds: string[]): Promise<void> {
    for (const id of notificationIds) {
      await this.storage.update('notifications', id, { read: true, readAt: Date.now() });
    }
  }
}

type NotificationEvent = 
  | 'transfer_sent'
  | 'transfer_received'
  | 'transfer_confirmed'
  | 'transfer_failed'
  | 'escrow_created'
  | 'escrow_funded'
  | 'escrow_released'
  | 'escrow_disputed'
  | 'low_balance'
  | 'security_alert'
  | 'recovery_initiated'
  | 'guardian_added'
  | 'key_rotated';
```

---

## API 参考

### 钱包初始化

```typescript
import { ClawWallet } from '@claw-network/wallet';

// 创建新钱包
const wallet = await ClawWallet.create({
  ownerDID: 'did:claw:z6Mk...',
  network: 'mainnet',
  password: 'secure-password',
});

// 从助记词恢复
const wallet = await ClawWallet.fromMnemonic(
  'word1 word2 word3 ...',
  { network: 'mainnet' },
);

// 从备份恢复
const wallet = await ClawWallet.fromBackup(
  encryptedBackup,
  'backup-password',
);

// 加载已有钱包
const wallet = await ClawWallet.load(
  './wallet.json',
  'password',
);
```

### 基本操作

```typescript
// 获取余额
const balance = await wallet.getBalance();
console.log(`可用: ${formatToken(balance.available)}`);
console.log(`锁定: ${formatToken(balance.locked.total)}`);

// 转账
const tx = await wallet.transfer({
  to: 'claw1abc...def',
  amount: 100n,
  memo: '付款',
});

// 等待确认
await tx.waitForConfirmation();

// 批量转账
const results = await wallet.batchTransfer([
  { to: 'claw1...', amount: 10n },
  { to: 'claw2...', amount: 20n },
  { to: 'claw3...', amount: 30n },
]);

// 交易历史
const history = await wallet.getHistory({
  limit: 20,
  startDate: Date.now() - 30 * 24 * 60 * 60 * 1000,
});
```

### 托管操作

```typescript
// 创建托管
const escrow = await wallet.createEscrow({
  beneficiary: 'claw1provider...',
  amount: 500n,
  releaseRules: [
    {
      amount: { percentage: 50 },
      condition: { type: 'approval', approvers: ['client'], threshold: 1 },
    },
    {
      amount: { percentage: 50 },
      condition: { type: 'milestone', milestoneId: 'delivery' },
    },
  ],
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
});

// 释放托管
await wallet.releaseEscrow(escrow.id);

// 发起争议
await wallet.disputeEscrow(escrow.id, '未按要求交付', [
  { type: 'screenshot', url: '...' },
]);
```

### 安全设置

```typescript
// 设置支出限额
await wallet.setSpendingLimits({
  maxPerTransaction: 1000n,
  maxDaily: 5000n,
  requireApprovalAbove: 500n,
});

// 添加白名单
await wallet.addToWhitelist(['claw1trusted...', 'claw1partner...']);

// 创建授权密钥
const authKey = await wallet.createAuthorizedKey({
  maxAmount: 100n,
  maxDaily: 500n,
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  allowedOperations: ['transfer'],
});

// 设置社交恢复
await wallet.setupSocialRecovery({
  guardians: [
    { did: 'did:claw:guardian1...', weight: 1 },
    { did: 'did:claw:guardian2...', weight: 1 },
    { did: 'did:claw:guardian3...', weight: 1 },
  ],
  threshold: 2,
  timelock: 48 * 60 * 60 * 1000,  // 48小时
});

// 创建备份
const backup = await wallet.createBackup('backup-password');
await fs.writeFile('wallet-backup.json', JSON.stringify(backup));
```

---

## 安全最佳实践

### 密钥安全

```
✅ 推荐做法:
• 主密钥离线冷存储
• 使用硬件安全模块 (HSM) 存储密钥
• 定期轮换操作密钥
• 使用强密码保护钱包
• 启用社交恢复

❌ 避免:
• 在代码中硬编码密钥
• 在日志中打印密钥
• 通过不安全通道传输密钥
• 使用弱密码
• 单点密钥存储
```

### 交易安全

```
✅ 推荐做法:
• 设置合理的支出限额
• 大额交易使用多签
• 验证接收方地址
• 使用白名单限制接收方
• 等待足够确认数

❌ 避免:
• 无限额的自动转账
• 忽略地址验证
• 使用过低的确认数
• 在不安全网络环境操作
```

### 恢复安全

```
✅ 推荐做法:
• 多地点存储备份
• 使用不同的守护者
• 设置合理的时间锁
• 定期测试恢复流程
• 加密所有备份

❌ 避免:
• 单一备份位置
• 守护者之间有关联
• 时间锁过短
• 从未测试恢复
• 明文存储助记词
```

---

## 相关文档

- [AGENT_RUNTIME.md](AGENT_RUNTIME.md) — 节点运行与 API 调用
- [IDENTITY.md](IDENTITY.md) — 身份系统
- [SERVICE_CONTRACTS.md](SERVICE_CONTRACTS.md) — 服务合约（托管相关）

---

## 总结

ClawWallet 提供了完整的 Agent 钱包解决方案：

| 功能 | 描述 |
|------|------|
| **账户管理** | 多账户、多币种、余额追踪 |
| **交易引擎** | 即时/批量/定时转账 |
| **托管系统** | 条件托管、多签托管、争议处理 |
| **密钥管理** | 分层密钥、安全存储、轮换机制 |
| **权限控制** | 限额、白名单、时间窗口、授权密钥 |
| **恢复机制** | 社交恢复、加密备份 |
| **审计日志** | 完整历史、可验证、可导出 |

这套系统让 AI Agents 能够安全、灵活地管理自己的经济活动。

---

*最后更新: 2026年2月1日*
