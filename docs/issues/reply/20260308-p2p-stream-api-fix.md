# P2PNode libp2p v3 Stream API 兼容性修复回复

> **回复方**: ClawNet 团队  
> **接收方**: TelAgent 项目组  
> **日期**: 2026-03-08  
> **关联文档**: `docs/issues/clawnet-p2p-node-stream-api-fix.md`  
> **修复文件**: `packages/core/src/p2p/node.ts`

---

## 状态：全部已修复 ✅

文档中报告的三个 Bug 均已修复，core 包构建通过，全部 54 个单元测试通过。

---

## Bug 1：`handleProtocol()` — handler 参数格式不匹配

### 修复状态：✅ 已修复

**根因确认**：与文档分析一致。libp2p v3 的 `connection.js` 调用 handler 时传入两个独立参数 `(stream, connection)`，而 `MessagingService` 期望接收 `{ stream, connection }` 对象。

**修复方式**：在 `handleProtocol()` 中包装原始 handler，将两个独立参数转换为对象格式，同时对 `rawStream` 做接口适配（见 Bug 3）：

```ts
await this.node.handle(
  protocol,
  ((rawStream: any, connection: any) => {
    handler({ stream: adaptStream(rawStream), connection });
  }) as any,
  options,
);
```

> `ab23dc5` 提交已部分修复了参数包装，但缺少 stream 适配。本次修复补全了 `adaptStream()` 调用。

---

## Bug 2：`newStream()` — peerId 类型不匹配

### 修复状态：✅ 已修复

**根因确认**：与文档分析一致。`dialProtocol()` 在 libp2p v3 中不接受原始 string 类型的 peerId。

**修复方式**：将 peerId 字符串通过 `multiaddr('/p2p/' + peerId)` 转换为 `Multiaddr` 对象，并对返回的 rawStream 做接口适配：

```ts
const rawStream = await this.node.dialProtocol(
  multiaddr('/p2p/' + peerId),
  protocol,
);
return adaptStream(rawStream);
```

> `ab23dc5` 提交已修复了 multiaddr 转换，但返回的 stream 未经适配。本次修复补全了 `adaptStream()` 调用。

---

## Bug 3：Stream 对象接口不兼容（核心问题）

### 修复状态：✅ 已修复

**根因确认**：与文档分析一致。libp2p v3 的 `AbstractMessageStream` 不暴露 `.source` / `.sink` 属性，而是：
- **读**：stream 自身实现 `[Symbol.asyncIterator]`
- **写**：使用 `stream.send(data)` 方法

**修复方式**：新增 `adaptStream()` 适配函数，将 libp2p v3 原始 stream 转换为 `StreamDuplex` 接口：

| StreamDuplex 属性 | 适配来源 |
|---|---|
| `.source` | `raw` 本身（已实现 `[Symbol.asyncIterator]`） |
| `.sink(iterable)` | 遍历 iterable，逐 chunk 调用 `raw.send()`，完成后调用 `raw.closeWrite()` |
| `.close()` | 直接代理 `raw.close()` |

兼容性设计：如果 stream 已有 `.source` 和 `.sink`（旧版 libp2p 或未来版本），直接透传，不做额外包装。

---

## 验证结果

| 检查项 | 结果 |
|---|---|
| `pnpm --filter @claw-network/core build` | ✅ 编译通过 |
| `pnpm --filter @claw-network/core test` | ✅ 54/54 测试通过 |
| ESLint | ✅ 无新增 warning/error |

> **注意**：端到端验证（DID 映射表填充、消息投递）需部署到至少 2 个节点后，按原文档「验证步骤」章节执行。

---

## TelAgent 侧建议操作

1. **拉取最新代码**后重新构建：`pnpm build`
2. **部署到至少 2 个节点**（如 bootstrap-1 + alex），重启 `clawnetd`
3. **等待 30s** 后检查 DID 映射表：
   ```bash
   curl -s http://localhost:9529/api/messaging/peers | jq .
   ```
4. **检查日志**确认无 `FAILED` / `error`：
   ```bash
   journalctl -u clawnetd --since "2 minutes ago" | grep -E "FAILED|failed|error"
   ```
5. 如仍有问题，请附上完整的 `journalctl -u clawnetd --since "5 minutes ago"` 日志，我们协助排查
