# ClawNet P2PNode — libp2p v3 Stream API 兼容性修复

| 字段 | 值 |
| --- | --- |
| 优先级 | **P0 — 阻塞所有自定义协议通信** |
| 影响范围 | `packages/core/src/p2p/node.ts` — `handleProtocol()` / `newStream()` |
| libp2p 版本 | `3.1.3` (`@libp2p/utils@7.0.10`, `@chainsafe/libp2p-yamux@8.0.1`) |
| 发现日期 | 2025-07-14 |
| 相关提交 | `ab23dc5`（部分修复，已 push 到 main，但问题仍未解决） |

---

## 1. 问题描述

所有通过 `P2PNode.handleProtocol()` / `P2PNode.newStream()` 建立的自定义协议流（`/clawnet/1.0.0/did-announce`、`/clawnet/1.0.0/dm`、`/clawnet/1.0.0/did-resolve` 等）全部失败。节点间连接正常，但 DID-PeerId 映射表始终为空，消息无法投递。

## 2. 根因分析

`P2PNode` 对外暴露的 `StreamDuplex` 接口定义如下（node.ts L77-81）：

```ts
export interface StreamDuplex {
  source: AsyncIterable<{ subarray: () => Uint8Array } | Uint8Array>;
  sink: (source: AsyncIterable<Uint8Array>) => Promise<void>;
  close: () => void | Promise<void>;
}
```

`MessagingService` 使用方式：
```ts
// 读（handleDidAnnounce 等）
const raw = await readStream(stream.source, 1024);
// readStream 实现: for await (const chunk of source) { ... }

// 写（announceDidToPeer 等）
await writeBinaryStream(stream.sink, bytes);
// writeBinaryStream 实现: await sink((async function* () { yield data; })());
```

**但 libp2p v3 的 stream 对象（`AbstractMessageStream`）既没有 `.source`，也没有 `.sink`：**

| 属性 | `StreamDuplex` 期望 | libp2p v3 `AbstractMessageStream` 实际 |
| --- | --- | --- |
| `source` | `AsyncIterable<Uint8Array>` | ❌ 不存在。**stream 对象自身** 实现 `[Symbol.asyncIterator]`（通过 message 事件 + it-pushable） |
| `sink` | `(asyncIterable) => Promise<void>` | ❌ 不存在。写入使用 **`stream.send(data: Uint8Array)`** 方法 |
| `close` | `() => void \| Promise<void>` | ✅ 存在 |

---

### Bug 1: `handleProtocol()` — handler 参数格式不匹配

**文件**: `packages/core/src/p2p/node.ts` L480-493

**现象**: Inbound handler 报错 `Cannot read properties of undefined (reading 'remotePeer')`

**原因**: libp2p v3 的 `connection.js` L175 调用 handler 方式为：
```js
await handler(stream, connection);  // 两个独立参数
```

但 `MessagingService` 注册的 handler 期望接收 `{ stream, connection }` 对象：
```ts
async handleDidAnnounce(incoming) {
  const { stream, connection } = incoming;  // connection 为 undefined
}
```

**当前 `ab23dc5` 补丁**（已部分修复此问题）：
```ts
await this.node.handle(
  protocol,
  ((stream: any, connection: any) => handler({ stream, connection })) as any,
  options,
);
```

↑ handler 参数适配正确，但 stream 对象不兼容（见 Bug 3）。

---

### Bug 2: `newStream()` — peerId 类型不匹配

**文件**: `packages/core/src/p2p/node.ts` L512-519

**现象**: `multiaddrs[0].getComponents is not a function`

**原因**: `dialProtocol()` 在 libp2p v3 中不再接受原始 string 类型的 peerId，需传入 `Multiaddr` 或 `PeerId` 对象。

**当前 `ab23dc5` 补丁**（已修复此部分）：
```ts
return this.node.dialProtocol(multiaddr('/p2p/' + peerId), protocol);
```

↑ peerId 类型转换正确，但返回的 stream 对象不兼容（见 Bug 3）。

---

### Bug 3: Stream 对象接口不兼容（核心问题）

`ab23dc5` 修复了 Bug 1 和 Bug 2 后，报错变为：

**Inbound（handleProtocol handler 内）**:
```
failed to handle DID announce {
  error: "Cannot read properties of undefined (reading 'Symbol(Symbol.asyncIterator)')"
}
```
→ `readStream(stream.source, 1024)` 中 `stream.source` 是 `undefined`，无法迭代。

**Outbound（newStream 调用方）**:
```
announceDidToPeer FAILED { error: 'sink is not a function' }
```
→ `writeBinaryStream(stream.sink, bytes)` 中 `stream.sink` 是 `undefined`。

