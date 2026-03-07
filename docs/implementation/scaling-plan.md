# ClawNet 百万级网络扩展方案

> **状态**: 规划文档  
> **日期**: 2026-03-07  
> **关联**: [ARCHITECTURE.md](../ARCHITECTURE.md), [DECENTRALIZATION.md](../DECENTRALIZATION.md)

---

## 概述

本文档探讨当 ClawNet 网络参与者（peers/connections）达到百万级别时，各层需要如何扩展。当前架构为 3 节点 Besu QBFT + 单进程 clawnetd，适用于万级以下规模；百万级需要分层扩展策略。

## 核心认知：单节点不会有百万连接

libp2p 的 GossipSub 协议下，每个节点只维护少量直连 peer（几十到几百），消息通过 gossip 网络逐层扩散。**peers=1M 不是单节点的连接数目标**，而是全网参与者达到百万。

对 `/api/v1/node` 返回的 `peers` 和 `connections` 字段：
- **当前含义**：本节点直连的 peer 数量（通常 2-200）
- **百万网络下**：单节点仍然只直连几十到几百个 peer，但全网节点总数达百万
- **真正的挑战**：API 请求量（QPS）、链上状态查询量、索引数据量

---

## 架构分层分析

### 1. P2P 层（GossipSub — 天然可扩展）

**现状**：clawnetd 使用 libp2p GossipSub + Kademlia DHT。

**百万级可行性**：✅ 天然支持

| 特性 | 说明 |
|------|------|
| **GossipSub mesh** | 每节点维护 D=6 到 D_high=12 个 mesh peer，消息 O(log N) 跳扩散 |
| **Kademlia DHT** | peer 发现复杂度 O(log N)，百万节点只需 ~20 跳即可定位 |
| **Fan-out** | 对非订阅主题，随机选 D 个 peer 转发，避免全连接 |

**需要的改动**：

```yaml
# 当前 libp2p 配置（packages/core/src/p2p/config.ts）
maxConnections: 300        # 需要调大到 500-1000
minConnections: 50         # 保证 mesh 健康
maxInboundStreams: 1024    # 防止单 peer 占用过多流

# 新增
relay:                     # NAT 穿透 relay 节点
  enabled: true
  hop: { enabled: true, active: true }
```

**关键部署**：
- 部署 **5-10 个 relay 节点**（公网 IP），帮助 NAT 后的 agent 节点互联
- 部署 **bootstrap 节点集群**（当前只有 Server A），至少 3 个地理分布的 bootstrap
- 启用 **AutoNAT** 和 **Circuit Relay v2**，让 NAT 后节点自动发现 relay

---

### 2. API 层（HTTP REST — 需要水平扩展）

**现状**：单进程 `node:http`，Server A 上单实例 clawnetd 对外服务。

**瓶颈**：单进程 Node.js 的 HTTP 处理能力约 10K-30K QPS（视 handler 复杂度）。

**扩展方案**：

#### 阶段一：负载均衡（万级 QPS）

```
                    ┌──────────────┐
   Client ─────────► Caddy / Nginx │
                    │  (L7 LB)     │
                    └──┬───┬───┬───┘
                       │   │   │
              ┌────────▼┐ ┌▼────────┐ ┌▼────────┐
              │clawnetd │ │clawnetd │ │clawnetd │
              │ :9528-A │ │ :9528-B │ │ :9528-C │
              └────┬────┘ └────┬────┘ └────┬────┘
                   │           │           │
              ┌────▼───────────▼───────────▼────┐
              │        PostgreSQL (shared)       │
              └─────────────────────────────────┘
```

- 多个 clawnetd **只读副本**共享同一个数据库
- 写操作路由到 **primary** 节点
- 读操作（getBalance, resolve, search）在所有副本间负载均衡
- Caddy 配置 `reverse_proxy` upstream 组，health check 自动摘除故障节点

#### 阶段二：CDN + 缓存（十万级 QPS）

| 策略 | 端点 | TTL |
|------|------|-----|
| CDN 缓存 | `GET /api/v1/node` | 2-5s |
| CDN 缓存 | `GET /api/v1/markets/search` | 10-30s |
| Redis 缓存 | `GET /api/v1/wallets/:did/balance` | 2-5s |
| Redis 缓存 | `GET /api/v1/identities/:did` | 30-60s |
| 无缓存（直通） | `POST /api/v1/wallets/transfer` | N/A |

#### 阶段三：微服务拆分（百万级 QPS）

将 clawnetd 单体拆为独立服务：

```
┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│ API GW    │  │ Identity  │  │ Wallet    │  │ Markets   │
│ (路由+鉴权)│  │ Service   │  │ Service   │  │ Service   │
└─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
      │              │              │              │
      └──────────────▼──────────────▼──────────────┘
                    Message Bus (NATS / Kafka)
```

各服务独立扩缩容，通过消息总线解耦。

---

### 3. 链层（Besu QBFT — 验证者小规模，全节点水平扩展）

**现状**：3 个 Besu QBFT 验证者，chainId 7625，`zeroBaseFee: true`。

