# ClawNet Bootstrap NAT-to-NAT Delivery Still Failing After 2026.3.2 — Circuit Relay Data Transfer Inefficiency

日期: 2026-03-23
报告方: TelAgent 项目组
优先级: **P0**
状态: **待修复**

---

## 摘要

所有节点（Bootstrap、Alex、Bess、本地）已升级到 2026.3.2，Bootstrap 也已重启。但 NAT-to-NAT 消息传递仍然失败，原因是 **circuit relay 数据传输效率不足**，导致 `handleDidQuery` 即使使用 30s 超时仍无法完成。

---

## 环境与版本

| 节点 | DID | ClawNet 版本 | 状态 |
|------|-----|--------------|------|
| Bootstrap (clawnetd.com) | did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR | **2026.3.2** | ✅ 已重启 |
| Alex (clawnet-alice) | did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA | **2026.3.2** | ✅ |
| Bess (clawnet-bob) | did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs | **2026.3.2** | ✅ |
| 本地 (NAT) | did:claw:zCZ3PRXxkHBPtjbzeFB3ZS9f332Fu3KPq7Pvxvx3gy2Z9 | **2026.3.2** | ✅ |

---

## 问题 1：`handleDidQuery` 30s 超时仍然不足

### 现象

本地节点（NAT）日志持续出现：

```
[WARN] failed to handle DID query { error: 'Stream read timed out after 30000ms' }
```

### 根因分析

当 Bootstrap（relay）尝试读取 NAT 节点发送的 DID query 请求时，数据通过 circuit relay 传输极其缓慢。2026.3.2 已将超时从 10s 增加到 30s，但 **30s 仍然不够**。

```
Bootstrap                    NAT 节点（Alex）
    |                              |
    |<---- circuit relay ----<------|  DID query 请求
    |                              |
    |   30s 内无法读完数据          |
    |   (relay 带宽极低)            |
    X 超时                         |
```

### 日志证据

Bootstrap journalctl（已重启，进程 3793920）：
```
Mar 23 16:14:31 vmi3102155 node[3793920]: [WARN] failed to handle DID resolve { error: 'Stream read timed out after 15000ms' }
Mar 23 16:15:01 vmi3102155 node[3793920]: [WARN] failed to handle DID resolve { error: 'Stream read timed out after 15000ms' }
Mar 23 16:15:31 vmi3102155 node[3793920]: [WARN] failed to handle DID resolve { error: 'Stream read timed out after 15000ms' }
```

本地节点（2026.3.2）：
```
[2026-03-23T15:14:32.940Z] [WARN] failed to handle DID query { error: 'Stream read timed out after 30000ms' }
```

### 修复建议

**方案 A（推荐）**：进一步增加超时
```typescript
const DID_QUERY_TIMEOUT_MS = 60_000;  // 改为 60s
```

**方案 B**：优化 circuit relay 数据传输效率
- 增加 circuit relay 的 buffer size
- 启用压缩传输
- 减少 relay 跳数

---

## 问题 2：`handleDidResolve` 15s 超时

### 现象

Bootstrap 持续出现：
```
[WARN] failed to handle DID resolve { error: 'Stream read timed out after 15000ms' }
```

### 说明

`handleDidResolve` 超时已从 10s 增加到 15s（2026.3.2 的 `add missing timeouts to handleDidResolve and handleInboundMessage`）。但 15s 仍然不足，建议同样增加到 60s。

---

## 问题 3：`peer has NaN total` — Peer Directory 返回无效 TotalCount

### 现象

Bootstrap peer directory 响应中 `total` 字段为 `NaN`：

```
[messaging] peer directory: no new entries (peer has NaN total, all already known)
```

### 日志证据

Bootstrap journalctl：
```
[2026-03-23T15:14:30.870Z] [INFO] [messaging] peer directory: no new entries (peer has NaN total, all already known)
[2026-03-23T15:14:30.871Z] [INFO] [messaging] peer directory: no new entries (peer has NaN total, all already known)
```

### 影响

`NaN total` 导致客户端无法正确判断 peer directory 是否还有更多条目，可能导致 peer 发现不完整。

---

## 问题 4：NAT-to-NAT Direct Delivery 失败

### 现象

本地节点尝试直接投递到 Alex 时超时：

```
[WARN] direct delivery failed {
  peerId: '12D3KooWHB5qEnnoTAT8n7ZtLAQgpDDioLgDQcviF6okoyZo8H76',
  targetDid: 'did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA',
  category: 'timeout',
  error: 'The operation was aborted due to timeout'
}
```

### 根因链条

1. Bootstrap 的 `handleDidQuery` 超时 → Bootstrap 无法正确获取 NAT 节点的 DID
2. Bootstrap 的 `handleDidResolve` 超时 → Bootstrap 无法解析 NAT 节点的 peerId → DID 映射
3. 结果：发送方无法通过 Bootstrap 找到接收方的地址
4. Direct delivery 失败后，relay delivery 应该作为 fallback，但 relay 路径也存在问题

### 期望的 Fallback 流程

```
发送方 → Bootstrap → relay delivery → 接收方
         (resolve 失败)
         (query 失败)
         但 relay 路径应该可用
```

### 实际结果

Relay delivery 没有明显的 INFO 日志说明其是否被尝试。可能是因为：
1. Relay 路径代码路径不同，没有日志
2. 或者 relay 路径也有超时问题

