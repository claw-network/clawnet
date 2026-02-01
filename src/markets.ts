/**
 * 市场模块 - 信息市场、任务市场、能力市场
 * 让 AI Agents 可以交易信息、雇佣彼此、租用能力
 */

import { EventEmitter } from 'events';
import {
  AgentId,
  ListingId,
  InfoListing,
  TaskListing,
  CapabilityListing,
  InfoCategory,
  TaskType,
  ServiceType,
  ListingStatus,
  Bid,
  ApiResponse,
  PaginatedResponse,
} from './types';

// ============================================
// 信息市场
// ============================================

export interface InfoSearchOptions {
  category?: InfoCategory;
  topic?: string;
  maxPrice?: bigint;
  minRating?: number;
  seller?: AgentId;
  tags?: string[];
  sortBy?: 'price' | 'rating' | 'freshness' | 'popularity';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export class InfoMarket extends EventEmitter {
  private listings: Map<ListingId, InfoListing> = new Map();
  
  /**
   * 搜索信息列表
   */
  async search(options: InfoSearchOptions): Promise<PaginatedResponse<InfoListing>> {
    let results = Array.from(this.listings.values())
      .filter(l => l.status === ListingStatus.ACTIVE);
    
    // 应用过滤器
    if (options.category) {
      results = results.filter(l => l.metadata.category === options.category);
    }
    if (options.topic) {
      results = results.filter(l => 
        l.metadata.topic.toLowerCase().includes(options.topic!.toLowerCase())
      );
    }
    if (options.maxPrice !== undefined) {
      results = results.filter(l => l.price <= options.maxPrice!);
    }
    if (options.minRating !== undefined && options.minRating > 0) {
      results = results.filter(l => 
        l.valueProof && l.valueProof.avgRating >= options.minRating!
      );
    }
    if (options.seller) {
      results = results.filter(l => l.seller === options.seller);
    }
    if (options.tags && options.tags.length > 0) {
      results = results.filter(l => 
        options.tags!.some(tag => l.metadata.tags.includes(tag))
      );
    }
    
    // 排序
    const sortBy = options.sortBy ?? 'popularity';
    const sortOrder = options.sortOrder ?? 'desc';
    
    results.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'price':
          comparison = Number(a.price - b.price);
          break;
        case 'rating':
          comparison = (a.valueProof?.avgRating ?? 0) - (b.valueProof?.avgRating ?? 0);
          break;
        case 'freshness':
          comparison = a.metadata.freshness - b.metadata.freshness;
          break;
        case 'popularity':
          comparison = (a.valueProof?.usageCount ?? 0) - (b.valueProof?.usageCount ?? 0);
          break;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });
    
    // 分页
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const total = results.length;
    const start = (page - 1) * pageSize;
    const data = results.slice(start, start + pageSize);
    
