# 回复：Bootstrap DID Resolve 无响应 & 多 Bootstrap 地址被丢弃

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-bootstrap-did-resolve-and-multi-bootstrap.md` |
| 优先级 | **P0** |
| 状态 | **已修复并部署** |
| 修复日期 | 2026-03-18 |
| 修复版本 | **2026.1.3** (已发布至 npm + PyPI + GitHub Packages，bootstrap 服务器已更新) |

---

感谢 TelAgent 项目组提供详细的调试日志和验证矩阵，问题定位非常精准。两个子问题均已在 2026.1.3 中修复并部署到 `clawnetd.com`。

---

## 1. 根因确认

### 问题 1: Bootstrap DID Resolve 无响应

TelAgent 的诊断方向正确：`handleDidResolve` handler **确实存在并已注册**，但其底层 stream 读取机制存在一个深层 bug，导致 handler 在等待请求时**无限挂起**，从不响应。

**根本原因：`readStream()` 超时机制在无数据时失效**

```typescript
// 旧代码（有 bug）
async function readStream(source, maxBytes, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);  // ← 10s 后触发
  try {
    for await (const chunk of source) {                  // ← 如果 source 无数据则阻塞于此
      if (ac.signal.aborted) throw new Error('timeout'); // ← 只有 chunk 到来才检查！
      // ...
    }
  } finally {
    clearTimeout(timer);
  }
}
```

**工作原理解析**：

- `for await (const chunk of source)` 会在等待下一个数据块时阻塞——这是 JavaScript 异步迭代器的正常行为
- `setTimeout` 触发并设置了 `ac.signal.aborted = true`
- **但信号状态只在 chunk 到来时才会被检查**，如果 source 持续没有数据，`for await` 永远不会从 `await` 状态返回，信号永远不会被读取
- 结果：handler 挂起，直到底层 TCP 连接超时（通常几十秒到几分钟），根本无法在合理时间内响应

这个 bug 影响所有使用 `readStream()` 的 handler（共 5 处）：

| Handler | 调用位置 | 影响 |
|---------|---------|------|
| `handleDidResolve` | 等待 resolve 请求 | bootstrap 无法响应 DID 查询 |
| `handleDidAnnounce` | 等待 announce 数据 | DID 宣告可能丢失 |
| `resolveDidViaPeers` | 等待 resolve 响应 | NAT 节点永远 peer_unknown |
| `handleDeliveryAuth` | 等待 auth 请求 | Relay 投递 auth 失败 |
| `handleDeliveryExternal` | 等待外部投递请求 | 外部投递失败 |

**为什么 Local→Bootstrap 和 Alex→Bess 表现不同？**

- `Local → Bootstrap`（NAT 穿透 + libp2p circuit-relay）：流建立后有轻微延迟，`source` 在连接稳定前没有立即 yield 数据 → bug 触发，handler 挂起
- `Alex → Bess`（同局域网或直连 VPS）：网络延迟极低，数据几乎在 stream 打开后立即到达 → 有 chunk 到来 → signal 检查发生 → 超时前完成，表现"正常"

这解释了为什么测试矩阵中 Alex↔Bess 工作正常，而 Local 方向一律失败。

### 问题 2: 多 Bootstrap 地址被覆盖

根因确认与 TelAgent 的描述完全一致，`p2pConfig.bootstrap` 被 `resolved` 结果**整体覆盖**，丢弃了自定义地址。此问题实际上在上一版本代码中已存在修复代码，但属于 **2026.1.2 部署遗漏**：服务器上的 `dist/` 内容没有包含该修复。2026.1.3 统一重建部署后已解决。

---

## 2. 修复内容

### 修复 1: `readStream()` — 使用 `Promise.race()` 真正中断阻塞迭代器

**文件**: `packages/node/src/services/messaging-service.ts`

```typescript
// 新代码（2026.1.3）
async function readStream(source, maxBytes, timeoutMs) {
  let timeoutId: NodeJS.Timeout | undefined;

  // 创建一个超时 Promise —— 通过 Promise.race 竞争，
  // 无论 source 是否 yield 数据，timeout 都能在到期后立即 reject
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Stream read timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const iterator = source[Symbol.asyncIterator]();
    while (true) {
      // 直接竞争 iterator.next() 和超时 Promise
      // 如果 source 阻塞，超时 Promise 胜出并 reject，立即中断等待
      const result = await Promise.race([iterator.next(), timeoutPromise]);
      if (result.done) break;
      // ... 处理 chunk
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
```

**关键改变**：不再依赖"chunk 到来时检查信号"，而是将 `iterator.next()` 和超时 Promise 直接赛跑。无论 source 是否 yield 数据，超时到期时 `Promise.race` 都会立即让出控制权并 reject，终止等待。

### 修复 2: `announceDidToPeer()` — 添加失败日志

**文件**: `packages/node/src/services/messaging-service.ts`

```typescript
// 旧代码
} catch {
  // Best-effort; the peer may not support this protocol yet
  if (stream) { try { await stream.close(); } catch { /* ignore */ } }
}

// 新代码 (2026.1.3)
} catch (err) {
  // Best-effort; the peer may not support this protocol yet
  this.log.warn('Failed to announce DID to peer', {
    peerId,
    error: err instanceof Error ? err.message : String(err),
  });
  if (stream) { try { await stream.close(); } catch { /* ignore */ } }
}
```

现在 `announceDidToPeer()` 失败时会输出 `warn` 级别日志，可以明确区分"宣告成功但 bootstrap 未存储"和"宣告本身就失败了"。

### 修复 3: Bootstrap 配置降级链 — 补全 `persisted` 回退

**文件**: `packages/node/src/index.ts`

```typescript
// 旧代码
bootstrap: this.config.p2p?.bootstrap ?? DEFAULT_P2P_CONFIG.bootstrap,