**根因**: libp2p v3 的 stream 对象（`AbstractMessageStream` → `AbstractStream`）：
- **读**: 自身实现 `[Symbol.asyncIterator]`，通过 `message` 事件 + `it-pushable` 输出数据块
- **写**: 使用 `stream.send(data: Uint8Array)` 方法

而 ClawNet `StreamDuplex` 接口期望的是早期 libp2p 的 it-pipe 风格：
- **读**: `stream.source` 为 `AsyncIterable`
- **写**: `stream.sink` 为接受 `AsyncIterable` 的函数

---

## 3. 修复方案

在 `handleProtocol()` 和 `newStream()` 中，将 libp2p v3 的原始 stream 对象适配为 `StreamDuplex` 接口。

### 3.1 添加适配函数

在 `packages/core/src/p2p/node.ts` 中添加：

```ts
/**
 * Adapt a libp2p v3 stream (AbstractMessageStream) to the StreamDuplex
 * interface expected by MessagingService.
 *
 * libp2p v3 streams:
 *   - read:  stream itself is AsyncIterable (implements [Symbol.asyncIterator])
 *   - write: stream.send(data: Uint8Array)
 *
 * StreamDuplex expects:
 *   - read:  stream.source is AsyncIterable
 *   - write: stream.sink is (asyncIterable) => Promise<void>
 */
function adaptStream(raw: any): StreamDuplex {
  // If it already has .source and .sink, assume it's compatible (forward compat)
  if (raw.source && typeof raw.sink === 'function') {
    return raw as StreamDuplex;
  }

  return {
    source: raw[Symbol.asyncIterator]
      ? raw                           // stream itself is the async iterable
      : (async function* () {})(),    // fallback: empty iterable

    sink: async (iterable: AsyncIterable<Uint8Array>) => {
      for await (const chunk of iterable) {
        raw.send(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
      }
      // Half-close write side after sending all data
      if (typeof raw.closeWrite === 'function') {
        await raw.closeWrite();
      }
    },

    close: () => raw.close(),
  };
}
```

### 3.2 修改 `handleProtocol()`

```ts
async handleProtocol(
  protocol: string,
  handler: StreamHandler,
  options?: { maxInboundStreams?: number; maxOutboundStreams?: number },
): Promise<void> {
  if (!this.node?.handle) {
    throw new Error('node not started or does not support handle()');
  }
  await this.node.handle(
    protocol,
    ((rawStream: any, connection: any) => {
      handler({ stream: adaptStream(rawStream), connection });
    }) as any,
    options,
  );
}
```

### 3.3 修改 `newStream()`

```ts
async newStream(peerId: string, protocol: string): Promise<StreamDuplex> {
  if (!this.node?.dialProtocol) {
    throw new Error('node not started or does not support dialProtocol()');
  }
  const rawStream = await this.node.dialProtocol(
    multiaddr('/p2p/' + peerId),
    protocol,
  );
  return adaptStream(rawStream);
}
```

---

## 4. 验证步骤

修改完成后：

1. **构建**: `pnpm build`
2. **部署到至少 2 个节点** (例如 bootstrap-1 + alex)
3. **重启**: `systemctl restart clawnetd`
4. **等待 30s** 让节点重新连接
5. **检查 DID 映射**:
   ```bash
   curl -s http://localhost:9529/api/messaging/peers | jq .
   ```
   预期: `didPeerMap` 中有各个已连接节点的 DID → PeerId 映射。例如:
   ```json
   {
     "data": {
       "didPeerMap": {
         "did:claw:0x1234...": "12D3KooW...",
         "did:claw:0x5678...": "12D3KooW..."
       }
     }
   }
   ```
6. **检查日志无报错**:
   ```bash
   journalctl -u clawnetd --since "2 minutes ago" | grep -E "FAILED|failed|error"
   ```

---

## 5. 参考

### libp2p v3 stream 类（`@libp2p/utils@7.0.10`）
- `AbstractMessageStream` (`abstract-message-stream.js`):
  - `[Symbol.asyncIterator]()`: 通过 `pushable()` + `message` 事件实现
  - `send(data: Uint8Array)`: 写入数据到 writeBuffer
  - `close()`: 关闭流
  - `closeWrite()`: 仅关闭写方向

### libp2p v3 connection.js 中 handler 调用
```js
// connection.js L175
await handler(stream, connection);  // 两个独立参数，非对象
```

### libp2p v3 dialProtocol → connection.newStream
```js
// libp2p.js L247
return this.components.connectionManager.openStream(peer, protocols, options);
// connection-manager/index.js L343
return connection.newStream(protocol, options);
// connection.js L70: 返回 yamux muxedStream（AbstractStream 实例）
```
