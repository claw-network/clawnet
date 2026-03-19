# 回复：Bootstrap did-query 协议未生效（2026.1.4 升级后仍失败）

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-did-query-not-working-after-2026-1-4-upgrade.md` |
| 优先级 | **P0** |
| 状态 | **分析中，发现新的根因** |
| 修复版本 | 2026.1.5（计划中）|

---

感谢 TelAgent 项目组提供详细的验证数据。根据 Bootstrap 日志分析，我们发现了两个独立的根因，需要一起修复才能使 DID resolve 完整生效。

---

## 1. 发现的新根因

### 根因 1：`peer:connect` 事件未在 Bootstrap 侧触发

**观察**：Bootstrap 日志中没有任何 `peer:connect` 事件记录，尽管 API 显示有 5 个 peers。

```
# Bootstrap 日志中缺失以下内容：
[p2p] peer:connect 12D3KooW...
```

这导致 `onPeerConnected` 从未被调用，因此 `queryPeerDid` 也没有执行——**即使 2026.1.4 的代码正确，did-query 也没有机会运行**。

**可能原因**：在 Circuit Relay v2 连接场景下，libp2p 的 `peer:connect` 事件行为与直连场景不同。当 Bootstrap 作为 relay 服务器接收穿透连接时，连接事件可能不会以相同方式触发。

### 根因 2：peerId 在 peer store 中无效

**观察**：Bootstrap 日志显示大量 `getPeerAddresses error: Invalid PeerId` 错误。

```
[p2p] getPeerAddresses error: Invalid PeerId
```

这发生在 `handleDidResolve` 中：Bootstrap 在 `didToPeerId` 映射中找到了目标 DID 对应的 peerId，但 `peerStore.get(peerId)` 抛出 "Invalid PeerId"，导致无法获取 peer 的地址。

**分析**：这说明 `didToPeerId` 映射中的 peerId 来自有效的 DID announce（在 `handleDidAnnounce` 中从 `connection.remotePeer` 获取），但 bootstrap 的 libp2p peer store 无法识别这些 peerId——它们可能通过 relay 连接注册，而 peer store 没有正确存储对应的地址记录。

### 根因 3：Circuit Relay 穿透连接的地址缺失

**观察**：即使 `didToPeerId` 有 Alex 的映射，Bootstrap 返回 `multiaddrs: 0`：

```
[INFO] DID resolve handled {
  did: 'did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA',
  found: true,
  multiaddrs: 0   ← Bootstrap 知道 Alex 的 DID，但没有 Alex 的地址
}
```

**分析**：

```
Alex（NAT 后） → 连接 → Relay Server → Bootstrap
                                    ↑
                              Bootstrap 有 Alex 的 peerId（来自 DID announce）
                              但 Bootstrap 没有 Alex 的可拨号地址
```

当 Alex 穿透连接 Bootstrap 时，Bootstrap 收到了 Alex 的 DID announce 并注册了 `did→peerId` 映射，但 Alex 的**可拨号地址**（circuit relay 地址或公网地址）没有被存储到 Bootstrap 的 peer store 中。

**结果**：即使 Bootstrap 知道 Alex 的 peerId，也无法通过 relay 发送消息给 Alex。

---

## 2. 修复方案（2026.1.5）

### 修复 1：主动 dialing 获取 peer 地址

在 `queryPeerDid` 中，如果 did-query 成功获取到 peer 的 DID，还需要**主动 dial 一次该 peer**，以触发 libp2p 存储 peer 的 relay 地址：

```typescript
private async queryPeerDid(peerId: string): Promise<void> {
  let stream: StreamDuplex | null = null;
  try {
    stream = await this.p2p.newStream(peerId, PROTO_DID_QUERY);
    const reqBytes = encodeDidQueryRequestBytes({});
    await writeBinaryStream(stream.sink, reqBytes);
    const raw = await readStream(stream.source, 1024, DID_RESOLVE_TIMEOUT_MS);
    await stream.close();
    const resp = decodeDidQueryResponseBytes(new Uint8Array(raw));
    if (resp.did && DID_PATTERN.test(resp.did)) {
      this.registerDidPeer(resp.did, peerId);
      this.log.info('bootstrap registered peer DID via query', { did: resp.did, peerId });

      // 主动 dial 一次该 peer，触发 libp2p 存储其 relay 地址
      // 这样后续 relay 消息投递可以使用该地址
      try {
        await this.p2p.dial(peerId);
      } catch {
        // 非致命：dial 失败不代表 relay 不可用
      }
    }
  } catch (err) {
    this.log.debug('did query failed for peer', { peerId, error: err instanceof Error ? err.message : String(err) });
    if (stream) { try { await stream.close(); } catch { /* ignore */ } }
  }
}
```

### 修复 2：从连接对象直接提取 peer 地址

在 `onPeerConnected` 中，除了 query DID，还应该从连接对象获取并存储 peer 的地址：

```typescript
async onPeerConnected(peerId: string): Promise<void> {
  await this.announceDidToPeer(peerId);

  if (this.isBootstrap) {
    // 主动 dial 以触发地址存储
    try {
      await this.p2p.dial(peerId);
    } catch {
      // Best-effort
    }
    await this.queryPeerDid(peerId);
  }

  const did = this.peerIdToDid.get(peerId);
  if (did) {
    await this.flushOutboxForDid(did);
  }
}
```

### 修复 3：修复 `peer:connect` 事件处理

如果 `peer:connect` 事件在 relay 场景下不触发，我们需要在连接建立时**主动触发** `onPeerConnected`。可以通过监听 `connectionManager` 事件或在使用 peer 之前主动触发地址解析。

---

## 3. 当前状态

| 项目 | 状态 |
|------|------|
| Bootstrap 版本 | ✅ 2026.1.4 |
| did-query 协议注册 | ✅ 已注册（代码层面）|
| did-query 触发 | ❌ `peer:connect` 未触发，导致 query 未执行 |
| peer 地址存储 | ❌ relay 地址未存储 |
| DID→peerId 映射 | ✅ 有（found: true）|
| peerId→地址映射 | ❌ 无（multiaddrs: 0）|

---

## 4. 下一步

我们正在准备 2026.1.5 修复补丁，修复以下内容：

1. **主动 dial** 触发 peer 地址存储
2. **从连接对象提取** peer 的 relay 地址
3. **备用 peer 地址获取** — 如果 dial 失败，通过其他方式获取 relay 地址

预计完成时间：今日内。

---

*ClawNet 团队 | 2026-03-19*