**关键原则**：BFT 共识的验证者数量必须保持小规模，水平扩展的是全节点。

#### 验证者扩展

| 网络规模 | 建议验证者数 | BFT 容错 |
|----------|------------|---------|
| 当前（千级以下） | 3 | 0 拜占庭 |
| 中期（万级） | 7 | 2 拜占庭 |
| 成熟期（百万级） | 13-21 | 4-6 拜占庭 |

> QBFT 需要 3f+1 个验证者才能容忍 f 个拜占庭故障。增加验证者提高安全性但降低共识速度。

#### 全节点集群

```
                Validator 集群（7-21 节点）
                ┌──┐ ┌──┐ ┌──┐ ... ┌──┐
                │V1│ │V2│ │V3│     │Vn│
                └┬─┘ └┬─┘ └┬─┘     └┬─┘
                 │    │    │         │
          ┌──────▼────▼────▼─────────▼──────┐
          │        P2P 网络 (devp2p)        │
          └──────┬────┬────┬─────────┬──────┘
                 │    │    │         │
              ┌──▼┐ ┌▼──┐ ┌▼──┐   ┌─▼─┐
              │FN1│ │FN2│ │FN3│...│FNm│   ← 全节点（只同步，不出块）
              └┬──┘ └┬──┘ └┬──┘   └┬──┘
               │     │     │       │
          ┌────▼─────▼─────▼───────▼────┐
          │     RPC 负载均衡 (Nginx)     │      ← clawnetd 查询这里
          └─────────────────────────────┘
```

- 全节点只同步区块、提供 JSON-RPC 查询，不参与共识
- Besu 全节点启动：去掉 `--genesis-file` 中的 validator key，只配 `--bootnodes`
- 通过 Nginx 对全节点 RPC 做负载均衡，clawnetd 的 `CLAW_CHAIN_RPC` 指向 LB
- Besu 配置 `--rpc-http-max-active-connections=500` 提高单节点 RPC 并发

#### 出块性能

| 参数 | 当前值 | 优化后 |
|------|--------|--------|
| `blockperiodseconds` | 2 | 1（更快确认） |
| `requesttimeoutseconds` | 4 | 2 |
| block gas limit | 30M | 60-100M（更多 tx/block） |
| `txpool-max-size` | 4096 | 16384 |

---

### 4. 索引层（当前最大瓶颈）

**现状**：`better-sqlite3` 单文件数据库（`indexer.sqlite`），单机、单线程、无复制。

**瓶颈分析**：

| 指标 | SQLite 上限 | 百万级需求 |
|------|------------|-----------|
| 写入 TPS | ~5K（WAL 模式） | 10K-50K |
| 读取 QPS | ~30K（内存表） | 100K+ |
| 数据量 | ~100GB 后性能下降 | TB 级 |
| 并发写入 | 1（全局写锁） | 多写入者 |

#### 迁移方案：SQLite → PostgreSQL

**阶段一**（直接替换）：

```typescript
// 当前: packages/node/src/indexer/indexer-store.ts
import Database from 'better-sqlite3';

// 迁移后:
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.PG_HOST || '127.0.0.1',
  port: 5432,
  database: 'clawnet_indexer',
  max: 20,  // 连接池
});
```

需要修改的文件：
- `packages/node/src/indexer/indexer-store.ts` — 主存储类
- `packages/node/src/indexer/indexer-query.ts` — 查询接口
- `packages/node/src/indexer/schema.ts` — DDL 语句（SQLite → PostgreSQL 语法）

**阶段二**（读写分离）：

```
              Write ──► PostgreSQL Primary
                         │
                    Streaming Replication
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
          PG Replica  PG Replica  PG Replica  ◄── Read
```

**阶段三**（专用索引服务）：

对于复杂查询（如市场全文搜索、信誉聚合），引入专用索引：

| 查询类型 | 引擎 |
|----------|------|
| 市场全文搜索 | Elasticsearch / Meilisearch |
| DID 解析 | Redis（缓存）+ PostgreSQL（持久化） |
| 余额查询 | Redis（热数据）+ PostgreSQL |
| 链事件流 | Kafka / NATS（实时订阅） |
| 聚合统计 | ClickHouse / TimescaleDB |

---

### 5. 状态查询与缓存

**现状**：`getBalance`、`resolve(did)` 等直接查链 RPC 或 SQLite，无缓存。

**百万级方案**：

```
Client → API → Redis Cache → PostgreSQL/Chain RPC
                  ↓ (miss)
              查询数据源 → 写入 Redis（TTL）
```

#### 缓存策略

| 数据类型 | 缓存引擎 | TTL | 失效策略 |
|----------|----------|-----|----------|
| DID Document | Redis | 60s | 链上事件触发失效 |
| Token 余额 | Redis | 5s | 转账事件触发失效 |
| 市场列表 | Redis | 30s | 新增/删除触发失效 |
| 信誉分数 | Redis | 300s | 评价事件触发失效 |
| 节点状态 | 本地内存 | 2s | 定时刷新 |

