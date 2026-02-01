/**
 * 信誉系统模块
 * 计算和管理 AI Agent 的信誉分数
 */

import { EventEmitter } from 'events';
import {
  AgentId,
  AgentTrustProfile,
  Capability,
  ExternalReputation,
  ServiceType,
  ApiResponse,
} from './types';

// ============================================
// 信誉计算权重
// ============================================

export interface TrustWeights {
  reliability: number;    // 可靠性
  quality: number;        // 质量
  speed: number;          // 速度
  volume: number;         // 交易量
  age: number;            // 账户年龄
}

export const DEFAULT_WEIGHTS: TrustWeights = {
  reliability: 0.35,
  quality: 0.25,
  speed: 0.15,
  volume: 0.15,
  age: 0.10,
};

// ============================================
// 信誉事件
// ============================================

export interface TrustUpdate {
  agentId: AgentId;
  previousScore: number;
  newScore: number;
  reason: string;
  timestamp: number;
}

// ============================================
// TrustSystem 实现
// ============================================

export class TrustSystem extends EventEmitter {
  private profiles: Map<AgentId, AgentTrustProfile> = new Map();
  private weights: TrustWeights = DEFAULT_WEIGHTS;
  
  /**
   * 设置权重
   */
  setWeights(weights: Partial<TrustWeights>): void {
    this.weights = { ...this.weights, ...weights };
    
    // 确保权重总和为 1
    const total = Object.values(this.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1) > 0.001) {
      console.warn(`Warning: Weights sum to ${total}, not 1.0`);
    }
  }
  
  /**
   * 注册新 Agent
   */
  async register(
    agentId: AgentId,
    displayName: string,
    description?: string
  ): Promise<ApiResponse<AgentTrustProfile>> {
    if (this.profiles.has(agentId)) {
      return {
        success: false,
        error: { code: 'ALREADY_EXISTS', message: 'Agent already registered' },
      };
    }
    
    const profile: AgentTrustProfile = {
      agentId,
      displayName,
      description,
      
      // 初始信誉
      trustScore: 100,  // 新用户起始分
      reliability: 1.0,
      responseTime: 0,
      qualityRating: 3.0,  // 中等评分
      
      // 历史
      completedTransactions: 0,
      failedTransactions: 0,
      disputeCount: 0,
      disputeRate: 0,
      totalValueExchanged: BigInt(0),
      
      createdAt: Date.now(),
      verifiedCapabilities: [],
    };
    
    this.profiles.set(agentId, profile);
    this.emit('registered', profile);
    
    return { success: true, data: profile };
  }
  
  /**
   * 获取 Agent 信誉
   */
  getProfile(agentId: AgentId): AgentTrustProfile | undefined {
    return this.profiles.get(agentId);
  }
  
  /**
   * 获取信誉分数
   */
  getTrustScore(agentId: AgentId): number {
    const profile = this.profiles.get(agentId);
    return profile?.trustScore ?? 0;
  }
  
  /**
   * 交易完成后更新信誉
   */
  async recordTransaction(
    agentId: AgentId,
    success: boolean,
    rating: number,
    responseTimeSeconds: number,
    value: bigint
  ): Promise<ApiResponse<TrustUpdate>> {
    const profile = this.profiles.get(agentId);
    
    if (!profile) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      };
    }
    
    const previousScore = profile.trustScore;
    
    // 更新历史
    if (success) {
      profile.completedTransactions++;
    } else {
      profile.failedTransactions++;
    }
    
    const totalTx = profile.completedTransactions + profile.failedTransactions;
    
    // 更新可靠性
    profile.reliability = profile.completedTransactions / Math.max(1, totalTx);
    
    // 更新响应时间 (移动平均)
    const alpha = 0.1;  // 平滑因子
    profile.responseTime = profile.responseTime === 0
      ? responseTimeSeconds
      : profile.responseTime * (1 - alpha) + responseTimeSeconds * alpha;
    
    // 更新质量评分 (移动平均)
    profile.qualityRating = profile.qualityRating * (1 - alpha) + rating * alpha;
    
    // 更新交易量
    profile.totalValueExchanged += value;
    
    // 重新计算信誉分数
    profile.trustScore = this.calculateScore(profile);
    
    const update: TrustUpdate = {
      agentId,
      previousScore,
      newScore: profile.trustScore,
      reason: success ? 'Transaction completed' : 'Transaction failed',
      timestamp: Date.now(),
    };
    
    this.emit('updated', update);
    
    return { success: true, data: update };
  }
  
  /**
   * 记录争议
   */
  async recordDispute(
    agentId: AgentId,
    isGuilty: boolean
  ): Promise<ApiResponse<TrustUpdate>> {
    const profile = this.profiles.get(agentId);
    
    if (!profile) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      };
    }
    
    const previousScore = profile.trustScore;
    
    profile.disputeCount++;
    
    const totalTx = profile.completedTransactions + profile.failedTransactions;
    profile.disputeRate = profile.disputeCount / Math.max(1, totalTx);
    
    // 如果有责任，降低信誉
    if (isGuilty) {
      profile.trustScore = Math.max(0, profile.trustScore - 50);
    }
    
    const update: TrustUpdate = {
      agentId,
      previousScore,
      newScore: profile.trustScore,
      reason: isGuilty ? 'Lost dispute' : 'Won dispute',
      timestamp: Date.now(),
    };
    
    this.emit('dispute_recorded', update);
    
    return { success: true, data: update };
  }
  
  /**
   * 添加验证的能力
   */
  async addCapability(
    agentId: AgentId,
    capability: Omit<Capability, 'verified' | 'verificationMethod'>
  ): Promise<ApiResponse<Capability>> {
    const profile = this.profiles.get(agentId);
    
    if (!profile) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      };
    }
    
    const fullCapability: Capability = {
      ...capability,
      verified: false,
      verificationMethod: 'self_declared',
    };
    
    profile.verifiedCapabilities.push(fullCapability);
    
    this.emit('capability_added', { agentId, capability: fullCapability });
    
    return { success: true, data: fullCapability };
  }
  
  /**
   * 验证能力
   */
  async verifyCapability(
    agentId: AgentId,
    capabilityId: string,
    method: 'peer_reviewed' | 'platform_verified'
  ): Promise<ApiResponse<Capability>> {
    const profile = this.profiles.get(agentId);
    
    if (!profile) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      };
    }
    
    const capability = profile.verifiedCapabilities.find(c => c.id === capabilityId);
    
    if (!capability) {
      return {
        success: false,
        error: { code: 'CAPABILITY_NOT_FOUND', message: 'Capability not found' },
      };
    }
    
    capability.verified = true;
    capability.verificationMethod = method;
    
    // 验证的能力增加一点信誉
    profile.trustScore = Math.min(1000, profile.trustScore + 5);
    
    this.emit('capability_verified', { agentId, capability });
    
    return { success: true, data: capability };
  }
  
  /**
   * 导入外部信誉
   */
  async importExternalReputation(
    agentId: AgentId,
    external: ExternalReputation
  ): Promise<ApiResponse<AgentTrustProfile>> {
    const profile = this.profiles.get(agentId);
    
    if (!profile) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      };
    }
    
    profile.externalReputation = {
      ...profile.externalReputation,
      ...external,
    };
    
    // 根据外部信誉调整分数
    let bonus = 0;
    
    if (external.moltbookKarma) {
      // Moltbook karma 转换 (对数尺度)
      bonus += Math.min(50, Math.log10(external.moltbookKarma + 1) * 10);
    }
    
    if (external.openclawVerified) {
      bonus += 20;
    }
    
    if (external.github?.verified) {
      bonus += Math.min(30, Math.log10(external.github.stars + 1) * 5);
    }
    
    const previousScore = profile.trustScore;
    profile.trustScore = Math.min(1000, profile.trustScore + bonus);
    
    this.emit('external_imported', {
      agentId,
      previousScore,
      newScore: profile.trustScore,
      reason: 'External reputation imported',
      timestamp: Date.now(),
    });
    
    return { success: true, data: profile };
  }
  
  /**
   * 计算信誉分数
   */
  private calculateScore(profile: AgentTrustProfile): number {
    const w = this.weights;
    
    // 可靠性: 0-1
    const reliabilityScore = profile.reliability;
    
    // 质量: 0-1 (从 0-5 评分转换)
    const qualityScore = profile.qualityRating / 5;
    
    // 速度: 0-1 (假设期望响应时间为 60 秒)
    const expectedTime = 60;
    const speedScore = 1 / (1 + profile.responseTime / expectedTime);
    
    // 交易量: 0-1 (对数尺度，100万 Token 视为满分)
    const volumeScore = Math.min(1, Math.log10(Number(profile.totalValueExchanged) / 1000000 + 1));
    
    // 账户年龄: 0-1 (365 天视为成熟)
    const ageInDays = (Date.now() - profile.createdAt) / (24 * 60 * 60 * 1000);
    const ageScore = Math.min(1, ageInDays / 365);
    
    // 加权计算
    const rawScore = 
      w.reliability * reliabilityScore +
      w.quality * qualityScore +
      w.speed * speedScore +
      w.volume * volumeScore +
      w.age * ageScore;
    
    // 争议惩罚
    const disputePenalty = Math.min(0.5, profile.disputeRate * 5);
    
    // 最终分数 (0-1000)
    const finalScore = Math.round(rawScore * 1000 * (1 - disputePenalty));
    
    return Math.max(0, Math.min(1000, finalScore));
  }
  
  /**
   * 获取信誉排行榜
   */
  getLeaderboard(limit: number = 100): AgentTrustProfile[] {
    return Array.from(this.profiles.values())
      .sort((a, b) => b.trustScore - a.trustScore)
      .slice(0, limit);
  }
  
  /**
   * 按能力搜索 Agent
   */
  searchByCapability(
    category: ServiceType,
    minTrustScore: number = 0
  ): AgentTrustProfile[] {
    return Array.from(this.profiles.values())
      .filter(p => 
        p.trustScore >= minTrustScore &&
        p.verifiedCapabilities.some(c => c.category === category)
      )
      .sort((a, b) => b.trustScore - a.trustScore);
  }
}

// ============================================
// 新手限制检查
// ============================================

export interface NewAgentRestrictions {
  maxTransactionValue: bigint;
  maxTransactionsPerDay: number;
  requiresEscrow: boolean;
}

export function getRestrictions(profile: AgentTrustProfile): NewAgentRestrictions | null {
  const ageInDays = (Date.now() - profile.createdAt) / (24 * 60 * 60 * 1000);
  
  if (ageInDays < 7) {
    // 前 7 天
    return {
      maxTransactionValue: BigInt(100_000_000), // 100 Token
      maxTransactionsPerDay: 10,
      requiresEscrow: true,
    };
  } else if (ageInDays < 30) {
    // 7-30 天
    return {
      maxTransactionValue: BigInt(1000_000_000), // 1000 Token
      maxTransactionsPerDay: 50,
      requiresEscrow: true,
    };
  } else if (profile.trustScore < 300) {
    // 低信誉用户
    return {
      maxTransactionValue: BigInt(500_000_000), // 500 Token
      maxTransactionsPerDay: 30,
      requiresEscrow: true,
    };
  }
  
  // 无限制
  return null;
}

// ============================================
// 导出
// ============================================

export const trustSystem = new TrustSystem();
export default trustSystem;
