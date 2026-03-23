# ClawNet Bootstrap `handleDidQuery` Stream Read Timeout — 与 `handlePeerDirectory` 相同的 10s 超时问题

日期: 2026-03-23
报告方: TelAgent 项目组
优先级: **P0**
状态: **待修复**

---

## 摘要

TelAgent 本地节点（NAT）启动时，Bootstrap 日志持续出现：

```
[WARN] failed to handle DID query { error: 'Stream read timed out after 10000ms' }
```

与此前 `handlePeerDirectory` 的超时问题相同，但 `handleDidQuery` 尚未应用相同的超时修复。导致 NAT 节点无法通过 Bootstrap 解析其他 NAT peers 的 DID。

---

## 环境与版本

| 节点 | DID | 版本 |
|------|-----|------|
| 本地 NAT (TelAgent) | did:claw:zCZ3PRXxkHBPtjbzeFB3ZS9f332Fu3KPq7Pvxvx3gy2Z9 | 2026.1.5 |
| Bootstrap (clawnetd.com) | did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR | **2026.2.10** |

---

## 日志（完整）

```
[info] [telagent] ClawNet: auto-started -> http://127.0.0.1:9528
[p2p] peer:connect 12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM
[p2p] connection:open peer=12D3KooWQnQQNGBG… addr=/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWQnQQNGBG…
[2026-03-23T12:41:35.669Z] [WARN] failed to handle DID query { error: 'Stream read timed out after 10000ms' }
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
[mesh] fetching peer directory from 12D3KooWQnQQNGBG…
[2026-03-23T12:41:36.191Z] [INFO] [messaging] fetchPeerDirectory received 9 entries from 12D3KooWQnQQNGBG  ← peer directory 成功！
[2026-03-23T12:42:01.071Z] [WARN] direct delivery failed { peerId: '12D3KooWHB5qEnnoTAT8n7ZtLAQgpDDioLgDQcviF6okoyZo8H76', targetDid: 'did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA', category: 'timeout' }
```

注意：`fetchPeerDirectory` 成功获取 9 条目（说明 peer directory handler 已应用 30s 超时修复），但 `handleDidQuery` 仍然 10s 超时。

---

## 根因

**文件**: `packages/node/src/services/messaging-service.ts`

### `handlePeerDirectory` — 已修复 ✅

```typescript
// 第 92 行
const PEER_DIRECTORY_TIMEOUT_MS = 30_000;

// handlePeerDirectory 实现（第 2379 行附近）
const raw = await readStream(stream.source, 256, PEER_DIRECTORY_TIMEOUT_MS);  // ✅ 使用 30s 超时
```

### `handleDidQuery` — 未修复 ❌

```typescript
// 第 2326 行附近 — handleDidQuery 实现
private async handleDidQuery(incoming: {
  stream: StreamDuplex;
  connection: { remotePeer?: { toString: () => string } };
}): Promise<void> {
  const { stream, connection } = incoming;
  try {
    const raw = await readStream(stream.source, 1024);  // ❌ 无自定义超时，使用默认 STREAM_READ_TIMEOUT_MS = 10_000
    decodeDidQueryRequestBytes(new Uint8Array(raw));
    const respBytes = encodeDidQueryResponseBytes({ did: this.localDid });
    await writeBinaryStream(stream.sink, respBytes);
    await stream.close();
    this.log.debug('did query handled', { peerId: connection.remotePeer?.toString() });
  } catch (err) {
    this.log.warn('failed to handle DID query', { error: (err as Error).message });  // ← 本次报错
    try { await stream.close(); } catch { /* ignore */ }
  }
}
```

**默认值**（第 141 行）:
```typescript
const STREAM_READ_TIMEOUT_MS = 10_000;
```

### 死锁机制（与 handlePeerDirectory 相同）

1. NAT 节点调用 Bootstrap 的 `did-query` 协议，发送请求数据
2. Bootstrap 的 `handleDidQuery` 使用 10s 超时读取请求
3. NAT 节点的请求数据在 10s 内未读完 → 超时 → `writeBinaryStream` 永远等待
4. 结果：Bootstrap 无法处理 DID 查询 → NAT 节点的 DID 无法被注册到 Bootstrap 的 didPeerMap

---

## 修复方案

与 `handlePeerDirectory` 的修复完全相同：

```typescript
// 新增常量（第 92 行附近）
const DID_QUERY_TIMEOUT_MS = 30_000;

// handleDidQuery 实现中：
const raw = await readStream(stream.source, 1024, DID_QUERY_TIMEOUT_MS);  // 替换原来的无超时版本
```

---

## 影响范围

- 所有 NAT 节点通过 Bootstrap 解析其他 NAT peers 的 DID 时都会触发此超时
- 直接影响：NAT-to-NAT 消息投递（`peer_unknown`）
- 间接影响：Bootstrap 无法维护完整的 didPeerMap

---

## 验证

修复后，本地 NAT 节点启动时不应再出现：
```
[WARN] failed to handle DID query { error: 'Stream read timed out after 10000ms' }
```

且 Bootstrap 的 didPeerMap 应包含所有已连接 NAT 节点的 DID。

---

*TelAgent 项目组 | 2026-03-23*
