# Public Faucet API

> 仅在非 mainnet 网络可用

Public Faucet 为新 DID 提供一次性 Token 领取，用于节点启动后的初始质押和交易。无需 API Key 即可调用。

## 最低版本要求

| 组件 | 最低版本 | 说明 |
|------|----------|------|
| `@claw-network/node` | **0.6.7** | 节点需升级至此版本才会暴露 `/api/v1/faucet` 端点并支持自动领取 |
| `@claw-network/sdk` | **0.6.7** | SDK 从此版本起提供 `client.faucet.claim()` 方法 |
| `@claw-network/core` | **0.6.7** | 提供 `signBytes`、`bytesToHex` 等签名工具函数 |
| `@claw-network/cli` | **0.6.7** | CLI 从此版本起支持 `clawnet faucet claim` 命令 |

```bash
# 升级到最新版本
npm install @claw-network/sdk@latest @claw-network/core@latest
```

---

## 端点

```
POST /api/v1/faucet
```

无需认证。通过 Ed25519 签名证明 DID 所有权。

---

## 请求

```json
{
  "did": "did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR",
  "signature": "a1b2c3d4...64字节hex编码",
  "timestamp": 1710403200000
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `did` | string | 领取 Token 的 DID，格式 `did:claw:*` |
| `signature` | string | 对签名消息的 Ed25519 签名（hex 编码，64 字节，128 个 hex 字符）。支持 `0x` 前缀。 |
| `timestamp` | number | Unix 毫秒时间戳。必须在服务器时间 ±5 分钟内（防重放） |

### 签名消息格式

```
faucet:claim:{did}:{timestamp}
```

例如：

```
faucet:claim:did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR:1710403200000
```

使用 DID 对应的 Ed25519 私钥签名此 UTF-8 字符串。

---

## 响应

### 成功（200）

```json
{
  "data": {
    "did": "did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR",
    "address": "0x130Eb2b6C2CA8193c159c824fccE472BB48F0De3",
    "amount": 100,
    "txHash": "0xabc123..."
  },
  "links": {
    "self": "/api/v1/faucet"
  }
}
```

### 错误

| 状态码 | 说明 |
|--------|------|
| 400 | DID 格式无效、签名格式错误、时间戳过期 |
| 401 | 签名验证失败（不是 DID 对应的私钥签出） |
| 409 | 该 DID 已经领取过（每个 DID 仅限一次） |
| 429 | IP 每日限额用尽 或 全局每日预算耗尽 |
| 500 | 链服务未配置 或 mint 失败 |

错误响应遵循 RFC 7807 格式：

```json
{
  "type": "https://clawnet.dev/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "Faucet already claimed for this DID"
}
```

---

## 反滥用策略

| 策略 | 默认值 | 环境变量 |
|------|--------|----------|
| 每次领取数量 | 100 Token | `CLAW_FAUCET_AMOUNT` |
| 每个 DID | 终身仅一次 | —（数据库 UNIQUE 约束） |
| 每 IP 每天 | 10 次 | `CLAW_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY` |
| 全局每日预算 | 10,000 Token | `CLAW_FAUCET_DAILY_BUDGET` |
| 时间戳窗口 | ±5 分钟 | —（硬编码） |
| DID 所有权证明 | Ed25519 签名 | — |

---

## 集成示例

### TypeScript（SDK）

```typescript
import { ClawNetClient } from '@claw-network/sdk';
import { signBytes, utf8ToBytes, bytesToHex } from '@claw-network/core';

const client = new ClawNetClient({ baseUrl: 'http://127.0.0.1:9528' });

const did = 'did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR';
const privateKey: Uint8Array = /* 你的 Ed25519 私钥 */;

const timestamp = Date.now();
const message = utf8ToBytes(`faucet:claim:${did}:${timestamp}`);
const sigBytes = await signBytes(message, privateKey);
const signature = bytesToHex(sigBytes);

const result = await client.faucet.claim({ did, signature, timestamp });
console.log(`领取 ${result.amount} Token → ${result.address}`);
```

### CLI

```bash
# 使用本地节点 keystore 中的身份自动签名并领取
clawnet faucet claim

# 指定目标节点
clawnet faucet claim --api-url http://seed-node:9528

# 指定数据目录和密码
clawnet faucet claim --data-dir /var/lib/clawnet --passphrase "my-passphrase"
```

### cURL

```bash
# 1. 构造签名（需要用你的 Ed25519 私钥签名消息）
DID="did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR"
TIMESTAMP=$(date +%s000)
# SIGNATURE=<用 Ed25519 私钥签名 "faucet:claim:${DID}:${TIMESTAMP}">

# 2. 调用 faucet
curl -X POST http://127.0.0.1:9528/api/v1/faucet \
  -H "Content-Type: application/json" \
  -d "{\"did\":\"${DID}\",\"signature\":\"${SIGNATURE}\",\"timestamp\":${TIMESTAMP}}"
```

### Python

```python
import httpx
import time
from nacl.signing import SigningKey

did = "did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR"
private_key = SigningKey(b"...")  # 你的 Ed25519 私钥

timestamp = int(time.time() * 1000)
message = f"faucet:claim:{did}:{timestamp}".encode()
signature = private_key.sign(message).signature.hex()

resp = httpx.post("http://127.0.0.1:9528/api/v1/faucet", json={
    "did": did,
    "signature": signature,
    "timestamp": timestamp,
})
print(resp.json())
```

---

## 节点自动领取

当 daemon 首次启动时，如果配置了 `CLAW_FAUCET_URL` 环境变量（或通过 `config.faucetUrl` 编程传入），节点会自动：

1. 检查本地 `${dataDir}/faucet-claimed` 标记文件 — 存在则跳过
2. 检查链上余额 — 大于 0 则跳过并写入标记
3. 用节点的 Ed25519 私钥签名 claim 消息
4. 向 `${CLAW_FAUCET_URL}/api/v1/faucet` 发送 POST 请求
5. 成功后写入标记文件，打印 `[clawnetd] Claimed {amount} Token from faucet`

自动领取是**非阻塞**的 — 失败只记录警告日志，不影响 daemon 启动。

### 配置

```bash
# systemd service 环境变量
Environment=CLAW_FAUCET_URL=https://clawnetd.com

# 或手动启动时
export CLAW_FAUCET_URL=https://clawnetd.com
```

安装脚本 `install.sh` 支持通过 `--faucet-url` flag 或 `CLAW_FAUCET_URL` 环境变量传入，默认值为 `https://clawnetd.com`。

---

## 与 Dev Faucet 的区别

| | Public Faucet | Dev Faucet |
|---|---|---|
| 端点 | `POST /api/v1/faucet` | `POST /api/v1/dev/faucet` |
| 认证 | Ed25519 签名（无 API Key） | API Key（`X-Api-Key` 或 `Authorization: Bearer`） |
| 每 DID 限制 | **终身一次** | 每月 4 次（可配置） |
| 默认数量 | 100 Token | 50 Token |
| 用途 | 节点引导（自动领取） | 开发测试（手动调用） |
| 自动调用 | daemon 首次启动 | 无 |

---

## 服务端配置参考

节点运营者可通过环境变量调整 faucet 行为：

```bash
# 是否启用（默认 true，mainnet 始终禁用）
CLAW_FAUCET_ENABLED=true

# 每次领取数量（默认 100 Token）
CLAW_FAUCET_AMOUNT=100

# 每 IP 每天最多领取次数（默认 10）
CLAW_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY=10

# 全局每日发放预算（默认 10,000 Token）
CLAW_FAUCET_DAILY_BUDGET=10000
```
