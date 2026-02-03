# ClawToken 市场模块 - 高级设计文档

> 详细的市场实现、高级特性、性能优化和最佳实践

## 目录

1. [市场架构深度解析](#市场架构深度解析)
2. [信息市场详细设计](#信息市场详细设计)
3. [任务市场详细设计](#任务市场详细设计)
4. [能力市场详细设计](#能力市场详细设计)
5. [定价引擎](#定价引擎)
6. [匹配与推荐算法](#匹配与推荐算法)
7. [支付与托管系统](#支付与托管系统)
8. [性能优化](#性能优化)
9. [实现案例](#实现案例)

---

## 市场架构深度解析

### 1. 分层架构设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          应用层 (Application Layer)                         │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ 信息市场     │  │ 任务市场     │  │ 能力市场     │  │ 组合市场     │    │
│  │ 应用服务     │  │ 应用服务     │  │ 应用服务     │  │ 应用服务     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
┌─────────────────────────────────────────────────────────────────────────────┐
│                          核心层 (Core Services Layer)                       │
│                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│  │ 订单引擎            │  │ 匹配引擎            │  │ 支付引擎            │ │
│  │ • 生命周期管理      │  │ • 智能匹配          │  │ • 托管管理          │ │
│  │ • 状态转换          │  │ • 推荐算法          │  │ • 结算处理          │ │
│  │ • 验收流程          │  │ • 评分计算          │  │ • 费用计算          │ │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘ │
│                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│  │ 定价引擎            │  │ 搜索引擎            │  │ 争议引擎            │ │
│  │ • 价格计算          │  │ • 全文搜索          │  │ • 纠纷处理          │ │
│  │ • 折扣策略          │  │ • 多维度过滤        │  │ • 仲裁管理          │ │
│  │ • 动态定价          │  │ • 排序排名          │  │ • 赔偿计算          │ │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
┌─────────────────────────────────────────────────────────────────────────────┐
│                       基础设施层 (Infrastructure Layer)                     │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ 存储层       │  │ 缓存层       │  │ 消息队列     │  │ 索引层       │    │
│  │ • 订单存储   │  │ • 热点缓存   │  │ • 事件流     │  │ • 搜索索引   │    │
│  │ • 商品存储   │  │ • 用户缓存   │  │ • 通知队列   │  │ • 排名索引   │    │
│  │ • 交易日志   │  │ • 价格缓存   │  │ • 结算队列   │  │ • 推荐索引   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
┌─────────────────────────────────────────────────────────────────────────────┐
│                       数据层 (Data Access Layer)                            │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ 关系数据库   │  │ 文档数据库   │  │ 时序数据库   │  │ 区块链       │    │
│  │ • PostgreSQL │  │ • MongoDB    │  │ • InfluxDB   │  │ • 合约存储   │    │
│  │ • 事务数据   │  │ • 文档数据   │  │ • 指标数据   │  │ • 交易记录   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

> **去中心化说明**  
> 上述存储/索引组件仅为可替换实现示例，可由任何节点/社区自托管，不构成协议的中心化依赖。

### 2. 商品发布流程详解

```typescript
/**
 * 商品发布状态机与验证流程
 */

// 状态转移图
DRAFT → VALIDATING → INDEXED → ACTIVE
  ↓        ↓           ↓        ↓
DRAFT   REJECTED   REJECTED   PAUSED
                              ↓
                           ARCHIVED

/**
 * 发布流程 - 详细实现
 */
class ListingPublishPipeline {
  /**
   * 第1步: 基础验证
   */
  async validateBasics(listing: ListingInput): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    
    // 验证必填字段
    const requiredFields = ['title', 'description', 'category', 'pricing'];
    for (const field of requiredFields) {
      if (!listing[field]) {
        errors.push({ field, message: `${field} is required` });
      }
    }
    
    // 验证长度限制
    if (listing.title?.length < 10 || listing.title?.length > 200) {
      errors.push({ field: 'title', message: 'Title must be 10-200 characters' });
    }
    
    // 验证分类
    if (!this.isValidCategory(listing.category)) {
      errors.push({ field: 'category', message: 'Invalid category' });
    }
    
    // 验证定价
    try {
      this.validatePricing(listing.pricing);
    } catch (e) {
      errors.push({ field: 'pricing', message: e.message });
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
  
  /**
   * 第2步: 内容验证（市场特定）
   */
  async validateContent(listing: ListingInput, marketType: MarketType): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    
    switch (marketType) {
      case 'info':
        errors.push(...await this.validateInfoContent(listing));
        break;
      case 'task':
        errors.push(...await this.validateTaskContent(listing));
        break;
      case 'capability':
        errors.push(...await this.validateCapabilityContent(listing));
        break;
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
  
  /**
   * 第3步: 卖家/发布者验证
   */
  async validatePublisher(sellerDID: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    
    // 检查账户状态
    const account = await this.accounts.get(sellerDID);
    if (!account?.verified) {
      errors.push({ field: 'publisher', message: 'Account not verified' });
    }
    if (account?.suspended) {
      errors.push({ field: 'publisher', message: 'Account suspended' });
    }
    
    // 检查信誉
    const reputation = await this.reputation.getScore(sellerDID);
    if (reputation < 100) {
      errors.push({ field: 'publisher', message: 'Reputation too low' });
    }
    
    // 检查发布限制
    const dayLimit = await this.checkDailyPublishLimit(sellerDID);
    if (!dayLimit.allowed) {
      errors.push({ field: 'publisher', message: `Exceeded daily limit: ${dayLimit.remaining}/${dayLimit.limit}` });
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
  
  /**
   * 第4步: 内容审查（可选）
   */
  async contentReview(listing: ListingInput): Promise<ReviewResult> {
    const flags: ContentFlag[] = [];
    
    // AI 内容审查
    const aiReview = await this.contentModerator.review({
      text: listing.description,
      minConfidence: 0.8,
    });
    
    if (aiReview.flagged) {
      flags.push({
        type: aiReview.category,
        severity: aiReview.severity,
        message: aiReview.message,
      });
    }
    
    // 关键词过滤
    if (this.hasProhibitedKeywords(listing.description)) {
      flags.push({
        type: 'prohibited_content',
        severity: 'high',
        message: 'Contains prohibited keywords',
      });
    }
    
    return {
      approved: flags.length === 0,
      flags,
      requiresHumanReview: flags.some(f => f.severity === 'high'),
    };
  }
  
  /**
   * 第5步: 索引构建
   */
  async buildIndex(listing: Listing): Promise<IndexResult> {
    const indexes: IndexEntry[] = [];
    
    // 搜索索引
    indexes.push({
      type: 'search',
      id: listing.id,
      fields: {
        title: listing.title,
        description: listing.description,
        tags: listing.tags,
        category: listing.category,
        keywords: this.extractKeywords(listing),
      },
    });
    
    // 排名索引
    indexes.push({
      type: 'ranking',
      id: listing.id,
      fields: {
        marketType: listing.marketType,
        category: listing.category,
        createdAt: listing.createdAt,
        reputation: listing.seller.reputation,
      },
    });
    
    // 推荐索引
    indexes.push({
      type: 'recommendation',
      id: listing.id,
      fields: {
        features: this.extractFeatures(listing),
        category: listing.category,
        priceLevel: this.getPriceLevel(listing.pricing),
      },
    });
    
    // 写入索引
    await Promise.all(indexes.map(idx => this.indexStore.put(idx)));
    
    return { success: true, indexCount: indexes.length };
  }
  
  /**
   * 第6步: 发布完成
   */
  async finalize(listing: Listing): Promise<PublishResult> {
    // 更新状态
    listing.status = 'active';
    listing.updatedAt = Date.now();
    
    // 保存到存储
    await this.storage.saveListing(listing);
    
    // 发送事件
    await this.eventBus.emit('listing.published', {
      listingId: listing.id,
      marketType: listing.marketType,
      seller: listing.seller.did,
      timestamp: Date.now(),
    });
    
    // 触发通知
    await this.notifications.notify(listing.seller.did, {
      type: 'listing_published',
      title: `您的商品 "${listing.title}" 已发布`,
      data: { listingId: listing.id },
    });
    
    // 触发推荐索引更新
    await this.scheduler.schedule({
      task: 'update_recommendations',
      delay: 60 * 1000,  // 1分钟后
    });
    
    return {
      success: true,
      listingId: listing.id,
      url: `${this.baseUrl}/listings/${listing.id}`,
    };
  }
}
```

---

## 信息市场详细设计

### 1. 信息商品分类体系

```typescript
/**
 * 完整的信息商品分类体系
 */

interface InfoCategoryHierarchy {
  // 第一层：大类
  knowledge: {
    // 第二层：细类
    courses: {
      // 第三层：具体分类
      'machine-learning': 'ML 课程',
      'blockchain': '区块链课程',
      'ai-agents': 'AI Agent 课程',
    },
    tutorials: {
      'react-beginner': 'React 入门',
      'solidity-contracts': 'Solidity 智能合约',
    },
    guides: {
      'best-practices': '最佳实践指南',
      'troubleshooting': '故障排查指南',
    },
  },
  
  data: {
    datasets: {
      'training-data': '训练数据集',
      'benchmark-data': '基准测试数据',
      'market-data': '市场数据',
    },
    streams: {
      'real-time': '实时数据流',
      'websocket': 'WebSocket 数据源',
      'api-feeds': 'API 数据源',
    },
  },
  
  intelligence: {
    signals: {
      'price-signal': '价格信号',
      'trend-signal': '趋势信号',
      'anomaly-signal': '异常检测',
    },
    predictions: {
      'market-forecast': '市场预测',
      'trend-forecast': '趋势预测',
      'user-behavior': '用户行为预测',
    },
    alerts: {
      'price-alert': '价格预警',
      'event-alert': '事件预警',
      'anomaly-alert': '异常预警',
    },
  },
  
  analysis: {
    reports: {
      'market-analysis': '市场分析报告',
      'competitive-analysis': '竞争分析报告',
      'technical-analysis': '技术分析报告',
    },
    research: {
      'academic-paper': '学术论文',
      'industry-research': '行业研究',
      'case-study': '案例研究',
    },
  },
}
```

### 2. 信息内容管理系统

```typescript
/**
 * 信息内容管理 - 详细实现
 */
class InfoContentManager {
  /**
   * 内容处理流程
   */
  async processInfoContent(params: ProcessInfoParams): Promise<ProcessedInfo> {
    const { content, format, listingId } = params;
    
    // 1. 内容验证
    const validation = await this.validateContent(content, format);
    if (!validation.valid) {
      throw new Error(`Content validation failed: ${validation.errors.join(', ')}`);
    }
    
    // 2. 内容标准化
    const normalized = await this.normalizeContent(content, format);
    
    // 3. 内容加密存储
    const encrypted = await this.encryptContent(normalized);
    
    // 4. 内容分片（便于流式传输）
    const chunks = await this.chunkContent(encrypted);
    
    // 5. 内容指纹计算（用于验证完整性和去重）
    const fingerprint = await this.computeFingerprint(normalized);
    
    // 6. 预览生成
    const preview = await this.generatePreview(normalized, format);
    
    // 7. 索引构建
    const index = await this.buildContentIndex(normalized, listingId);
    
    return {
      contentId: generateId(),
      fingerprint,
      chunks,
      encrypted,
      preview,
      index,
      metadata: {
        size: content.length,
        format,
        processedAt: Date.now(),
        checksum: this.calculateChecksum(encrypted),
      },
    };
  }
  
  /**
   * 信息分片 - 便于流式传输和增量传输
   */
  async chunkContent(content: Buffer): Promise<ContentChunk[]> {
    const chunkSize = 1024 * 1024;  // 1MB per chunk
    const chunks: ContentChunk[] = [];
    
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, Math.min(i + chunkSize, content.length));
      chunks.push({
        index: Math.floor(i / chunkSize),
        size: chunk.length,
        hash: await this.hashChunk(chunk),
        data: chunk,
      });
    }
    
    return chunks;
  }
  
  /**
   * 预览生成
   */
  async generatePreview(content: any, format: string): Promise<Preview> {
    let preview: string;
    let truncated = false;
    
    if (format === 'json') {
      // JSON 预览：显示结构和样本数据
      if (Array.isArray(content)) {
        preview = JSON.stringify(content.slice(0, 5), null, 2);
      } else {
        preview = JSON.stringify(content, null, 2);
      }
    } else if (format === 'csv') {
      // CSV 预览：显示前几行
      const lines = content.split('\n');
      preview = lines.slice(0, 10).join('\n');
      truncated = lines.length > 10;
    } else if (format === 'text') {
      // 文本预览：显示前500字符
      preview = content.substring(0, 500);
      truncated = content.length > 500;
    } else {
      // 其他格式：显示元数据
      preview = `Format: ${format}, Size: ${content.length} bytes`;
    }
    
    return {
      content: preview,
      truncated,
      format,
    };
  }
  
  /**
   * 内容访问控制
   */
  async grantAccess(params: GrantAccessParams): Promise<AccessGrant> {
    const {
      contentId,
      buyerDID,
      listingId,
      accessType,
      expiresAt,
    } = params;
    
    // 生成访问令牌
    const accessToken = await this.generateAccessToken({
      contentId,
      buyerDID,
      permissions: this.getPermissions(accessType),
      expiresAt,
    });
    
    // 生成下载链接（如果是下载访问）
    let downloadUrl: string | undefined;
    if (accessType === 'download') {
      downloadUrl = await this.generateDownloadUrl(contentId, accessToken);
    }
    
    // 生成 API 密钥（如果是 API 访问）
    let apiKey: string | undefined;
    if (accessType === 'api') {
      apiKey = await this.generateApiKey(contentId, accessToken);
    }
    
    // 生成流令牌（如果是流访问）
    let streamToken: string | undefined;
    if (accessType === 'stream') {
      streamToken = await this.generateStreamToken(contentId, accessToken);
    }
    
    const grant: AccessGrant = {
      id: generateId(),
      contentId,
      buyerDID,
      listingId,
      accessType,
      accessToken,
      downloadUrl,
      apiKey,
      streamToken,
      createdAt: Date.now(),
      expiresAt,
    };
    
    // 保存访问授予
    await this.storage.saveAccessGrant(grant);
    
    // 记录审计日志
    await this.auditLog.record({
      action: 'grant_access',
      contentId,
      buyer: buyerDID,
      timestamp: Date.now(),
    });
    
    return grant;
  }
  
  /**
   * 使用追踪（检测泄露）
   */
  async trackUsage(contentId: string, userId: string, action: 'view' | 'download' | 'query'): Promise<void> {
    const usage: UsageRecord = {
      contentId,
      userId,
      action,
      timestamp: Date.now(),
      ipAddress: this.getCurrentIp(),
      userAgent: this.getCurrentUserAgent(),
    };
    
    // 保存使用记录
    await this.usageLog.record(usage);
    
    // 检测异常使用模式
    const anomaly = await this.detectAnomalousUsage(contentId, userId);
    if (anomaly) {
      // 发送泄露预警
      await this.alerts.send({
        type: 'potential_leak',
        contentId,
        userId,
        severity: 'high',
      });
    }
  }
  
  /**
   * 水印与防盗版
   */
  async addWatermark(content: Buffer, buyerDID: string): Promise<Buffer> {
    // 添加数字水印
    const watermark = {
      buyerId: buyerDID,
      purchaseTime: Date.now(),
      purchaseId: generateId(),
    };
    
    // 对不同格式采用不同的水印技术
    // JSON: 在元数据中添加
    // PDF: 使用 PDF 库添加可见/隐形水印
    // 图像: 使用隐形水印算法
    // 视频: 使用帧水印
    
    return this.applyFormatSpecificWatermark(content, watermark);
  }
  
  /**
   * 版权保护
   */
  async registerCopyright(listing: InfoListing): Promise<CopyrightRegistration> {
    const contentHash = await this.hashContent(listing.id);
    
    const registration: CopyrightRegistration = {
      id: generateId(),
      listingId: listing.id,
      seller: listing.seller.did,
      title: listing.title,
      contentHash,
      registerTime: Date.now(),
      license: listing.license,
      verifiction: {
        timestamp: Date.now(),
        proof: await this.blockchain.recordHash(contentHash),
      },
    };
    
    await this.storage.saveCopyrightRegistration(registration);
    
    return registration;
  }
}
```

### 3. 信息订阅管理

```typescript
/**
 * 信息订阅生命周期管理
 */
class SubscriptionLifecycleManager {
  /**
   * 订阅周期处理
   */
  async processSubscriptionCycle(subscription: InfoSubscription): Promise<void> {
    // 检查当前周期是否结束
    const now = Date.now();
    
    if (now >= subscription.currentPeriodEnd) {
      // 周期已结束
      if (subscription.autoRenew) {
        // 自动续期
        await this.renewSubscription(subscription);
      } else {
        // 标记为已过期
        subscription.status = 'expired';
        await this.storage.saveSubscription(subscription);
        
        // 通知订阅者
        await this.notify(subscription.subscriber, 'subscription_expired', subscription);
      }
    }
  }
  
  /**
   * 自动续期
   */
  async renewSubscription(subscription: InfoSubscription): Promise<void> {
    try {
      // 扣费
      const listing = await this.storage.getListing(subscription.listingId);
      const renewalCost = listing.pricing.subscriptionPrice!.price;
      
      await this.wallet.transfer({
        from: subscription.subscriber,
        to: subscription.provider,
        amount: renewalCost,
        memo: `Subscription renewal: ${listing.title}`,
      });
      
      // 更新订阅
      subscription.currentPeriodStart = subscription.currentPeriodEnd;
      subscription.currentPeriodEnd = this.calculateNextPeriodEnd(
        subscription.plan,
        subscription.currentPeriodEnd
      );
      subscription.status = 'active';
      
      await this.storage.saveSubscription(subscription);
      
      // 通知
      await this.notify(subscription.subscriber, 'subscription_renewed', subscription);
      
    } catch (error) {
      // 续期失败
      subscription.status = 'renewal_failed';
      await this.storage.saveSubscription(subscription);
      
      // 通知订阅者并给予续期宽限期
      await this.notify(subscription.subscriber, 'subscription_renewal_failed', {
        subscription,
        graceperiod: 24 * 60 * 60 * 1000,  // 24小时宽限期
      });
    }
  }
  
  /**
   * 暂停订阅
   */
  async pauseSubscription(subscriptionId: string, reason?: string): Promise<void> {
    const subscription = await this.storage.getSubscription(subscriptionId);
    
    subscription.status = 'paused';
    subscription.pausedAt = Date.now();
    subscription.pauseReason = reason;
    
    // 撤销访问权限
    await this.revokeAccessCredentials(subscription);
    
    await this.storage.saveSubscription(subscription);
  }
  
  /**
   * 恢复订阅
   */
  async resumeSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.storage.getSubscription(subscriptionId);
    
    // 检查是否过期
    if (subscription.currentPeriodEnd < Date.now()) {
      throw new Error('Subscription expired, please renew');
    }
    
    subscription.status = 'active';
    
    // 重新生成访问凭证
    subscription.accessCredentials = await this.generateAccessCredentials(
      await this.storage.getListing(subscription.listingId)
    );
    
    await this.storage.saveSubscription(subscription);
  }
  
  /**
   * 计算统计数据
   */
  async calculateSubscriptionStats(listingId: string, period: 'daily' | 'weekly' | 'monthly'): Promise<SubscriptionStats> {
    const subs = await this.storage.getSubscriptionsByListing(listingId);
    const now = Date.now();
    
    const stats: SubscriptionStats = {
      total: subs.length,
      active: subs.filter(s => s.status === 'active').length,
      paused: subs.filter(s => s.status === 'paused').length,
      expired: subs.filter(s => s.status === 'expired').length,
      churnRate: 0,
      arpu: 0n,
      mrr: 0n,
      growthRate: 0,
    };
    
    // 计算流失率
    const expiredInPeriod = subs.filter(s => {
      const periodStart = this.getPeriodStart(period);
      return s.cancelledAt && s.cancelledAt >= periodStart && s.cancelledAt < now;
    }).length;
    
    stats.churnRate = subs.length > 0 ? expiredInPeriod / subs.length : 0;
    
    // 计算 ARPU（Average Revenue Per User）
    const totalRevenue = subs.reduce((sum, s) => sum + s.plan.price, 0n);
    stats.arpu = subs.length > 0 ? totalRevenue / BigInt(subs.length) : 0n;
    
    // 计算 MRR（Monthly Recurring Revenue）
    const monthlySubscriptions = subs.filter(s => 
      s.plan.period === 'monthly' && s.status === 'active'
    );
    stats.mrr = monthlySubscriptions.reduce((sum, s) => sum + s.plan.price, 0n);
    
    // 计算增长率
    const previousPeriodStart = this.getPreviousPeriodStart(period);
    const previousSubCount = subs.filter(s => 
      s.createdAt >= previousPeriodStart && s.createdAt < this.getPeriodStart(period)
    ).length;
    
    stats.growthRate = previousSubCount > 0 
      ? (subs.length - previousSubCount) / previousSubCount 
      : 0;
    
    return stats;
  }
}
```

---

## 任务市场详细设计

### 1. 任务评分与匹配算法

```typescript
/**
 * 任务-工作者匹配算法
 */
class TaskWorkerMatcher {
  /**
   * 综合评分模型
   */
  async computeMatchScore(task: TaskListing, worker: AgentProfile): Promise<MatchScore> {
    const scores = {
      skillMatch: 0,
      reputationScore: 0,
      experienceScore: 0,
      availabilityScore: 0,
      priceMatch: 0,
      communicationScore: 0,
      completionRateScore: 0,
    };
    
    // 1. 技能匹配分数 (40%)
    scores.skillMatch = await this.calculateSkillMatch(task.task.skills, worker.skills);
    
    // 2. 信誉分数 (20%)
    const reputationNormalized = Math.min(worker.reputation / 1000, 1.0);
    scores.reputationScore = reputationNormalized;
    
    // 3. 相关经验分数 (15%)
    scores.experienceScore = await this.calculateExperienceScore(task, worker);
    
    // 4. 可用性分数 (10%)
    const timelineMatch = task.timeline.estimatedDuration >= worker.availableCapacity;
    scores.availabilityScore = timelineMatch ? 1.0 : (worker.availableCapacity / task.timeline.estimatedDuration);
    
    // 5. 价格匹配分数 (10%)
    scores.priceMatch = await this.calculatePriceMatch(task.pricing, worker);
    
    // 6. 沟通能力分数 (5%)
    scores.communicationScore = worker.stats.responseTime > 0 
      ? Math.max(0, 1.0 - (worker.stats.responseTime / (24 * 60 * 60 * 1000)))
      : 0.5;
    
    // 7. 完成率分数 (5%)
    scores.completionRateScore = worker.stats.completionRate || 0.8;
    
    // 加权求和
    const weights = {
      skillMatch: 0.40,
      reputationScore: 0.20,
      experienceScore: 0.15,
      availabilityScore: 0.10,
      priceMatch: 0.10,
      communicationScore: 0.05,
      completionRateScore: 0.05,
    };
    
    const totalScore = Object.keys(scores).reduce((sum, key) => {
      return sum + (scores[key as keyof typeof scores] * weights[key as keyof typeof weights]);
    }, 0);
    
    return {
      overallScore: totalScore,
      breakdown: scores,
      weights,
      recommendation: this.getRecommendation(totalScore),
    };
  }
  
  /**
   * 技能匹配计算 - 详细版本
   */
  private async calculateSkillMatch(
    requiredSkills: Skill[],
    workerSkills: string[]
  ): Promise<number> {
    let matchedRequired = 0;
    let matchedOptional = 0;
    
    const required = requiredSkills.filter(s => s.required);
    const optional = requiredSkills.filter(s => !s.required);
    
    // 必需技能检查
    for (const skill of required) {
      const match = workerSkills.find(ws =>
        this.skillSimilarity(ws, skill.name) > 0.8
      );
      if (match) {
        matchedRequired++;
      }
    }
    
    // 必需技能必须全部满足
    if (matchedRequired < required.length) {
      return 0;
    }
    
    // 可选技能检查
    for (const skill of optional) {
      const match = workerSkills.find(ws =>
        this.skillSimilarity(ws, skill.name) > 0.8
      );
      if (match) {
        matchedOptional++;
      }
    }
    
    // 计算匹配度
    const baseScore = 1.0;  // 必需技能全部满足
    const optionalBonus = optional.length > 0 
      ? (matchedOptional / optional.length) * 0.2  // 可选技能最多加20%
      : 0;
    
    return Math.min(1.0, baseScore + optionalBonus);
  }
  
  /**
   * 相关经验计算
   */
  private async calculateExperienceScore(
    task: TaskListing,
    worker: AgentProfile
  ): Promise<number> {
    // 获取工作者完成过的相似任务
    const similarTasks = await this.findSimilarCompletedTasks(task, worker);
    
    if (similarTasks.length === 0) {
      return 0.3;  // 没有相似经验但有一般经验
    }
    
    // 计算经验相关性
    let totalRelevance = 0;
    for (const completedTask of similarTasks.slice(0, 5)) {
      const relevance = this.calculateTaskSimilarity(task, completedTask);
      const recency = this.calculateRecency(completedTask.completedAt);
      totalRelevance += relevance * recency;
    }
    
    return Math.min(1.0, totalRelevance / 5);
  }
  
  /**
   * 价格匹配计算
   */
  private async calculatePriceMatch(
    pricing: PricingModel,
    worker: AgentProfile
  ): Promise<number> {
    const workerRate = worker.stats.averageRate || 0n;
    
    let taskPrice: bigint;
    if (pricing.type === 'fixed' && pricing.fixedPrice) {
      taskPrice = pricing.fixedPrice;
    } else if (pricing.type === 'range' && pricing.priceRange) {
      taskPrice = pricing.priceRange.max;  // 以最高价为基准
    } else {
      return 0.5;  // 不确定的价格
    }
    
    // 计算价格匹配度
    // 工作者愿意接受任务价格越接近其平均费率，匹配度越高
    const priceDiff = Number(taskPrice - workerRate) / Number(taskPrice);
    
    if (priceDiff > 0) {
      // 任务价格高于工作者平均费率 - 好的信号
      return Math.min(1.0, 1.0 + priceDiff * 0.2);
    } else {
      // 任务价格低于工作者平均费率
      return Math.max(0.5, 1.0 + priceDiff * 0.5);
    }
  }
  
  /**
   * 找到匹配的工作者
   */
  async findMatchingWorkers(
    task: TaskListing,
    options?: {
      limit?: number;
      minScore?: number;
    }
  ): Promise<WorkerMatch[]> {
    const limit = options?.limit || 20;
    const minScore = options?.minScore || 0.6;
    
    // 1. 候选工作者筛选
    const candidates = await this.filterCandidates(task);
    
    // 2. 计算每个候选的匹配分数
    const matches: WorkerMatch[] = [];
    for (const candidate of candidates) {
      const score = await this.computeMatchScore(task, candidate);
      if (score.overallScore >= minScore) {
        matches.push({
          worker: candidate,
          score,
        });
      }
    }
    
    // 3. 排序
    matches.sort((a, b) => b.score.overallScore - a.score.overallScore);
    
    // 4. 返回前 N 个
    return matches.slice(0, limit);
  }
  
  /**
   * 候选工作者筛选
   */
  private async filterCandidates(task: TaskListing): Promise<AgentProfile[]> {
    const requirements = task.workerRequirements || {};
    
    // 基本查询
    let query: any = {
      type: 'worker',
      status: 'active',
    };
    
    // 添加条件
    if (requirements.minReputation) {
      query.reputation = { $gte: requirements.minReputation };
    }
    
    if (requirements.verifiedOnly) {
      query.verified = true;
    }
    
    if (requirements.requiredSkills?.length) {
      query.skills = { $in: requirements.requiredSkills };
    }
    
    // 执行查询
    const candidates = await this.database.query(query);
    
    // 过滤被屏蔽的工作者
    const filtered = candidates.filter(c =>
      !requirements.blockedAgents?.includes(c.did)
    );
    
    return filtered;
  }
}

/**
 * 匹配分数结果
 */
interface MatchScore {
  overallScore: number;
  breakdown: {
    skillMatch: number;
    reputationScore: number;
    experienceScore: number;
    availabilityScore: number;
    priceMatch: number;
    communicationScore: number;
    completionRateScore: number;
  };
  weights: Record<string, number>;
  recommendation: string;
}

/**
 * 工作者匹配
 */
interface WorkerMatch {
  worker: AgentProfile;
  score: MatchScore;
}
```

### 2. 工作验收流程

```typescript
/**
 * 详细的工作验收流程管理
 */
class WorkAcceptanceProcess {
  /**
   * 验收标准评估
   */
  async assessAcceptanceCriteria(
    submission: Submission,
    deliverables: Deliverable[]
  ): Promise<AcceptanceAssessment> {
    const assessment: AcceptanceAssessment = {
      submissionId: submission.id,
      assessedAt: Date.now(),
      criteria: [],
      overallStatus: 'pending',
    };
    
    for (const deliverable of deliverables) {
      const submitted = submission.deliverables.find(d => 
        d.definitionId === deliverable.id
      );
      
      if (!submitted) {
        assessment.criteria.push({
          deliverable: deliverable.name,
          status: 'missing',
          score: 0,
          issues: ['Deliverable not submitted'],
        });
        continue;
      }
      
      // 评估每个验收标准
      const criteriaResults = [];
      for (const criteria of deliverable.acceptanceCriteria) {
        const result = await this.evaluateCriteria(criteria, submitted);
        criteriaResults.push(result);
      }
      
      // 汇总分数
      const totalScore = criteriaResults.length > 0
        ? criteriaResults.reduce((sum, r) => sum + r.score, 0) / criteriaResults.length
        : 0;
      
      const failedCriteria = criteriaResults.filter(r => r.score < 0.8);
      
      assessment.criteria.push({
        deliverable: deliverable.name,
        status: totalScore >= 0.8 ? 'passed' : 'failed',
        score: totalScore,
        issues: failedCriteria.map(r => r.issue),
      });
    }
    
    // 计算总体状态
    const passedCount = assessment.criteria.filter(c => c.status === 'passed').length;
    const requiredDeliverables = deliverables.filter(d => d.required).length;
    
    if (passedCount === deliverables.length) {
      assessment.overallStatus = 'approved';
    } else if (passedCount >= requiredDeliverables) {
      assessment.overallStatus = 'approved_with_issues';
    } else {
      assessment.overallStatus = 'rejected';
    }
    
    return assessment;
  }
  
  /**
   * 标准评估
   */
  private async evaluateCriteria(criteria: string, deliverable: any): Promise<CriteriaResult> {
    // 使用 AI 评估标准
    try {
      const evaluation = await this.aiEvaluator.evaluate({
        criteria,
        content: deliverable.content,
        type: deliverable.type,
      });
      
      return {
        criteria,
        score: evaluation.score,
        issue: evaluation.issue,
        suggestion: evaluation.suggestion,
      };
    } catch (error) {
      return {
        criteria,
        score: 0.5,
        issue: 'Unable to auto-evaluate',
        suggestion: 'Manual review required',
      };
    }
  }
  
  /**
   * 修改流程处理
   */
  async processRevision(params: RevisionParams): Promise<RevisionRequest> {
    const {
      submissionId,
      feedback,
      revisionDeadline,
      requiredChanges,
    } = params;
    
    const submission = await this.storage.getSubmission(submissionId);
    
    // 创建修改请求
    const request: RevisionRequest = {
      id: generateId(),
      submissionId,
      roundNumber: (submission.revisions?.length || 0) + 1,
      feedback,
      requiredChanges,
      deadline: revisionDeadline || Date.now() + 7 * 24 * 60 * 60 * 1000,  // 默认7天
      status: 'pending',
      createdAt: Date.now(),
    };
    
    // 保存修改请求
    if (!submission.revisions) {
      submission.revisions = [];
    }
    submission.revisions.push(request);
    submission.status = 'revision';
    
    await this.storage.saveSubmission(submission);
    
    // 通知工作者
    await this.notify(submission.worker, 'revision_requested', {
      submission,
      revisionRequest: request,
    });
    
    return request;
  }
  
  /**
   * 重新提交修改
   */
  async resubmitRevision(params: ResubmitRevisionParams): Promise<Submission> {
    const {
      submissionId,
      revisionRound,
      deliverables,
      notes,
    } = params;
    
    const submission = await this.storage.getSubmission(submissionId);
    const revisionRequest = submission.revisions?.[revisionRound - 1];
    
    if (!revisionRequest) {
      throw new Error('Revision request not found');
    }
    
    if (Date.now() > revisionRequest.deadline) {
      throw new Error('Revision deadline exceeded');
    }
    
    // 更新提交
    submission.deliverables = deliverables;
    submission.revisionNotes = notes;
    submission.status = 'pending_review';
    submission.lastRevisedAt = Date.now();
    
    revisionRequest.status = 'submitted';
    revisionRequest.submittedAt = Date.now();
    
    await this.storage.saveSubmission(submission);
    
    // 通知客户
    await this.notify(submission.orderId, 'revision_submitted', submission);
    
    return submission;
  }
}

/**
 * 验收评估
 */
interface AcceptanceAssessment {
  submissionId: string;
  assessedAt: number;
  criteria: {
    deliverable: string;
    status: 'passed' | 'failed' | 'missing';
    score: number;
    issues: string[];
  }[];
  overallStatus: 'approved' | 'approved_with_issues' | 'rejected';
}
```

---

## 能力市场详细设计

### 1. 能力网关与代理

```typescript
/**
 * 能力市场网关 - 统一的 API 代理层
 */
class CapabilityGateway {
  /**
   * 初始化网关
   */
  async initialize(): Promise<void> {
    // 启动 API 服务器
    this.apiServer = express();
    
    // 中间件
    this.apiServer.use(this.authMiddleware.bind(this));
    this.apiServer.use(this.rateLimitMiddleware.bind(this));
    this.apiServer.use(this.loggingMiddleware.bind(this));
    
    // 动态路由注册
    this.apiServer.all('/*', this.handleProxyRequest.bind(this));
    
    // 启动服务器
    await this.apiServer.listen(this.config.port);
  }
  
  /**
   * 认证中间件
   */
  private async authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const leaseId = req.headers['x-lease-id'] as string;
    const signature = req.headers['x-signature'] as string;
    
    if (!leaseId || !signature) {
      return res.status(401).json({ error: 'Missing authentication' });
    }
    
    // 验证租约
    const lease = await this.storage.getLease(leaseId);
    if (!lease || lease.status !== 'active') {
      return res.status(401).json({ error: 'Invalid lease' });
    }
    
    // 验证签名
    const isValid = await this.verifySignature(signature, req, lease);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // 检查租约是否过期
    if (lease.expiresAt && Date.now() > lease.expiresAt) {
      return res.status(401).json({ error: 'Lease expired' });
    }
    
    // 保存租约到请求
    (req as any).lease = lease;
    next();
  }
  
  /**
   * 速率限制中间件
   */
  private async rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const lease = (req as any).lease as CapabilityLease;
    
    // 检查速率限制
    const rateCheck = await this.checkRateLimit(lease);
    
    if (!rateCheck.allowed) {
      res.set('Retry-After', String(Math.ceil(rateCheck.retryAfter / 1000)));
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: rateCheck.retryAfter,
      });
    }
    
    // 检查配额
    const quotaCheck = await this.checkQuota(lease);
    if (!quotaCheck.allowed) {
      return res.status(402).json({
        error: 'Quota exceeded',
        reason: quotaCheck.reason,
      });
    }
    
    next();
  }
  
  /**
   * 日志中间件
   */
  private async loggingMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const lease = (req as any).lease as CapabilityLease;
    
    // 拦截响应
    const originalSend = res.send.bind(res);
    
    res.send = function(data: any) {
      const duration = Date.now() - startTime;
      
      // 记录请求
      this.requestLog.record({
        leaseId: lease.id,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        timestamp: startTime,
        userId: lease.lessee,
      });
      
      // 记录异常
      if (res.statusCode >= 400) {
        this.errorLog.record({
          leaseId: lease.id,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          error: data,
          timestamp: startTime,
        });
      }
      
      return originalSend(data);
    };
    
    next();
  }
  
  /**
   * 处理代理请求
   */
  private async handleProxyRequest(req: Request, res: Response): Promise<void> {
    const lease = (req as any).lease as CapabilityLease;
    const listing = await this.storage.getListing(lease.listingId) as CapabilityListing;
    
    try {
      // 构造目标 URL
      const targetUrl = new URL(
        req.path,
        listing.access.endpoint
      );
      
      // 添加查询参数
      Object.entries(req.query).forEach(([key, value]) => {
        targetUrl.searchParams.append(key, String(value));
      });
      
      // 添加认证头
      const headers = {
        ...req.headers,
      };
      
      // 根据认证方式添加凭证
      if (listing.access.authentication.type === 'api_key') {
        const apiKeyConfig = listing.access.authentication.apiKey!;
        if (apiKeyConfig.header) {
          headers[apiKeyConfig.header.toLowerCase()] = lease.credentials.apiKey;
        } else if (apiKeyConfig.query) {
          targetUrl.searchParams.append(apiKeyConfig.query, lease.credentials.apiKey!);
        }
      }
      
      // 发送代理请求
      const response = await fetch(targetUrl.toString(), {
        method: req.method,
        headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
      });
      
      // 记录使用情况
      const contentLength = response.headers.get('content-length');
      await this.recordUsage(lease, {
        method: req.method,
        path: req.path,
        statusCode: response.status,
        size: contentLength ? parseInt(contentLength, 10) : 0,
        duration: Date.now() - (req as any).startTime,
      });
      
      // 返回响应
      res.status(response.status);
      
      // 复制响应头
      response.headers.forEach((value, key) => {
        if (!['content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
          res.set(key, value);
        }
      });
      
      // 流式返回响应体
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      }
      
      res.end();
      
    } catch (error) {
      res.status(502).json({
        error: 'Bad Gateway',
        message: (error as Error).message,
      });
    }
  }
  
  /**
   * 速率限制检查
   */
  private async checkRateLimit(lease: CapabilityLease): Promise<RateLimitCheck> {
    const listing = await this.storage.getListing(lease.listingId) as CapabilityListing;
    const rateLimit = listing.quota.rateLimits[0];
    
    if (!rateLimit) {
      return { allowed: true };
    }
    
    // 获取当前窗口内的请求数
    const windowStart = Date.now() - rateLimit.period;
    const requests = await this.requestLog.count({
      leaseId: lease.id,
      timestamp: { $gte: windowStart },
    });
    
    if (requests >= rateLimit.requests) {
      // 计算重试时间
      const oldestRequest = await this.requestLog.findOldest({
        leaseId: lease.id,
        timestamp: { $gte: windowStart },
      });
      
      const retryAfter = oldestRequest
        ? oldestRequest.timestamp + rateLimit.period - Date.now()
        : rateLimit.period;
      
      return {
        allowed: false,
        retryAfter,
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * 配额检查
   */
  private async checkQuota(lease: CapabilityLease): Promise<QuotaCheck> {
    const listing = await this.storage.getListing(lease.listingId) as CapabilityListing;
    
    if (listing.quota.type === 'unlimited') {
      return { allowed: true };
    }
    
    if (listing.quota.type === 'limited' && listing.quota.limits) {
      for (const limit of listing.quota.limits) {
        const used = lease.quotaUsed[limit.name] || 0;
        if (used >= limit.limit) {
          return {
            allowed: false,
            reason: `Quota exceeded for ${limit.name}`,
          };
        }
      }
    }
    
    return { allowed: true };
  }
}

/**
 * 速率限制检查结果
 */
interface RateLimitCheck {
  allowed: boolean;
  retryAfter?: number;
}

/**
 * 配额检查结果
 */
interface QuotaCheck {
  allowed: boolean;
  reason?: string;
}
```

### 2. 能力监控与 SLA 管理

```typescript
/**
 * 能力监控系统
 */
class CapabilityMonitoring {
  /**
   * 监控指标收集
   */
  async collectMetrics(leaseId: string): Promise<CapabilityMetrics> {
    const lease = await this.storage.getLease(leaseId);
    const listing = await this.storage.getListing(lease.listingId) as CapabilityListing;
    
    const now = Date.now();
    const period = {
      start: now - 60 * 1000,  // 最后1分钟
      end: now,
    };
    
    // 收集请求日志
    const requests = await this.requestLog.query({
      leaseId,
      timestamp: { $gte: period.start, $lte: period.end },
    });
    
    if (requests.length === 0) {
      return {
        leaseId,
        period,
        requestCount: 0,
        avgLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        errorRate: 0,
        availability: 100,
      };
    }
    
    // 计算延迟指标
    const latencies = requests
      .filter(r => r.duration)
      .map(r => r.duration)
      .sort((a, b) => a - b);
    
    const metrics: CapabilityMetrics = {
      leaseId,
      period,
      requestCount: requests.length,
      avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      p50Latency: latencies[Math.floor(latencies.length * 0.50)],
      p95Latency: latencies[Math.floor(latencies.length * 0.95)],
      p99Latency: latencies[Math.floor(latencies.length * 0.99)],
      errorRate: requests.filter(r => r.statusCode >= 400).length / requests.length,
      availability: 100 - ((requests.filter(r => r.statusCode >= 500).length / requests.length) * 100),
    };
    
    return metrics;
  }
  
  /**
   * SLA 违规检查
   */
  async checkSLAViolation(listing: CapabilityListing, metrics: CapabilityMetrics): Promise<SLAViolation[]> {
    const violations: SLAViolation[] = [];
    
    if (!listing.sla) {
      return violations;
    }
    
    const { sla } = listing;
    
    // 检查延迟 SLA
    if (metrics.p50Latency > sla.responseTime.p50Target) {
      violations.push({
        type: 'latency',
        metric: 'p50_latency',
        target: sla.responseTime.p50Target,
        actual: metrics.p50Latency,
        severity: 'warning',
      });
    }
    
    if (metrics.p95Latency > sla.responseTime.p95Target) {
      violations.push({
        type: 'latency',
        metric: 'p95_latency',
        target: sla.responseTime.p95Target,
        actual: metrics.p95Latency,
        severity: 'warning',
      });
    }
    
    if (metrics.p99Latency > sla.responseTime.p99Target) {
      violations.push({
        type: 'latency',
        metric: 'p99_latency',
        target: sla.responseTime.p99Target,
        actual: metrics.p99Latency,
        severity: 'critical',
      });
    }
    
    // 检查可用性 SLA
    if (metrics.availability < sla.availability.target * 100) {
      violations.push({
        type: 'availability',
        metric: 'availability',
        target: sla.availability.target * 100,
        actual: metrics.availability,
        severity: 'critical',
      });
    }
    
    // 检查错误率
    const maxErrorRate = 1 - sla.availability.target;  // 反向推算
    if (metrics.errorRate > maxErrorRate) {
      violations.push({
        type: 'error_rate',
        metric: 'error_rate',
        target: maxErrorRate * 100,
        actual: metrics.errorRate * 100,
        severity: 'high',
      });
    }
    
    return violations;
  }
  
  /**
   * 计算 SLA 补偿
   */
  async calculateCompensation(
    listing: CapabilityListing,
    violations: SLAViolation[]
  ): Promise<Compensation[]> {
    if (!listing.sla || violations.length === 0) {
      return [];
    }
    
    const compensations: Compensation[] = [];
    
    for (const violation of violations) {
      // 查找适用的补偿规则
      for (const tier of listing.sla.compensation.tiers) {
        const downtime = 100 - violation.actual;
        
        if (downtime >= (100 - tier.availabilityThreshold * 100)) {
          const compensationAmount = this.calculateCompensationAmount(
            tier.compensationPercentage
          );
          
          compensations.push({
            violation,
            type: listing.sla.compensation.type,
            amount: compensationAmount,
            percentage: tier.compensationPercentage,
          });
          
          break;
        }
      }
    }
    
    return compensations;
  }
}

/**
 * 能力指标
 */
interface CapabilityMetrics {
  leaseId: string;
  period: { start: number; end: number };
  requestCount: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  errorRate: number;
  availability: number;
}

/**
 * SLA 违规
 */
interface SLAViolation {
  type: 'latency' | 'availability' | 'error_rate';
  metric: string;
  target: number;
  actual: number;
  severity: 'warning' | 'high' | 'critical';
}
```

---

## 定价引擎

### 1. 动态定价策略

```typescript
/**
 * 动态定价引擎
 */
class DynamicPricingEngine {
  /**
   * 计算动态价格
   */
  async calculateDynamicPrice(
    listing: MarketListing,
    context: PricingContext
  ): Promise<bigint> {
    // 基础价格
    let price = this.getBasePrice(listing);
    
    // 1. 需求乘数
    const demandMultiplier = await this.calculateDemandMultiplier(listing);
    price = BigInt(Number(price) * demandMultiplier);
    
    // 2. 供应乘数
    const supplyMultiplier = await this.calculateSupplyMultiplier(listing);
    price = BigInt(Number(price) * supplyMultiplier);
    
    // 3. 时间乘数
    const timeMultiplier = this.calculateTimeMultiplier(listing, context);
    price = BigInt(Number(price) * timeMultiplier);
    
    // 4. 用户信誉折扣
    const reputationDiscount = await this.calculateReputationDiscount(context.buyerDID);
    price = BigInt(Number(price) * (1 - reputationDiscount));
    
    // 5. 批量折扣
    if (context.quantity && context.quantity > 1) {
      const bulkDiscount = this.calculateBulkDiscount(context.quantity);
      price = BigInt(Number(price) * (1 - bulkDiscount));
    }
    
    return price;
  }
  
  /**
   * 需求乘数计算
   */
  private async calculateDemandMultiplier(listing: MarketListing): Promise<number> {
    // 基于浏览量、询问量、订单量计算需求
    const stats = listing.stats;
    
    // 转化率
    const conversionRate = stats.orders > 0
      ? stats.orders / stats.inquiries
      : 0;
    
    // 热度指数
    const popularity = (stats.views + stats.inquiries + stats.orders) / 100;
    
    // 需求评分 (0.8 - 1.5)
    let demandMultiplier = 1.0;
    
    if (conversionRate > 0.5) {
      demandMultiplier = 1.4;  // 高转化率
    } else if (conversionRate > 0.3) {
      demandMultiplier = 1.2;
    } else if (conversionRate > 0.1) {
      demandMultiplier = 1.1;
    } else if (conversionRate > 0.05) {
      demandMultiplier = 1.0;
    } else {
      demandMultiplier = 0.9;
    }
    
    // 根据热度调整
    if (popularity > 100) {
      demandMultiplier += 0.2;
    } else if (popularity < 10) {
      demandMultiplier -= 0.1;
    }
    
    return Math.min(1.5, Math.max(0.8, demandMultiplier));
  }
  
  /**
   * 供应乘数计算
   */
  private async calculateSupplyMultiplier(listing: MarketListing): Promise<number> {
    let supplyMultiplier = 1.0;
    
    if (listing.marketType === 'task') {
      const taskListing = listing as TaskListing;
      
      // 基于竞标数量
      const bidCount = await this.getBidCount(listing.id);
      
      if (bidCount > 10) {
        supplyMultiplier = 0.85;  // 供过于求
      } else if (bidCount > 5) {
        supplyMultiplier = 0.9;
      } else if (bidCount > 2) {
        supplyMultiplier = 0.95;
      } else if (bidCount === 0) {
        supplyMultiplier = 1.2;   // 供不应求
      }
    }
    
    return supplyMultiplier;
  }
  
  /**
   * 时间乘数计算
   */
  private calculateTimeMultiplier(listing: MarketListing, context: PricingContext): number {
    // 距离截止时间的天数
    const daysRemaining = (context.deadline - Date.now()) / (24 * 60 * 60 * 1000);
    
    let timeMultiplier = 1.0;
    
    if (daysRemaining < 1) {
      timeMultiplier = 1.3;  // 紧急加价
    } else if (daysRemaining < 3) {
      timeMultiplier = 1.15;
    } else if (daysRemaining < 7) {
      timeMultiplier = 1.05;
    } else if (daysRemaining > 30) {
      timeMultiplier = 0.9;   // 早期折扣
    }
    
    return timeMultiplier;
  }
  
  /**
   * 信誉折扣计算
   */
  private async calculateReputationDiscount(buyerDID: string): Promise<number> {
    const reputation = await this.reputation.getScore(buyerDID);
    
    if (reputation >= 1000) {
      return 0.15;  // 15% 折扣
    } else if (reputation >= 500) {
      return 0.10;  // 10% 折扣
    } else if (reputation >= 200) {
      return 0.05;  // 5% 折扣
    }
    
    return 0;
  }
  
  /**
   * 批量折扣计算
   */
  private calculateBulkDiscount(quantity: number): number {
    if (quantity >= 100) {
      return 0.25;  // 25% 折扣
    } else if (quantity >= 50) {
      return 0.20;
    } else if (quantity >= 20) {
      return 0.15;
    } else if (quantity >= 10) {
      return 0.10;
    } else if (quantity >= 5) {
      return 0.05;
    }
    
    return 0;
  }
}

/**
 * 定价上下文
 */
interface PricingContext {
  buyerDID: string;
  timestamp: number;
  deadline?: number;
  quantity?: number;
  region?: string;
  priority?: 'normal' | 'urgent';
}
```

---

## 匹配与推荐算法

### 1. 基于协同过滤的推荐

```typescript
/**
 * 协同过滤推荐引擎
 */
class CollaborativeFilteringEngine {
  /**
   * 用户-商品矩阵构建
   */
  async buildUserItemMatrix(): Promise<UserItemMatrix> {
    // 获取所有交易
    const transactions = await this.storage.getAllTransactions();
    
    // 构建用户-商品评分矩阵
    const matrix = new Map<string, Map<string, number>>();
    
    for (const transaction of transactions) {
      const userId = transaction.buyer.did;
      const itemId = transaction.listingId;
      
      // 评分基于：购买、评价、时间衰减等因素
      const score = this.calculateInteractionScore(transaction);
      
      if (!matrix.has(userId)) {
        matrix.set(userId, new Map());
      }
      
      matrix.get(userId)!.set(itemId, score);
    }
    
    return new UserItemMatrix(matrix);
  }
  
  /**
   * 用户相似性计算（余弦相似性）
   */
  private calculateUserSimilarity(user1: Map<string, number>, user2: Map<string, number>): number {
    // 获取共同的商品
    const commonItems = new Set(
      [...user1.keys()].filter(key => user2.has(key))
    );
    
    if (commonItems.size === 0) {
      return 0;
    }
    
    // 计算向量点积
    let dotProduct = 0;
    for (const item of commonItems) {
      dotProduct += user1.get(item)! * user2.get(item)!;
    }
    
    // 计算向量模长
    let magnitude1 = 0;
    for (const score of user1.values()) {
      magnitude1 += score * score;
    }
    magnitude1 = Math.sqrt(magnitude1);
    
    let magnitude2 = 0;
    for (const score of user2.values()) {
      magnitude2 += score * score;
    }
    magnitude2 = Math.sqrt(magnitude2);
    
    // 余弦相似性
    return magnitude1 > 0 && magnitude2 > 0
      ? dotProduct / (magnitude1 * magnitude2)
      : 0;
  }
  
  /**
   * 推荐计算
   */
  async recommend(userId: string, k: number = 5, limit: number = 10): Promise<Recommendation[]> {
    const matrix = await this.buildUserItemMatrix();
    
    // 1. 找到最相似的 k 个用户
    const userVector = matrix.get(userId);
    if (!userVector) {
      return [];
    }
    
    const similarities: { userId: string; similarity: number }[] = [];
    
    for (const [otherUserId, otherVector] of matrix.entries()) {
      if (otherUserId === userId) continue;
      
      const similarity = this.calculateUserSimilarity(userVector, otherVector);
      if (similarity > 0) {
        similarities.push({ userId: otherUserId, similarity });
      }
    }
    
    // 2. 按相似度排序并取前 k 个
    const nearestNeighbors = similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
    
    // 3. 基于邻居的推荐
    const recommendations = new Map<string, number>();
    
    for (const { userId: neighborId, similarity } of nearestNeighbors) {
      const neighborVector = matrix.get(neighborId)!;
      
      for (const [itemId, score] of neighborVector.entries()) {
        // 跳过用户已经有的商品
        if (userVector.has(itemId)) continue;
        
        // 累加加权评分
        const weightedScore = score * similarity;
        recommendations.set(
          itemId,
          (recommendations.get(itemId) || 0) + weightedScore
        );
      }
    }
    
    // 4. 排序并返回
    const results: Recommendation[] = [];
    for (const [itemId, score] of recommendations.entries()) {
      results.push({
        itemId,
        score,
        reason: 'collaborative_filtering',
      });
    }
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/**
 * 用户-商品矩阵
 */
class UserItemMatrix {
  constructor(private matrix: Map<string, Map<string, number>>) {}
  
  get(userId: string): Map<string, number> | undefined {
    return this.matrix.get(userId);
  }
  
  set(userId: string, vector: Map<string, number>): void {
    this.matrix.set(userId, vector);
  }
  
  entries(): IterableIterator<[string, Map<string, number>]> {
    return this.matrix.entries();
  }
}

/**
 * 推荐结果
 */
interface Recommendation {
  itemId: string;
  score: number;
  reason: string;
}
```

---

## 支付与托管系统

### 1. 里程碑式支付

```typescript
/**
 * 里程碑支付管理
 */
class MilestonePaymentManager {
  /**
   * 创建里程碑托管
   */
  async createMilestoneEscrow(params: CreateMilestoneEscrowParams): Promise<MilestoneEscrow> {
    const { orderId, milestones, total } = params;
    
    // 验证里程碑配置
    const totalPercentage = milestones.reduce((sum, m) => sum + m.percentage, 0);
    if (totalPercentage !== 100) {
      throw new Error('Milestone percentages must sum to 100');
    }
    
    const escrow: MilestoneEscrow = {
      id: generateId(),
      orderId,
      total,
      milestones: milestones.map(m => ({
        id: generateId(),
        name: m.name,
        percentage: m.percentage,
        amount: BigInt(Math.floor(Number(total) * m.percentage / 100)),
        deadline: m.deadline,
        status: 'pending',
        deliverables: m.deliverables,
      })),
      status: 'active',
      createdAt: Date.now(),
    };
    
    // 冻结总额
    await this.wallet.freeze({
      amount: total,
      holder: params.payer,
      purpose: 'milestone_escrow',
      escrowId: escrow.id,
    });
    
    await this.storage.saveMilestoneEscrow(escrow);
    
    return escrow;
  }
  
  /**
   * 发布里程碑
   */
  async releaseMilestone(
    escrowId: string,
    milestoneId: string,
    approverDID: string
  ): Promise<void> {
    const escrow = await this.storage.getMilestoneEscrow(escrowId);
    const milestone = escrow.milestones.find(m => m.id === milestoneId);
    
    if (!milestone) {
      throw new Error('Milestone not found');
    }
    
    // 验证权限（需要是买方）
    const order = await this.storage.getOrder(escrow.orderId);
    if (order.buyer.did !== approverDID) {
      throw new Error('Only buyer can release payment');
    }
    
    // 更新里程碑状态
    milestone.status = 'released';
    milestone.releasedAt = Date.now();
    
    // 转账给卖方
    await this.wallet.transfer({
      from: 'escrow',
      to: order.seller.did,
      amount: milestone.amount,
      memo: `Milestone payment: ${milestone.name}`,
      escrowId,
    });
    
    // 检查是否所有里程碑都已发布
    const allReleased = escrow.milestones.every(m => m.status === 'released');
    if (allReleased) {
      escrow.status = 'completed';
    }
    
    await this.storage.saveMilestoneEscrow(escrow);
  }
  
  /**
   * 部分退款
   */
  async partialRefund(
    escrowId: string,
    refundReason: string,
    refundPercentage: number
  ): Promise<void> {
    const escrow = await this.storage.getMilestoneEscrow(escrowId);
    const order = await this.storage.getOrder(escrow.orderId);
    
    // 计算退款金额
    const totalUnreleased = escrow.milestones
      .filter(m => m.status === 'pending')
      .reduce((sum, m) => sum + m.amount, 0n);
    
    const refundAmount = BigInt(
      Math.floor(Number(totalUnreleased) * refundPercentage / 100)
    );
    
    // 转账给买方
    await this.wallet.transfer({
      from: 'escrow',
      to: order.buyer.did,
      amount: refundAmount,
      memo: `Partial refund: ${refundReason}`,
      escrowId,
    });
    
    // 转账给卖方
    await this.wallet.transfer({
      from: 'escrow',
      to: order.seller.did,
      amount: totalUnreleased - refundAmount,
      memo: 'Partial milestone completion',
      escrowId,
    });
    
    escrow.status = 'refunded';
    await this.storage.saveMilestoneEscrow(escrow);
  }
  
  /**
   * 里程碑逾期处理
   */
  async handleMilestoneOverdue(escrowId: string, milestoneId: string): Promise<void> {
    const escrow = await this.storage.getMilestoneEscrow(escrowId);
    const milestone = escrow.milestones.find(m => m.id === milestoneId);
    
    if (!milestone || milestone.status !== 'pending') {
      return;
    }
    
    // 标记为逾期
    milestone.overdue = true;
    milestone.overdueAt = Date.now();
    
    // 发送警告通知
    const order = await this.storage.getOrder(escrow.orderId);
    await this.notify(order.seller.did, 'milestone_overdue', {
      milestone,
      order,
    });
    
    // 设置进一步处理的定时任务
    await this.scheduler.schedule({
      task: 'enforce_overdue_penalty',
      escrowId,
      milestoneId,
      delay: 7 * 24 * 60 * 60 * 1000,  // 7天后
    });
  }
}

/**
 * 里程碑托管
 */
interface MilestoneEscrow {
  id: string;
  orderId: string;
  total: bigint;
  milestones: {
    id: string;
    name: string;
    percentage: number;
    amount: bigint;
    deadline?: number;
    status: 'pending' | 'released' | 'cancelled';
    deliverables: string[];
    releasedAt?: number;
    overdue?: boolean;
    overdueAt?: number;
  }[];
  status: 'active' | 'completed' | 'refunded' | 'cancelled';
  createdAt: number;
}
```

---

## 性能优化

### 1. 缓存策略

```typescript
/**
 * 多层缓存策略
 */
class MarketingCacheStrategy {
  /**
   * 缓存层级设计
   */
  // L1: 本地内存缓存（热数据）
  private l1Cache = new Map<string, CacheEntry>();
  
  // L2: Redis 缓存（分布式）
  private l2Cache = new Redis();
  
  // L3: 数据库缓存表（持久化）
  private l3Cache = new Database('cache_table');
  
  /**
   * 获取数据（多层查询）
   */
  async get<T>(key: string): Promise<T | undefined> {
    // L1 查询
    const l1Result = this.l1Cache.get(key);
    if (l1Result && !l1Result.expired) {
      l1Result.accessCount++;
      l1Result.lastAccess = Date.now();
      return l1Result.value as T;
    }
    
    // L1 过期，删除
    if (l1Result?.expired) {
      this.l1Cache.delete(key);
    }
    
    // L2 查询
    const l2Result = await this.l2Cache.get(key);
    if (l2Result) {
      // 晋升到 L1
      this.l1Cache.set(key, {
        value: l2Result,
        ttl: 5 * 60 * 1000,  // 5 分钟
        createdAt: Date.now(),
        accessCount: 1,
        lastAccess: Date.now(),
      });
      return l2Result as T;
    }
    
    // L3 查询
    const l3Result = await this.l3Cache.get(key);
    if (l3Result) {
      // 晋升到 L2
      await this.l2Cache.set(key, l3Result, 30 * 60);  // 30 分钟 TTL
      
      // 晋升到 L1
      this.l1Cache.set(key, {
        value: l3Result,
        ttl: 5 * 60 * 1000,
        createdAt: Date.now(),
        accessCount: 1,
        lastAccess: Date.now(),
      });
      
      return l3Result as T;
    }
    
    return undefined;
  }
  
  /**
   * 设置数据
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const entry: CacheEntry = {
      value,
      ttl: ttl || 60 * 60 * 1000,  // 默认 1 小时
      createdAt: Date.now(),
      accessCount: 0,
      lastAccess: Date.now(),
    };
    
    // 写入所有层
    this.l1Cache.set(key, entry);
    
    await this.l2Cache.set(key, value, ttl ? Math.ceil(ttl / 1000) : 3600);
    
    if (ttl && ttl > 24 * 60 * 60 * 1000) {  // 只缓存大于24小时的数据到 L3
      await this.l3Cache.set(key, value);
    }
  }
  
  /**
   * 缓存预热
   */
  async warmup(): Promise<void> {
    // 预热热点数据
    const hotListings = await this.db.query({
      status: 'active',
      views: { $gt: 100 },
      limit: 1000,
    });
    
    for (const listing of hotListings) {
      await this.set(`listing:${listing.id}`, listing, 60 * 60 * 1000);
    }
    
    // 预热热点商品推荐
    const topAgents = await this.db.query({
      role: 'agent',
      reputation: { $gt: 500 },
      limit: 100,
    });
    
    for (const agent of topAgents) {
      const recommendations = await this.generateRecommendations(agent.did);
      await this.set(`recommendations:${agent.did}`, recommendations, 24 * 60 * 60 * 1000);
    }
  }
  
  /**
   * 缓存失效策略
   */
  async invalidate(pattern: string): Promise<void> {
    // L1 失效
    for (const key of this.l1Cache.keys()) {
      if (this.matchPattern(key, pattern)) {
        this.l1Cache.delete(key);
      }
    }
    
    // L2 失效
    await this.l2Cache.deletePattern(pattern);
    
    // L3 失效
    await this.l3Cache.deletePattern(pattern);
  }
}

/**
 * 缓存条目
 */
interface CacheEntry {
  value: any;
  ttl: number;
  createdAt: number;
  accessCount: number;
  lastAccess: number;
  expired?: boolean;
}
```

---

## 实现案例

### 案例 1: 完整的信息交易流程

```typescript
/**
 * 完整的信息交易案例
 */
async function completeInfoTransaction() {
  const market = new InfoMarketService();
  
  // 1. 卖方发布信息
  const listing = await market.publishInfo({
    sellerDID: 'did:claw:seller123',
    title: 'Market Analysis Report 2026',
    description: 'Comprehensive analysis of the crypto market...',
    infoType: 'analysis',
    content: {
      format: 'json',
      data: { /* analysis data */ },
    },
    pricing: {
      type: 'fixed',
      fixedPrice: 100n,
    },
    license: {
      type: 'non_exclusive',
      permissions: {
        use: true,
        modify: false,
        distribute: false,
        commercialize: false,
      },
    },
  });
  
  console.log('Information published:', listing.id);
  
  // 2. 买方搜索和查看商品
  const searchResults = await market.search({
    keyword: 'market analysis',
    markets: ['info'],
    priceRange: { max: 200n },
  });
  
  const targetListing = searchResults.listings[0];
  console.log('Found listing:', targetListing.title);
  
  // 3. 买方购买
  const order = await market.purchaseInfo({
    buyerDID: 'did:claw:buyer456',
    listingId: targetListing.id,
  });
  
  console.log('Order created:', order.id);
  
  // 4. 系统创建托管
  // 自动处理...
  
  // 5. 卖方交付信息
  const delivery = await market.deliverInfo(order.id, listing.seller.did);
  console.log('Information delivered:', delivery.accessUrl);
  
  // 6. 买方确认接收
  await market.confirmReceipt(order.id, 'did:claw:buyer456');
  console.log('Receipt confirmed, payment released');
  
  // 7. 双向评价
  await market.submitReview(order.id, {
    reviewer: 'did:claw:buyer456',
    rating: 5,
    comment: 'Excellent analysis!',
  });
  
  console.log('Transaction completed successfully');
}
```

### 案例 2: 任务竞标与执行

```typescript
/**
 * 任务竞标和执行案例
 */
async function completeTaskTransaction() {
  const market = new TaskMarketService();
  
  // 1. 客户发布任务
  const task = await market.publishTask({
    clientDID: 'did:claw:client789',
    title: 'React Native Mobile App Development',
    description: 'Build a mobile app for...',
    requirements: 'Detailed requirements...',
    taskType: 'project',
    complexity: 'moderate',
    estimatedDuration: 30 * 24 * 60 * 60 * 1000,  // 30 days
    deliverables: [
      {
        name: 'Source Code',
        type: 'code',
        acceptanceCriteria: [
          'Code follows best practices',
          'All unit tests pass',
          'No critical bugs',
        ],
      },
      {
        name: 'Documentation',
        type: 'report',
        acceptanceCriteria: ['Complete API documentation'],
      },
    ],
    skills: [
      { name: 'React Native', level: 'advanced', required: true },
      { name: 'TypeScript', level: 'intermediate', required: true },
    ],
    pricing: {
      type: 'range',
      priceRange: {
        min: 500n,
        max: 2000n,
      },
    },
    milestones: [
      { name: 'Design Review', percentage: 20, deadline: Date.now() + 7 * 24 * 60 * 60 * 1000 },
      { name: 'MVP Development', percentage: 40, deadline: Date.now() + 14 * 24 * 60 * 60 * 1000 },
      { name: 'Final Delivery', percentage: 40, deadline: Date.now() + 30 * 24 * 60 * 60 * 1000 },
    ],
  });
  
  console.log('Task published:', task.id);
  
  // 2. 工作者提交竞标
  const bid1 = await market.submitBid({
    taskId: task.id,
    bidderDID: 'did:claw:developer001',
    price: 1000n,
    timeline: 28 * 24 * 60 * 60 * 1000,
    approach: 'I will use React Native with...',
    milestones: [
      { name: 'Design Review', days: 5 },
      { name: 'MVP Development', days: 12 },
      { name: 'Final Delivery', days: 11 },
    ],
  });
  
  const bid2 = await market.submitBid({
    taskId: task.id,
    bidderDID: 'did:claw:developer002',
    price: 800n,
    timeline: 25 * 24 * 60 * 60 * 1000,
    approach: 'Using Expo for faster development...',
  });
  
  console.log('Bids submitted:', [bid1.id, bid2.id]);
  
  // 3. 客户评价并接受最佳竞标
  const selectedBid = bid1;  // 选择第一个开发者
  const order = await market.acceptBid(selectedBid.id, task.seller.did);
  
  console.log('Bid accepted, order created:', order.id);
  
  // 4. 里程碑1: 设计评审
  const submission1 = await market.submitWork({
    orderId: order.id,
    workerDID: 'did:claw:developer001',
    milestoneId: task.milestones[0].id,
    deliverables: [
      {
        definitionId: task.deliverables[0].id,
        name: 'Design Documentation',
        type: 'report',
        content: 'Design docs...',
      },
    ],
  });
  
  // 客户审核
  await market.reviewSubmission({
    submissionId: submission1.id,
    clientDID: 'did:claw:client789',
    approved: true,
    rating: 5,
  });
  
  // 释放里程碑1的资金
  await market.releaseMilestonePayment(order.id, task.milestones[0].id);
  
  console.log('Milestone 1 completed and paid');
  
  // 5. 里程碑2 & 3: 继续开发...
  // ... 类似流程 ...
  
  // 6. 最终完成
  console.log('Project completed successfully');
}
```

---

*文档完成于 2026年2月2日*
*版本: 1.0*
