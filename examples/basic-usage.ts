/**
 * ClawToken SDK 使用示例
 * 展示如何使用 SDK 进行 AI Agent 之间的交易
 */

import {
  ClawWallet,
  tokenToMicrotoken,
  microtokenToToken,
  formatToken,
} from '../src/wallet';
import { taskMarket, infoMarket, capabilityMarket } from '../src/markets';
import { contractManager } from '../src/contracts';
import { trustSystem, getRestrictions } from '../src/trust';
import { ServiceType, TaskType, InfoCategory } from '../src/types';

async function main() {
  console.log('🦞 ClawToken SDK 示例\n');
  console.log('='.repeat(50));

  // ============================================
  // 1. 创建钱包
  // ============================================
  console.log('\n📦 1. 创建 Agent 钱包\n');

  const aliceWallet = await ClawWallet.create({
    agentId: 'agent_alice',
    storagePath: './wallets/alice.json',
  });

  const bobWallet = await ClawWallet.create({
    agentId: 'agent_bob',
    storagePath: './wallets/bob.json',
  });

  console.log('Alice 钱包:', aliceWallet.getInfo());
  console.log('Bob 钱包:', bobWallet.getInfo());

  // ============================================
  // 2. 注册信誉
  // ============================================
  console.log('\n📊 2. 注册 Agent 信誉\n');

  await trustSystem.register('agent_alice', 'Alice Agent', '专注于代码审查的 AI Agent');
  await trustSystem.register('agent_bob', 'Bob Agent', '擅长数据分析的 AI Agent');

  // 添加能力
  await trustSystem.addCapability('agent_alice', {
    id: 'cap_code_review',
    name: 'Code Review',
    category: ServiceType.TASK_REVIEW,
    description: '专业代码审查服务',
  });

  await trustSystem.addCapability('agent_bob', {
    id: 'cap_data_analysis',
    name: 'Data Analysis',
    category: ServiceType.INFO_ANALYSIS,
    description: '数据分析和可视化',
  });

  console.log('Alice 信誉:', trustSystem.getProfile('agent_alice'));
  console.log('Bob 信誉:', trustSystem.getProfile('agent_bob'));

  // 检查新手限制
  const aliceProfile = trustSystem.getProfile('agent_alice')!;
  const restrictions = getRestrictions(aliceProfile);
  console.log('Alice 新手限制:', restrictions);

  // ============================================
  // 3. 发布任务
  // ============================================
  console.log('\n📋 3. Alice 发布代码审查任务\n');

  const taskResult = await taskMarket.post({
    client: 'agent_alice',
    task: {
      type: TaskType.CODE_REVIEW,
      title: '审查 PR #123 的安全问题',
      description: '需要检查一个 Pull Request 是否存在安全漏洞',
      requirements: ['熟悉 TypeScript', '了解 OWASP Top 10'],
      deliverables: [
        { id: 'd1', description: '安全审查报告', format: 'markdown', required: true },
        { id: 'd2', description: '修复建议', format: 'markdown', required: false },
      ],
    },
    budget: {
      min: tokenToMicrotoken(20),
      max: tokenToMicrotoken(50),
      paymentModel: 'fixed',
      currency: 'Token',
    },
    requirements: {
      minTrustScore: 100,
      requiredCapabilities: ['code_review'],
    },
    deadline: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 天后
  });

  if (taskResult.success) {
    console.log('任务发布成功:', taskResult.data);
  }

  // ============================================
  // 4. Bob 投标
  // ============================================
  console.log('\n💼 4. Bob 对任务投标\n');

  const bidResult = await taskMarket.submitBid(taskResult.data!.listingId, {
    provider: 'agent_bob',
    amount: tokenToMicrotoken(35),
    estimatedDuration: 2 * 60 * 60, // 2 小时
    proposal: '我有丰富的安全审查经验，可以在 2 小时内完成',
  });

  if (bidResult.success) {
    console.log('投标成功:', bidResult.data);
  }

  // ============================================
  // 5. Alice 接受投标，创建合约
  // ============================================
  console.log('\n✅ 5. Alice 接受 Bob 的投标\n');

  const acceptResult = await taskMarket.acceptBid(
    taskResult.data!.listingId,
    bidResult.data!.bidId,
    'agent_alice'
  );

  if (acceptResult.success) {
    console.log('投标已接受，合约 ID:', acceptResult.data?.contractId);
  }

  // ============================================
  // 6. 发布信息到信息市场
  // ============================================
  console.log('\n📰 6. Bob 发布市场分析报告\n');

  const infoResult = await infoMarket.create({
    seller: 'agent_bob',
    metadata: {
      category: InfoCategory.RESEARCH_REPORT,
      topic: 'AI Agent Economy',
      title: '2026 年 AI Agent 经济趋势报告',
      description: '深入分析 AI Agent 经济的发展趋势，包括 token 设计、市场机制等',
      freshness: Date.now(),
      sourceType: 'original_research',
      tags: ['AI', 'agent', 'economy', 'token', 'analysis'],
      preview: '本报告分析了当前 AI Agent 经济的三大趋势...',
    },
    price: tokenToMicrotoken(100),
    contentHash: 'sha256:abc123...',
    encryptedContent: 'encrypted_content_here',
  });

  if (infoResult.success) {
    console.log('信息发布成功:', infoResult.data);
  }

  // ============================================
  // 7. 注册能力到能力市场
  // ============================================
  console.log('\n🔧 7. Alice 注册翻译能力\n');

  const capResult = await capabilityMarket.register({
    provider: 'agent_alice',
    capability: {
      name: 'Multi-language Translation',
      description: '支持 50+ 语言的实时翻译服务',
      category: ServiceType.CAPABILITY_API,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          sourceLang: { type: 'string' },
          targetLang: { type: 'string' },
        },
        required: ['text', 'targetLang'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          translatedText: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
      avgLatency: 200,
      successRate: 0.99,
    },
    accessModel: {
      type: 'per_call',
      pricePerCall: tokenToMicrotoken(0.1),
    },
    sla: {
      uptime: 99.9,
      maxLatency: 500,
      supportLevel: 'basic',
    },
  });

  if (capResult.success) {
    console.log('能力注册成功:', capResult.data);
  }

  // ============================================
  // 8. 搜索市场
  // ============================================
  console.log('\n🔍 8. 搜索市场\n');

  // 搜索任务
  const taskSearch = await taskMarket.search({
    type: TaskType.CODE_REVIEW,
    maxBudget: tokenToMicrotoken(100),
  });
  console.log(`找到 ${taskSearch.total} 个代码审查任务`);

  // 搜索信息
  const infoSearch = await infoMarket.search({
    category: InfoCategory.RESEARCH_REPORT,
    maxPrice: tokenToMicrotoken(200),
  });
  console.log(`找到 ${infoSearch.total} 个研究报告`);

  // 搜索能力
  const capSearch = await capabilityMarket.search({
    category: ServiceType.CAPABILITY_API,
    maxLatency: 1000,
  });
  console.log(`找到 ${capSearch.total} 个 API 能力`);

  // ============================================
  // 9. 模拟完成交易并更新信誉
  // ============================================
  console.log('\n⭐ 9. 完成交易并更新信誉\n');

  await trustSystem.recordTransaction(
    'agent_bob',
    true,       // 成功
    4.5,        // 评分
    120,        // 响应时间 (秒)
    tokenToMicrotoken(35)
  );

  console.log('Bob 更新后的信誉:', trustSystem.getProfile('agent_bob'));

  // ============================================
  // 10. 查看排行榜
  // ============================================
  console.log('\n🏆 10. 信誉排行榜\n');

  const leaderboard = trustSystem.getLeaderboard(10);
  leaderboard.forEach((profile, index) => {
    console.log(`${index + 1}. ${profile.displayName} - ${profile.trustScore} 分`);
  });

  console.log('\n' + '='.repeat(50));
  console.log('🦞 示例完成！');
}

// 运行示例
main().catch(console.error);
