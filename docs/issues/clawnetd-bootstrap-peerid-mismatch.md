# ClawNet：DEFAULT_P2P_CONFIG.bootstrap 中 PeerId 与 clawnetd.com 实际节点不匹配 — 所有新节点 P2P 连接必定失败

| 字段 | 值 |
| --- | --- |
| 优先级 | **P0 — 阻塞所有使用默认 bootstrap 配置的节点的 P2P 连接** |
| 提出方 | TelAgent 团队 |
| 提出日期 | 2026-03-17 |
| 影响范围 | 所有使用 `DEFAULT_P2P_CONFIG.bootstrap` 默认值的嵌入式或独立 ClawNet 节点 |
| `@claw-network/node` 版本 | 0.6.15 |
| `@claw-network/core` 版本 | 0.6.15 |
| 前置 Issue | `clawnetd-nat-p2p-connection-failure.md` — 本 Issue 是其真正根因 |

---

## 1. 问题描述

在升级到 0.6.15 并利用新增的 P2P 诊断日志排查 `clawnetd-nat-p2p-connection-failure` 时，发现 **P2P 连接失败的根因不是 NAT 穿透问题，而是 bootstrap 节点的 PeerId 不匹配**：

```
[p2p] amplify dial failed for 12D3KooWRTEtx4rD…:
  Payload identity key 12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM
  does not match expected remote identity key 12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW
```

即：
- `DEFAULT_P2P_CONFIG.bootstrap` 中硬编码的 PeerId：`12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW`
- `clawnetd.com:9527` 上实际运行的节点的 PeerId：`12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM`

libp2p 的 Noise 握手协议在连接建立时验证远端节点的身份密钥。由于 multiaddr 中声明的 PeerId 与实际握手中的 PeerId 不一致，**连接被 libp2p 安全层拒绝**。这导致：

- `peer:discovery` 成功（bootstrap multiaddr 格式有效，DNS 解析正常，TCP 可达）
- `peer:connect` 永远不发生（Noise 身份验证失败）
- 所有 P2P 消息永远卡在 outbox

---

## 2. 复现步骤

```bash
# 1. 全新安装（删除 ClawNet 数据目录）
rm -rf ~/.clawnet

# 2. 启动嵌入式 ClawNet 节点（使用 0.6.15 默认配置）
# 不传任何显式 bootstrap — 依赖 DEFAULT_P2P_CONFIG

# 3. 观察日志
[p2p] peer:discovery 12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW
[p2p] amplify dial failed for 12D3KooWRTEtx4rD…: Payload identity key
  12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM does not match expected
  remote identity key 12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW
# （此错误在 aggressive phase 中持续重复，直到放弃）
[mesh] aggressive phase complete — 0 peer connection(s), switching to watchdog

# 4. 检查节点状态
curl http://127.0.0.1:9528/api/v1/node
# → peers: 0, connections: 0
```

---

## 3. 根因分析

```
DEFAULT_P2P_CONFIG.bootstrap =
  /dns4/clawnetd.com/tcp/9527/p2p/12D3KooWRTEtx4rD…   ← 旧 PeerId

clawnetd.com:9527 实际运行节点 =
  PeerId: 12D3KooWQnQQ…                                 ← 新 PeerId

连接流程:
  DNS 解析 clawnetd.com → 66.94.125.242              ✅
  TCP connect :9527                                    ✅
  Noise handshake — 验证远端 PeerId                    ❌ mismatch → 拒绝连接
```

推测 bootstrap 服务器（`clawnetd.com`）在某次部署/重启/迁移中重新生成了密钥对，导致 PeerId 变更，但 `DEFAULT_P2P_CONFIG` 中的 multiaddr 常量没有同步更新。

---

## 4. 影响范围

| 影响 | 说明 |
|------|------|
| **所有 0.6.15 新安装节点** | `config.yaml` 中写入的 bootstrap multiaddr 包含错误的 PeerId |
| **所有 0.6.14 升级 0.6.15 后新初始化的节点** | 同上 |
| **已有 config.yaml 但 bootstrap 为空的节点** | 0.6.15 的 `??` fallback 修复使其使用 `DEFAULT_P2P_CONFIG`，但该默认值本身就是错的 |
| **之前 `clawnetd-nat-p2p-connection-failure` Issue** | 该 Issue 描述的现象完全由本 PeerId 不匹配导致，不是 NAT 穿透问题 |

---

## 5. 建议修复方案

### 方案 A：更新 `DEFAULT_P2P_CONFIG.bootstrap` 常量（紧急）

将 multiaddr 中的 PeerId 更新为 bootstrap 节点的实际值：

```diff
  export const DEFAULT_P2P_CONFIG = {
    bootstrap: [
-     '/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW',
+     '/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM',
    ],
  };
```

发布 0.6.16 hotfix。

### 方案 B：引入 DNS-based peer discovery（中期）

将 bootstrap 节点的 PeerId 从硬编码 multiaddr 中移除，改用 DNS TXT 记录或 `/dnsaddr/` multiaddr 方案，使 bootstrap 服务器可以在不更新客户端代码的情况下轮换密钥：

```
/dnsaddr/bootstrap.clawnetd.com
```

配合 DNS TXT 记录：
```
_dnsaddr.bootstrap.clawnetd.com TXT "dnsaddr=/dns4/clawnetd.com/tcp/9527/p2p/<当前PeerId>"
```

### 方案 C：Bootstrap 节点密钥持久化（根本预防）

确保 bootstrap 节点的 libp2p 密钥对在重启/重部署时不会丢失：
- 将密钥存储在持久卷中
- 部署脚本中验证 PeerId 与 `DEFAULT_P2P_CONFIG` 一致
- CI/CD 中加入 PeerId 一致性检查

---

## 6. 诊断数据

### 生成的 config.yaml（0.6.15 首次初始化）

```yaml
v: 1
network: devnet
p2p:
  listen:
    - /ip4/0.0.0.0/tcp/9527
  bootstrap:
    - /dns4/clawnetd.com/tcp/9527/p2p/12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW
logging:
  level: info
```

### `/api/v1/node` 输出

```json
{
  "data": {
    "did": "did:claw:zCi2engm5ikZScLVWbDp3FRXZqcTGv6ctHgVzRkFLqAd4",
    "peerId": "12D3KooWMXPpXpLnuepw2DzwDpZP2DcQKwVuwnhNFGs1ojQEj7Lz",
    "synced": true,
    "blockHeight": 88918,
    "peers": 0,
    "connections": 0,
    "network": "devnet",
    "version": "0.6.15"
  }
}
```

### 网络连通性

```bash
$ dig +short clawnetd.com
66.94.125.242

$ nc -z -w5 clawnetd.com 9527
Connection to clawnetd.com port 9527 [tcp/*] succeeded!
```

TCP 层完全正常，问题 100% 在 libp2p Noise 身份验证层。

---

## 7. TelAgent 侧状态

| 已完成 | 说明 |
|--------|------|
| 升级到 `@claw-network/*` 0.6.15 | Issue 1（空 bootstrap）和 Issue 3（outbox sweep）的修复已生效 |
| 移除 bootstrap workaround | `ManagedClawNetNode` 不再显式传入 `DEFAULT_P2P_CONFIG.bootstrap` |
| 确认 Issue 1 修复 | `config.yaml` 中 bootstrap 非空 ✅ |

等待本 Issue 修复后，P2P 连接应能正常建立，之前 `clawnetd-nat-p2p-connection-failure` 中描述的所有问题（消息卡在 outbox、profile-card 交换失败等）预计将同步解决。