    return {
      data,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    };
  }
  
  /**
   * 创建信息列表
   */
  async create(listing: Omit<InfoListing, 'listingId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<ApiResponse<InfoListing>> {
    const newListing: InfoListing = {
      ...listing,
      listingId: this.generateListingId(),
      status: ListingStatus.ACTIVE,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    this.listings.set(newListing.listingId, newListing);
    this.emit('listing_created', newListing);
    
    return { success: true, data: newListing };
  }
  
  /**
   * 购买信息
   */
  async purchase(
    listingId: ListingId,
    buyer: AgentId
  ): Promise<ApiResponse<{ content: string; transaction: unknown }>> {
    const listing = this.listings.get(listingId);
    
    if (!listing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Listing not found' },
      };
    }
    
    if (listing.status !== ListingStatus.ACTIVE) {
      return {
        success: false,
        error: { code: 'NOT_AVAILABLE', message: 'Listing is not available' },
      };
    }
    
    // TODO: 实现支付逻辑
    // 1. 验证买家余额
    // 2. 创建交易
    // 3. 解密内容
    // 4. 更新统计
    
    this.emit('purchase', { listing, buyer });
    
    return {
      success: true,
      data: {
        content: listing.encryptedContent ?? 'Decrypted content here',
        transaction: {},
      },
    };
  }
  
  /**
   * 评价信息
   */
  async rate(
    listingId: ListingId,
    buyer: AgentId,
    rating: number,
    comment?: string
  ): Promise<ApiResponse<void>> {
    const listing = this.listings.get(listingId);
    
    if (!listing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Listing not found' },
      };
    }
    
    if (!listing.valueProof) {
      listing.valueProof = {
        usageCount: 0,
        avgRating: 0,
        testimonials: [],
      };
    }
    
    // 添加评价
    listing.valueProof.testimonials.push({
      agentId: buyer,
      rating,
      comment: comment ?? '',
      timestamp: Date.now(),
    });
    
    // 更新平均评分
    const ratings = listing.valueProof.testimonials.map(t => t.rating);
    listing.valueProof.avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    listing.valueProof.usageCount++;
    
    listing.updatedAt = Date.now();
    
    this.emit('rated', { listing, buyer, rating });
    
    return { success: true };
  }
  
  private generateListingId(): ListingId {
    return `info_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

// ============================================
// 任务市场
// ============================================

export interface TaskSearchOptions {
  type?: TaskType;
  maxBudget?: bigint;
  minBudget?: bigint;
  client?: AgentId;
  requiredCapabilities?: string[];
  minTrustScore?: number;
  sortBy?: 'budget' | 'deadline' | 'created';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export class TaskMarket extends EventEmitter {
  private listings: Map<ListingId, TaskListing> = new Map();
  
  /**
   * 搜索任务
   */
  async search(options: TaskSearchOptions): Promise<PaginatedResponse<TaskListing>> {
    let results = Array.from(this.listings.values())
      .filter(l => l.status === ListingStatus.ACTIVE);
    
    if (options.type) {
      results = results.filter(l => l.task.type === options.type);
    }
    if (options.maxBudget !== undefined) {
      results = results.filter(l => l.budget.max <= options.maxBudget!);
    }
    if (options.minBudget !== undefined) {
      results = results.filter(l => l.budget.min >= options.minBudget!);
    }
    if (options.client) {
      results = results.filter(l => l.client === options.client);
    }
    
    // 排序
    const sortBy = options.sortBy ?? 'created';
    const sortOrder = options.sortOrder ?? 'desc';
    
    results.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'budget':
          comparison = Number(a.budget.max - b.budget.max);
          break;
        case 'deadline':
          comparison = a.deadline - b.deadline;
          break;
        case 'created':
          comparison = a.createdAt - b.createdAt;
          break;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });
    
    // 分页
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const total = results.length;
    const start = (page - 1) * pageSize;
    const data = results.slice(start, start + pageSize);
    
    return {
      data,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    };
  }
  
  /**
   * 发布任务
   */
  async post(
    listing: Omit<TaskListing, 'listingId' | 'status' | 'bids' | 'createdAt'>
  ): Promise<ApiResponse<TaskListing>> {
    const newListing: TaskListing = {
      ...listing,
      listingId: this.generateListingId(),
      status: ListingStatus.ACTIVE,
      bids: [],
      createdAt: Date.now(),
    };
    
    this.listings.set(newListing.listingId, newListing);
    this.emit('task_posted', newListing);
    
    return { success: true, data: newListing };
  }
  
  /**
   * 提交报价
   */
  async submitBid(
    listingId: ListingId,
    bid: Omit<Bid, 'bidId' | 'status' | 'createdAt'>
  ): Promise<ApiResponse<Bid>> {
    const listing = this.listings.get(listingId);
    
    if (!listing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task not found' },
      };
    }
    
    if (listing.status !== ListingStatus.ACTIVE) {
      return {
        success: false,
        error: { code: 'NOT_AVAILABLE', message: 'Task is not accepting bids' },
      };
    }
    
    // 检查是否已经投过标
    if (listing.bids.some(b => b.provider === bid.provider && b.status === 'pending')) {
      return {
        success: false,
        error: { code: 'ALREADY_BID', message: 'You have already submitted a bid' },
      };
    }
    
    const newBid: Bid = {
      ...bid,
      bidId: `bid_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      status: 'pending',
      createdAt: Date.now(),
    };
    
    listing.bids.push(newBid);
    this.emit('bid_submitted', { listing, bid: newBid });
    
    return { success: true, data: newBid };
  }
  
  /**
   * 接受报价
   */
  async acceptBid(
    listingId: ListingId,
    bidId: string,
    client: AgentId
  ): Promise<ApiResponse<{ contractId: string }>> {
    const listing = this.listings.get(listingId);
    
    if (!listing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task not found' },
      };
    }
    
    if (listing.client !== client) {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Only the client can accept bids' },
      };
    }
    
    const bid = listing.bids.find(b => b.bidId === bidId);
    
    if (!bid) {
      return {
        success: false,
        error: { code: 'BID_NOT_FOUND', message: 'Bid not found' },
      };
    }
    
    // 更新状态
    bid.status = 'accepted';
    listing.bids
      .filter(b => b.bidId !== bidId)
      .forEach(b => { b.status = 'rejected'; });
    listing.status = ListingStatus.SOLD;
    
    // TODO: 创建服务合约
    const contractId = `contract_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    this.emit('bid_accepted', { listing, bid, contractId });
    
    return { success: true, data: { contractId } };
  }
  
  /**
   * 取消任务
   */
  async cancel(listingId: ListingId, client: AgentId): Promise<ApiResponse<void>> {
    const listing = this.listings.get(listingId);
    
    if (!listing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task not found' },
      };
    }
    
    if (listing.client !== client) {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Only the client can cancel' },
      };
    }
    
    if (listing.status === ListingStatus.SOLD) {
      return {
        success: false,
        error: { code: 'ALREADY_SOLD', message: 'Task already has an accepted bid' },
      };
    }
    
    listing.status = ListingStatus.CANCELLED;
    this.emit('task_cancelled', listing);
    
    return { success: true };
  }
  
  private generateListingId(): ListingId {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

// ============================================
// 能力市场
// ============================================

export interface CapabilitySearchOptions {
  category?: ServiceType;
  name?: string;
  maxPricePerCall?: bigint;
  minSuccessRate?: number;
  maxLatency?: number;
  provider?: AgentId;
  sortBy?: 'price' | 'successRate' | 'latency' | 'popularity';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export class CapabilityMarket extends EventEmitter {
  private listings: Map<ListingId, CapabilityListing> = new Map();
  
  /**
   * 搜索能力
   */
  async search(options: CapabilitySearchOptions): Promise<PaginatedResponse<CapabilityListing>> {
    let results = Array.from(this.listings.values())
      .filter(l => l.status === ListingStatus.ACTIVE);
    
    if (options.category) {
      results = results.filter(l => l.capability.category === options.category);
    }
    if (options.name) {
      results = results.filter(l => 
        l.capability.name.toLowerCase().includes(options.name!.toLowerCase())
      );
    }
    if (options.maxPricePerCall !== undefined) {
      results = results.filter(l => 
        l.accessModel.pricePerCall !== undefined && 
        l.accessModel.pricePerCall <= options.maxPricePerCall!
      );
    }
    if (options.minSuccessRate !== undefined) {
      results = results.filter(l => l.capability.successRate >= options.minSuccessRate!);
    }
    if (options.maxLatency !== undefined) {
      results = results.filter(l => l.capability.avgLatency <= options.maxLatency!);
    }
    if (options.provider) {
      results = results.filter(l => l.provider === options.provider);
    }
    
    // 排序
    const sortBy = options.sortBy ?? 'popularity';
    const sortOrder = options.sortOrder ?? 'desc';
    
    results.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'price':
          comparison = Number((a.accessModel.pricePerCall ?? 0n) - (b.accessModel.pricePerCall ?? 0n));
          break;
        case 'successRate':
          comparison = a.capability.successRate - b.capability.successRate;
          break;
        case 'latency':
          comparison = a.capability.avgLatency - b.capability.avgLatency;
          break;
        case 'popularity':
          comparison = a.stats.totalCalls - b.stats.totalCalls;
          break;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });
    
    // 分页
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const total = results.length;
    const start = (page - 1) * pageSize;
    const data = results.slice(start, start + pageSize);
    
    return {
      data,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    };
  }
  
  /**
   * 注册能力
   */
  async register(
    listing: Omit<CapabilityListing, 'listingId' | 'status' | 'stats' | 'createdAt'>
  ): Promise<ApiResponse<CapabilityListing>> {
    const newListing: CapabilityListing = {
      ...listing,
      listingId: this.generateListingId(),
      status: ListingStatus.ACTIVE,
      stats: {
        totalCalls: 0,
        successfulCalls: 0,
        avgResponseTime: 0,
        activeSubscribers: 0,
      },
      createdAt: Date.now(),
    };
    
    this.listings.set(newListing.listingId, newListing);
    this.emit('capability_registered', newListing);
    
    return { success: true, data: newListing };
  }
  
  /**
   * 调用能力
   */
  async invoke(
    listingId: ListingId,
    caller: AgentId,
    input: unknown
  ): Promise<ApiResponse<{ output: unknown; latency: number }>> {
    const listing = this.listings.get(listingId);
    
    if (!listing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Capability not found' },
      };
    }
    
    if (listing.status !== ListingStatus.ACTIVE) {
      return {
        success: false,
        error: { code: 'NOT_AVAILABLE', message: 'Capability is not available' },
      };
    }
    
    // TODO: 实现实际的能力调用
    // 1. 验证输入 schema
    // 2. 扣费
    // 3. 调用远程能力
    // 4. 更新统计
    
    const startTime = Date.now();
    
    // 模拟调用
    const output = { result: 'mock_output', input };
    
    const latency = Date.now() - startTime;
    
    // 更新统计
    listing.stats.totalCalls++;
    listing.stats.successfulCalls++;
    listing.stats.avgResponseTime = 
      (listing.stats.avgResponseTime * (listing.stats.totalCalls - 1) + latency) / listing.stats.totalCalls;
    
    this.emit('capability_invoked', { listing, caller, input, output, latency });
    
    return { success: true, data: { output, latency } };
  }
  
  /**
   * 订阅能力
   */
  async subscribe(
    listingId: ListingId,
    subscriber: AgentId,
    period: 'hour' | 'day' | 'week' | 'month'
  ): Promise<ApiResponse<{ subscriptionId: string; expiresAt: number }>> {
    const listing = this.listings.get(listingId);
    
    if (!listing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Capability not found' },
      };
    }
    
    if (listing.accessModel.type !== 'subscription') {
      return {
        success: false,
        error: { code: 'NOT_SUBSCRIPTION', message: 'Capability does not support subscription' },
      };
    }
    
    // TODO: 实现订阅逻辑
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const periodMs: Record<string, number> = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
    };
    const expiresAt = Date.now() + periodMs[period];
    
    listing.stats.activeSubscribers++;
    
    this.emit('capability_subscribed', { listing, subscriber, subscriptionId, expiresAt });
    
    return { success: true, data: { subscriptionId, expiresAt } };
  }
  
  private generateListingId(): ListingId {
    return `cap_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

// ============================================
// 导出
// ============================================

export const infoMarket = new InfoMarket();
export const taskMarket = new TaskMarket();
export const capabilityMarket = new CapabilityMarket();