---

## 完整日志

### Bootstrap journalctl（重启后 5 分钟）

```
Mar 23 16:11:45 vmi3102155 node[3793920]: [p2p] peer:connect 12D3KooWN7bYDnFUZNMHhSBimvA3Nd2LSZWxZ1W75AhRrk85gfur
Mar 23 16:11:45 vmi3102155 node[3793920]: [p2p] peer:connect 12D3KooWFy67jH6FGQSaADj7Aw577s7VdsfwaP8vpm4ptJuMABUt
Mar 23 16:11:45 vmi3102155 node[3793920]: [p2p] peer:connect 12D3KooWHB5qEnnoTAT8n7ZtLAQgpDDioLgDQcviF6okoyZo8H76
Mar 23 16:11:45 vmi3102155 node[3793920]: [p2p] peer:connect 12D3KooWDB9SgR1hDMnn5j4gY77aSjcZEgD9f1ATvb1stRouiXEo
Mar 23 16:11:45 vmi3102155 node[3793920]: [p2p] peer:discovery 12D3KooWHB5qEnnoTAT8n7ZtLAQgpDDioLgDQcviF6okoyZo8H76
Mar 23 16:11:45 vmi3102155 node[3793920]: [p2p] peer:discovery 12D3KooWDB9SgR1hDMnn5j4gY77aSjcZEgD9f1ATvb1stRouiXEo
Mar 23 16:12:01 vmi3102155 node[3793920]: [2026-03-23T15:12:01.376Z] [WARN] failed to handle DID resolve { error: 'Stream read timed out after 15000ms' }
Mar 23 16:14:31 vmi3102155 node[3793920]: [2026-03-23T15:14:31.379Z] [WARN] failed to handle DID resolve { error: 'Stream read timed out after 15000ms' }
Mar 23 16:15:01 vmi3102155 node[3793920]: [2026-03-23T15:15:01.376Z] [WARN] failed to handle DID resolve { error: 'Stream read timed out after 15000ms' }
Mar 23 16:15:31 vmi3102155 node[3793920]: [2026-03-23T15:15:31.379Z] [WARN] failed to handle DID resolve { error: 'Stream read timed out after 15000ms' }
```

### 本地节点日志（2026.3.2）

```
[2026-03-23T15:14:13.451Z] [INFO] [messaging] fetchPeerDirectory attempt 1/3 to 12D3KooWQnQQNGBG
[2026-03-23T15:14:28.381Z] [INFO] [messaging] fetchPeerDirectory attempt 1/3 to 12D3KooWQnQQNGBG
[2026-03-23T15:14:28.667Z] [WARN] [messaging] fetchPeerDirectory attempt 1/3 failed: Stream read timed out after 15000ms
[2026-03-23T15:14:30.668Z] [INFO] [messaging] fetchPeerDirectory attempt 2/3 to 12D3KooWQnQQNGBG
[2026-03-23T15:14:30.870Z] [INFO] [messaging] fetchPeerDirectory received 9 entries from 12D3KooWQnQQNGBG
[2026-03-23T15:14:30.871Z] [INFO] [messaging] peer directory: no new entries (peer has NaN total, all already known)
[2026-03-23T15:14:32.940Z] [WARN] failed to handle DID query { error: 'Stream read timed out after 30000ms' }
```

### Bootstrap API 状态

```json
{
  "data": {
    "did": "did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR",
    "peerId": "12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM",
    "synced": true,
    "blockHeight": 366934,
    "peers": 5,
    "connections": 5,
    "network": "testnet",
    "version": "2026.3.2",
    "uptime": 234
  }
}
```

---

## 修复优先级

| 优先级 | 问题 | 建议 |
|--------|------|------|
| **P0** | `handleDidQuery` 超时不足 | 增加超时到 60s |
| **P0** | `handleDidResolve` 超时不足 | 增加超时到 60s |
| **P1** | `peer has NaN total` | 修复 peer directory totalCount 计算 |
| **P1** | NAT-to-NAT direct delivery 失败 | 调查 relay delivery fallback 是否工作 |

---

## 验证方法

修复后，以下日志模式应该消失或显著减少：

```bash
# Bootstrap 端
journalctl -u clawnetd.service | grep "failed to handle DID resolve"
journalctl -u clawnetd.service | grep "failed to handle DID query"

# 本地节点端
grep "failed to handle DID query" ~/.telagent/logs/*.log
grep "direct delivery failed" ~/.telagent/logs/*.log
grep "peer has NaN total" ~/.telagent/logs/*.log
```

且以下测试应该通过：

```bash
# Alex 发送消息到 Bess
# 期望：消息成功通过 relay 路径送达
```

---

## 参考

- 此前关于 `handleDidQuery` 10s 超时的 issue：[clawnetd-bootstrap-handleDidQuery-timeout.md](./clawnetd-bootstrap-handleDidQuery-timeout.md)
- NAT-to-NAT 传递分析（2026.3）：[clawnetd-nat-to-nat-delivery-analysis-2026-3.md](./clawnetd-nat-to-nat-delivery-analysis-2026-3.md)
- 2026.3.2 commit: `0a09ebc fix(node): add missing timeouts to handleDidResolve and handleInboundMessage`

---

*TelAgent 项目组 | 2026-03-23*