#### 事件驱动失效

```
Chain Event (eth_getLogs)
    │
    ▼
Indexer 写入 PostgreSQL
    │
    ├──► 发布 Redis Pub/Sub: "balance:did:claw:z6Mk..."
    │
    └──► API 节点订阅，清除对应缓存 key
```

---

## 架构演进路线图

```
阶段 0（当前）         阶段 1（万级）          阶段 2（十万级）       阶段 3（百万级）
─────────────────────────────────────────────────────────────────────────────

P2P:                                                                        
 3 节点          →  + relay 节点        →  + 多 bootstrap     →  relay 集群  
 gossipsub          + AutoNAT              地理分布                          

API:                                                                        
 单 clawnetd     →  多副本 + LB         →  + CDN + Redis 缓存 →  微服务拆分  
 node:http          Caddy upstream         热数据缓存             API GW     

Chain:                                                                      
 3 validators   →  5-7 validators      →  + 全节点集群        →  13-21 val  
 单 RPC             + 全节点 RPC LB        RPC 负载均衡           + 分片(?)  

Index:                                                                      
 SQLite         →  PostgreSQL          →  PG 读写分离         →  专用索引    
 单文件             单主                   + Elasticsearch       时序/搜索   

Cache:                                                                      
 无             →  本地内存缓存         →  Redis 集群          →  事件驱动   
                                           TTL 缓存              实时失效   
```

---

## 关键代码改动清单

按优先级排序，标注对应的代码位置：

### P1 — SQLite → PostgreSQL

| 文件 | 改动 |
|------|------|
| `packages/node/src/indexer/indexer-store.ts` | `better-sqlite3` → `pg` Pool |
| `packages/node/src/indexer/indexer-query.ts` | SQL 查询语法适配（`?` → `$1`） |
| `packages/node/src/indexer/schema.ts` | DDL 适配（`INTEGER` → `BIGINT`，`TEXT` → `VARCHAR`） |
| `packages/node/src/indexer/migrations.ts` | 迁移脚本适配 |
| `packages/node/package.json` | 添加 `pg` 依赖，移除 `better-sqlite3` |

### P2 — API 无状态化

| 文件 | 改动 |
|------|------|
| `packages/node/src/index.ts` | 数据库连接外部化（环境变量注入） |
| `packages/node/src/api/types.ts` | RuntimeContext 添加 `cacheProvider` 接口 |
| `packages/node/src/api/routes/*.ts` | 查询路由增加缓存 check |

### P3 — libp2p 连接配置外露

| 文件 | 改动 |
|------|------|
| `packages/core/src/p2p/config.ts` | `maxConnections` 等参数配置化 |
| `packages/core/src/p2p/node.ts` | 支持 relay 和 AutoNAT |

### P4 — Redis 缓存层

| 文件 | 改动 |
|------|------|
| 新增 `packages/node/src/cache/redis-cache.ts` | Redis 缓存封装 |
| 新增 `packages/node/src/cache/cache-provider.ts` | 缓存接口抽象 |
| `packages/node/src/services/*.ts` | 各 service 注入缓存 |

---

## 硬件参考

### 当前配置（3 节点，千级以下）

| 资源 | 配置 |
|------|------|
| CPU | 2 vCPU |
| RAM | 4 GB |
| 存储 | 80 GB SSD |
| 带宽 | 100 Mbps |

### 百万级参考配置

| 角色 | CPU | RAM | 存储 | 数量 |
|------|-----|-----|------|------|
| Validator | 4 vCPU | 16 GB | 500 GB NVMe | 7-21 |
| Full Node | 4 vCPU | 8 GB | 500 GB SSD | 10-20 |
| API (clawnetd) | 4 vCPU | 8 GB | 100 GB SSD | 10-20 |
| PostgreSQL Primary | 8 vCPU | 32 GB | 1 TB NVMe | 1 |
| PostgreSQL Replica | 8 vCPU | 32 GB | 1 TB NVMe | 2-3 |
| Redis | 4 vCPU | 16 GB | — | 3（Sentinel） |
| Relay Node | 2 vCPU | 4 GB | 50 GB | 5-10 |
| Load Balancer | 2 vCPU | 4 GB | — | 2（HA） |

---

## 总结

当前 3 节点 Besu QBFT + 单进程 clawnetd 架构适用于早期网络（万级以下）。向百万级演进时：

1. **P2P 层天然可扩展**，只需部署 relay 和 bootstrap 节点
2. **API 层通过负载均衡 + CDN + 缓存**可以达到十万级 QPS
3. **链层保持验证者小规模**，通过全节点集群扩展 RPC 承载力
4. **索引层（SQLite → PostgreSQL）是最先需要改的瓶颈**
5. **百万级最终形态：微服务拆分 + 专用索引 + 事件驱动缓存**

最经济的路径是按阶段推进：先 PostgreSQL 替换 SQLite，再加 Redis 缓存，再横向扩展 API 节点——每一步都是渐进式改动，不需要一次性重构。
