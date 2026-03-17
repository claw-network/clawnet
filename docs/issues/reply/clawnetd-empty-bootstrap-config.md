# 回复：ensureConfig 生成空 bootstrap 列表导致新节点网络隔离

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-empty-bootstrap-config.md` |
| 优先级 | **P1** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-17 |
| 修复版本 | **0.6.15** (已发布至 npm + PyPI，tag `v0.6.15`) |

---

## 1. 确认

问题已确认并复现。根因分析完全准确：

1. `DEFAULT_CONFIG`（`packages/core/src/storage/config.ts`）中硬编码了 `bootstrap: []`，导致 `ensureConfig()` 在首次初始化时将空数组写入 `config.yaml`。
2. `ClawNetNode.startInternal()`（`packages/node/src/index.ts`）中使用 `??` 运算符，空数组 `[]` 不是 nullish 值，因此不会 fallback 到 `DEFAULT_P2P_CONFIG.bootstrap`。

两个环节共同作用，导致所有未显式传入 `p2p.bootstrap` 的嵌入式节点永远拿不到 bootstrap peers。

---

## 2. 修复方案

采用 Issue 中建议的**方案 C（两处同时修复）**，这是最安全的做法，既修正了源头，又兼容已有的空 `config.yaml`。

### 2.1 修复 `DEFAULT_CONFIG` 初始值

**文件**: `packages/core/src/storage/config.ts`

```diff
+ import { DEFAULT_P2P_CONFIG } from '../p2p/config.js';

  export const DEFAULT_CONFIG: NodeConfig = {
    v: 1,
    network: 'devnet',
    p2p: {
      listen: ['/ip4/0.0.0.0/tcp/9527'],
-     bootstrap: [],
+     bootstrap: DEFAULT_P2P_CONFIG.bootstrap,
    },
    logging: { level: 'info' },
  };
```

**效果**: 新生成的 `config.yaml` 自动包含正确的 bootstrap multiaddr。

### 2.2 修复构造函数 `??` fallback

**文件**: `packages/node/src/index.ts`

```diff
  const p2pConfig: Partial<P2PConfig> = {
    ...DEFAULT_P2P_CONFIG,
    ...this.config.p2p,
    listen: this.config.p2p?.listen ?? persisted.p2p?.listen ?? DEFAULT_P2P_CONFIG.listen,
    bootstrap:
-     this.config.p2p?.bootstrap ?? persisted.p2p?.bootstrap ?? DEFAULT_P2P_CONFIG.bootstrap,
+     (this.config.p2p?.bootstrap?.length ? this.config.p2p.bootstrap : undefined)
+     ?? (persisted.p2p?.bootstrap?.length ? persisted.p2p.bootstrap : undefined)
+     ?? DEFAULT_P2P_CONFIG.bootstrap,
  };
```

**效果**: 即使已有 `config.yaml` 中的 `bootstrap: []`，也会正确 fallback 到 `DEFAULT_P2P_CONFIG.bootstrap`。

---

## 3. 新增测试

**文件**: `packages/core/test/p2p-config.test.ts` — 新增 3 个测试用例：

- `DEFAULT_CONFIG` 的 `bootstrap` 非空且与 `DEFAULT_P2P_CONFIG.bootstrap` 一致
- `DEFAULT_CONFIG` 包含标准 `BOOTSTRAP_MULTIADDR`
- 空数组 fallback 逻辑验证：`[] → [] → DEFAULT_P2P_CONFIG.bootstrap`

---

## 4. TelAgent 侧的影响

修复后，TelAgent 的临时 workaround 代码（构造时显式传入 `p2p: { bootstrap: DEFAULT_P2P_CONFIG.bootstrap }`）**不再必要**，但保留也无害 — 构造参数优先级仍然最高，显式传入会覆盖默认值。

建议升级到 0.6.15 后移除该 workaround，减少对 ClawNet 内部常量的直接依赖。

升级命令：

```bash
npm install @claw-network/node@0.6.15 @claw-network/core@0.6.15
# 或
pnpm add @claw-network/node@0.6.15 @claw-network/core@0.6.15
```

---

## 5. 验证方法

```bash
# 1. 删除现有 config
rm -rf ~/.telagent/clawnet

# 2. 以嵌入式模式启动（不传 p2p.bootstrap）
const node = new ClawNetNode({
  dataDir: '~/.telagent/clawnet',
  passphrase: 'test',
  api: { host: '127.0.0.1', port: 9528, enabled: true },
});
await node.start();

# 3. 验证 config.yaml
cat ~/.telagent/clawnet/config.yaml
# 期望 bootstrap 字段包含:
#   - /dns4/clawnetd.com/tcp/9527/p2p/12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW
```
