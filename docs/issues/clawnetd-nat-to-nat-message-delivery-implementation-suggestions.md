# ClawNet NAT → NAT 消息投递实现建议

日期: 2026-03-22
报告方: TelAgent 项目组
优先级: P1

---

## 问题描述

Bootstrap Push 模型成功解决了 peer directory 同步问题，NAT 节点可以接收 Bootstrap 推送的 peer directory。

但 NAT → NAT 消息投递仍然失败：

```
direct delivery failed {
  peerId: '12D3KooWGHAyjsmxTn4Ei4ahrWLS4uhCZZMozJvY9t2R6a9WEgys',
  targetDid: 'did:claw:z7ToozkCFGsnkJB5HDub6J7cN5EKAxcr4CHfPiazcLkFw',
  category: 'timeout',
  error: 'The operation was aborted due to timeout'
}
```

---

## 现状分析

### 当前架构

```
NAT 节点 A → WebSocket → ClawNet Gateway → 存储/转发 → NAT 节点 B
                                    ↑
                              消息队列（可能丢失）
```

### 问题根因

1. **NAT 穿透限制**：NAT 节点无法接受入站连接，只能发起出站连接
2. **Relay 消息传递**：消息通过 Bootstrap relay 转发，但 relay 不保证消息到达
3. **消息确认缺失**：发送方不知道消息是否被目标接收
4. **连接保活问题**：NAT 连接可能超时断开

---

## 实现建议

### 建议 1：Bootstrap 作为消息中继（推荐）

**核心思路**：利用 Bootstrap 已有的与所有 NAT 节点的连接，实现可靠的消息中继。

```typescript
// Bootstrap 维护所有 NAT 节点的连接
class MessageRelayService {
  private connections: Map<string, WebSocket> = new Map();

  // 当 NAT 节点连接时，添加到连接池
  onNatNodeConnected(nodeDid: string, ws: WebSocket): void {
    this.connections.set(nodeDid, ws);
  }

  // 可靠的消息投递
  async relayMessage(fromDid: string, toDid: string, message: Envelope): Promise<boolean> {
    const targetWs = this.connections.get(toDid);
    if (!targetWs) {
      // 目标不在线，存入离线队列
      await this.storeOffline(toDid, message);
      return false;
    }

    try {
      // 发送消息并等待 ACK
      const ack = await this.sendWithAck(targetWs, message);
      return ack;
    } catch (e) {
      // 发送失败，存入离线队列
      await this.storeOffline(toDid, message);
      return false;
    }
  }
}
```

### 建议 2：消息确认机制

**核心思路**：消息发送后必须收到目标节点的确认（ACK），才算投递成功。

```typescript
interface EnvelopeACK {
  envelopeId: string;
  receivedAt: number;
  nodeDid: string;
}

// 发送方
async function sendWithAck(targetWs: WebSocket, envelope: Envelope): Promise<EnvelopeACK> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('ACK timeout')), 30_000);

    // 监听 ACK
    ws.once('envelope-ack', (ack: EnvelopeACK) => {
      if (ack.envelopeId === envelope.envelopeId) {
        clearTimeout(timeout);
        resolve(ack);
      }
    });

    // 发送消息
    ws.send(JSON.stringify({ type: 'envelope', payload: envelope }));
  });
}

// 接收方
function onEnvelopeReceived(envelope: Envelope): void {
  // 处理消息
  processMessage(envelope);

  // 发送 ACK
  ws.send(JSON.stringify({
    type: 'envelope-ack',
    envelopeId: envelope.envelopeId,
    receivedAt: Date.now(),
    nodeDid: myDid
  }));
}
```

### 建议 3：离线队列与消息持久化

**核心思路**：当目标 NAT 节点不在线时，消息存入持久化队列，等目标上线时投递。

```typescript
class OfflineMessageStore {
  constructor(private db: Database) {}

  async storeOffline(toDid: string, envelope: Envelope): Promise<void> {
    await this.db.run(
      'INSERT INTO offline_messages (to_did, envelope, created_at) VALUES (?, ?, ?)',
      [toDid, JSON.stringify(envelope), Date.now()]
    );
  }

  async deliverOffline(toDid: string, ws: WebSocket): Promise<number> {
    const messages = await this.db.all(
      'SELECT * FROM offline_messages WHERE to_did = ? ORDER BY created_at',
      [toDid]
    );

    let delivered = 0;
    for (const row of messages) {
      try {
        const ack = await this.sendWithAck(ws, JSON.parse(row.envelope));
        if (ack) {
          await this.db.run('DELETE FROM offline_messages WHERE id = ?', [row.id]);
          delivered++;
        }
      } catch (e) {
        // 发送失败，停止投递
        break;
      }
    }
    return delivered;
  }
}
```

### 建议 4：连接保活机制

**核心思路**：定期发送心跳，保持 NAT 连接活跃，防止超时断开。

```typescript
class KeepAliveService {
  private interval: NodeJS.Timeout;

  start(ws: WebSocket): void {
    this.interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, 30_000); // 每 30 秒
  }

  stop(): void {
    clearInterval(this.interval);
  }
}

// 接收方响应
ws.on('ping', () => {
  ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
});
```

### 建议 5：消息优先级队列

**核心思路**：区分实时消息和离线消息，优先处理实时消息。

```typescript
interface MessageQueue {
  realtime: Envelope[];    // 实时消息（最高优先级）
  normal: Envelope[];      // 普通消息
  offline: Envelope[];     // 离线消息（最低优先级）
}

async function processQueue(ws: WebSocket, queue: MessageQueue): Promise<void> {
  // 先处理实时消息
  while (queue.realtime.length > 0) {
    const msg = queue.realtime.shift();
    await sendWithAck(ws, msg);
  }

  // 处理普通消息
  while (queue.normal.length > 0) {
    const msg = queue.normal.shift();
    await sendWithAck(ws, msg);
  }

  // 最后处理离线消息
  while (queue.offline.length > 0) {
    const msg = queue.offline.shift();
    await sendWithAck(ws, msg);
  }
}
```

---

## 推荐实施顺序

1. **Phase 1**：实现消息确认机制（ACK）
2. **Phase 2**：实现离线队列持久化
3. **Phase 3**：实现 Bootstrap 消息中继
4. **Phase 4**：添加连接保活机制
5. **Phase 5**：优化消息优先级队列

---

## 预期效果

| 指标 | 当前 | 预期 |
|------|------|------|
| NAT→NAT 消息投递率 | 0% | >95% |
| 消息延迟 | 超时 | <5s（在线） |
| 离线消息 | 丢失 | 持久化 |
| 连接稳定性 | 不稳定 | 保活心跳 |

---

## 参考实现

当前 TelAgent 的 ClawNet transport 使用的是 WebSocket 订阅模式：

```typescript
// 当前实现（/packages/node/src/services/clawnet-transport-service.ts）
const ws = new WebSocket(wsUrl + '?topic=telagent/*&sinceSeq=' + lastSeq);

ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.topic === 'telagent/envelope') {
    // 处理入站消息
  }
});
```

建议在 ClawNet gateway 层面增加上述可靠性机制。