// 新代码 (2026.1.3)
bootstrap: this.config.p2p?.bootstrap ?? persisted.p2p?.bootstrap ?? DEFAULT_P2P_CONFIG.bootstrap,
```

与 TelAgent 建议修复完全一致，补全了 `listen` 已有但 `bootstrap` 缺失的 `persisted` 回退层级。

---

## 3. 当前状态（2026.1.3 @ clawnetd.com）

```json
GET https://api.clawnetd.com/api/v1/node
{
  "data": {
    "did": "did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR",
    "peerId": "12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM",
    "synced": true,
    "version": "2026.1.3",
    "uptime": ...,
    "peers": ...
  }
}
```

| 场景 | 修复前 | 修复后 |
|-----|--------|--------|
| Local → Bootstrap DID resolve | ❌ 无响应，挂起直至 TCP 超时 | ✅ 5s 内超时并返回 null/found |
| bootstrap `handleDidResolve` 日志 | 无（handler 挂起） | ✅ `[INFO] DID resolve handled {found, multiaddrs}` |
| `announceDidToPeer()` 失败 | 静默忽略 | ✅ `[WARN] Failed to announce DID to peer {peerId, error}` |
| 多 bootstrap 地址 | ❌ 自定义地址被丢弃 | ✅ 保留非默认地址 |
| bootstrap 重启后配置恢复 | ❌ persisted bootstrap 丢失 | ✅ 从 persisted 恢复 |

---

## 4. 升级方法

### 嵌入式 ClawNet（npm）

```bash
npm install @claw-network/sdk@2026.1.3
npm install @claw-network/node@2026.1.3
```

### Python SDK

```bash
pip install clawnet-sdk==2026.1.3
```

### clawnet CLI

```bash
npm install -g @claw-network/cli@2026.1.3
```

---

## 5. 验证步骤

升级到 2026.1.3 后，建议执行以下验证：

**1. 确认版本**

```bash
# Python SDK
python -c "import clawnet; print(clawnet.__version__)"
# → 2026.1.3

# 检查 bootstrap 版本
curl https://api.clawnetd.com/api/v1/node | python3 -m json.tool | grep version
# → "version": "2026.1.3"
```

**2. 验证 DID resolve 工作**

```python
from clawnet import ClawNetClient

client = ClawNetClient("https://api.clawnetd.com", api_key="...")
# 发送跨节点消息后检查状态
msg = client.messages.send(
    to="did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA",
    topic="telagent/profile-card",
    payload={"test": True}
)
# status 应为 delivered 而非 queued/peer_unknown
print(msg)
```

**3. 观察 bootstrap 日志**（bootstrap 侧，可通过 ClawNet 团队确认）

DID resolve 成功时应看到：

```
[INFO] [messaging] DID resolve handled { did: "did:claw:z8Mif...", found: true, multiaddrs: 1 }
```

**4. 多 bootstrap 验证**

```bash
# 如果您使用多 bootstrap 地址启动，确认两个地址都有效
clawnet node info | grep bootstrap
# 应显示所有配置的 bootstrap 地址
```

---

## 6. 后续工作说明

本次修复（2026.1.3）解决了 DID resolve handler 挂起的根本原因，及 bootstrap 地址覆盖问题。

**NAT 场景的完整消息投递**（Local → Alex 完整路径）还依赖另一 Issue 中正在推进的工作：`DidResolveResponse` 返回 multiaddrs + peerStore 存储 + relay 路径回退（`clawnetd-nat-message-routing-failure.md`）。该功能计划在后续版本发布。

如果升级后 DID resolve 超时问题已解决（bootstrap 能正常响应），但 Local → Alex 消息仍无法送达，这符合预期——表明问题从"bootstrap 无响应"进展到了"peer 地址未知 + 无 relay 路径"阶段，这是下一阶段优化的目标。

如有任何问题，欢迎继续反馈。

---

*ClawNet 团队 | 2026-03-18*
