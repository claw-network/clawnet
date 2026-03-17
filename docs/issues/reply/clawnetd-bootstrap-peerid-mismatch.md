# 回复：DEFAULT_P2P_CONFIG.bootstrap 中 PeerId 与 clawnetd.com 实际节点不匹配

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-bootstrap-peerid-mismatch.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-17 |
| 修复版本 | **0.6.16** (已发布至 npm + PyPI，tag `v0.6.16`) |

---

## 1. 确认

问题已确认。这是 v0.6.15 中所有 P2P 连接失败的真正根因：

- `BOOTSTRAP_MULTIADDR` 中硬编码的 PeerId（`12D3KooWRTEtx4rD…`）与 clawnetd.com 上实际运行节点的 PeerId（`12D3KooWQnQQNGBG…`）不一致
- libp2p Noise 握手验证远端身份密钥，PeerId 不匹配 → 连接被安全层拒绝
- 表现为 `peer:discovery` 成功但 `peer:connect` 永远不发生

---

## 2. 修复方案

采用**动态 PeerId 解析**方案，从根本上消除硬编码 PeerId 问题。

### 2.1 去掉硬编码 PeerId

**文件**: `packages/core/src/p2p/config.ts`

`BOOTSTRAP_MULTIADDR` 改为不含 PeerId 的基础地址：

```typescript
// 旧（包含硬编码 PeerId）
export const BOOTSTRAP_MULTIADDR =
  '/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWRTEtx4rD…';

// 新（仅 host + port，无 PeerId）
export const BOOTSTRAP_HOST = 'clawnetd.com';
export const BOOTSTRAP_PORT = 9527;
export const BOOTSTRAP_API_URL = 'https://api.clawnetd.com/api/v1/node';
export const BOOTSTRAP_MULTIADDR = `/dns4/${BOOTSTRAP_HOST}/tcp/${BOOTSTRAP_PORT}`;
```

### 2.2 运行时解析 PeerId

新增 `resolveBootstrapMultiaddrs()` 函数：

- 启动时调用 `GET https://api.clawnetd.com/api/v1/node` 获取实时 PeerId
- 3 秒超时，失败则**拒绝启动**（无静默 fallback）
- 返回完整 multiaddr：`/dns4/clawnetd.com/tcp/9527/p2p/<live PeerId>`

### 2.3 自动检测与解析

**文件**: `packages/node/src/index.ts`

`ClawNetNode.startInternal()` 在构建 p2pConfig 后检测是否使用默认 bootstrap 地址，若是则自动调用 resolver 替换为带实时 PeerId 的完整地址。自定义 bootstrap 地址不受影响。

### 2.4 `--no-bootstrap` CLI 标志

**文件**: `packages/node/src/daemon.ts`

新增 `--no-bootstrap` 命令行参数，供 bootstrap 节点使用。bootstrap 节点自身不需要 bootstrap peers，且启动时自己的 API 尚未就绪，无法进行自我解析。

```bash
# bootstrap 节点启动
node dist/daemon.js --data-dir /data --no-bootstrap --listen /ip4/0.0.0.0/tcp/9527

# 普通节点启动（自动解析）
node dist/daemon.js --data-dir /data --listen /ip4/0.0.0.0/tcp/9527
```

---

## 3. 文档更新

以下文档中的旧 PeerId 已全部更新：
- `CONVENTIONS.md`
- `docs/DEPLOYMENT.md`
- `docs/OPENCLAW_INTEGRATION.md`
- `skills/upgrade-clawnetd-server.md`
- `docs/issues/reply/clawnetd-empty-bootstrap-config.md`
- `docs/issues/clawnetd-empty-bootstrap-config.md`

---

## 4. 升级指引

### 嵌入式集成方（TelAgent 等）

```bash
npm install @claw-network/core@0.6.16 @claw-network/node@0.6.16
# 或
pip install clawnet-sdk==0.6.16
```

升级后节点启动时会自动从 bootstrap API 获取实时 PeerId。**要求**：节点启动时能访问 `https://api.clawnetd.com`（3 秒超时，失败则拒绝启动）。

### 独立部署方

```bash
cd /opt/clawnet && git pull origin main && pnpm install && pnpm build && systemctl restart clawnetd
```

如果是 bootstrap 节点，需在 systemd 服务文件中添加 `--no-bootstrap`。

---

## 5. 测试结果

- `@claw-network/core`: 83/83 passed
- `@claw-network/node`: 435/435 passed
- Lint: 0 warnings
- 生产服务器已升级至 v0.6.16，正常运行

---

## 6. 安装

```bash
# npm
npm install @claw-network/sdk@0.6.16

# Python
pip install clawnet-sdk==0.6.16

# Docker
docker pull ghcr.io/claw-network/clawnet:0.6.16
```
