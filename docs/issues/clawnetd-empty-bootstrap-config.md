# ClawNet：ensureConfig 生成空 bootstrap 列表导致新节点网络隔离

| 字段 | 值 |
| --- | --- |
| 优先级 | **P1 — 影响所有新安装的嵌入式节点** |
| 提出方 | TelAgent 团队 |
| 提出日期 | 2026-03-17 |
| 影响范围 | 所有首次初始化的嵌入式 ClawNetNode |
| `@claw-network/node` 版本 | 0.6.14 |
| `@claw-network/core` 版本 | 0.6.14 |

---

## 1. 问题描述

`ClawNetNode` 首次启动时，`ensureConfig()` 在 `config.yaml` 中写入 `bootstrap: []`（空数组）。之后的启动中，构造函数使用 `??` 运算符判断优先级：

```js
bootstrap: this.config.p2p?.bootstrap ?? persisted.p2p?.bootstrap ?? DEFAULT_P2P_CONFIG.bootstrap
```

由于空数组 `[]` 不是 `null` 也不是 `undefined`，`??` 不会 fallback 到 `DEFAULT_P2P_CONFIG.bootstrap`。结果：**所有未显式指定 `p2p.bootstrap` 的嵌入式节点永远没有 bootstrap peers。**

---

## 2. 复现步骤

```bash
# 1. 删除数据目录（模拟首次安装）
rm -rf ~/.telagent/clawnet

# 2. 以嵌入式模式启动
const node = new ClawNetNode({
  dataDir: '~/.telagent/clawnet',
  passphrase: 'test',
  api: { host: '127.0.0.1', port: 9528, enabled: true },
  // 注意：没有显式传入 p2p.bootstrap
});
await node.start();

# 3. 查看生成的 config.yaml
cat ~/.telagent/clawnet/config.yaml
```

**实际**：
```yaml
v: 1
network: devnet
p2p:
  listen:
    - /ip4/0.0.0.0/tcp/9527
  bootstrap: []     # ← 空！
```

**期望**：
```yaml
v: 1
network: devnet
p2p:
  listen:
    - /ip4/0.0.0.0/tcp/9527
  bootstrap:
    - /dns4/clawnetd.com/tcp/9527/p2p/12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM
```

---

## 3. 根因分析

两个环节共同导致：

### 3.1 `ensureConfig()` 持久化空 bootstrap

`ensureConfig()` 在首次初始化时生成 config.yaml。此时可能没有从 `DEFAULT_P2P_CONFIG` 中取默认 bootstrap 列表，或者序列化时空数组 `[]` 被写入。

### 3.2 `??` 运算符不区分空数组和 undefined

```js
// ClawNetNode 构造函数中
const p2pConfig = {
  ...DEFAULT_P2P_CONFIG,
  ...this.config.p2p,
  listen: this.config.p2p?.listen ?? persisted.p2p?.listen ?? DEFAULT_P2P_CONFIG.listen,
  bootstrap: this.config.p2p?.bootstrap ?? persisted.p2p?.bootstrap ?? DEFAULT_P2P_CONFIG.bootstrap,
  //                                       ^^^^^^^^^^^^^^^^^^^^^^^^^
  //                                       空数组 [] 不是 nullish
  //                                       所以不会 fallback 到 DEFAULT
};
```

---

## 4. 建议修复方案

### 方案 A：`ensureConfig()` 填入默认 bootstrap（推荐）

在 `ensureConfig()` 中，如果新生成 config.yaml，应从 `DEFAULT_P2P_CONFIG` 取 bootstrap 列表写入：

```js
// ensureConfig() — 生成新 config 时
const defaultConfig = {
  v: 1,
  network: network ?? 'devnet',
  p2p: {
    listen: ['/ip4/0.0.0.0/tcp/9527'],
    bootstrap: DEFAULT_P2P_CONFIG.bootstrap,  // ← 写入默认 bootstrap
  },
};
```

### 方案 B：构造函数用 `||` 或长度检查代替 `??`

```js
bootstrap: this.config.p2p?.bootstrap?.length
  ? this.config.p2p.bootstrap
  : (persisted.p2p?.bootstrap?.length ? persisted.p2p.bootstrap : DEFAULT_P2P_CONFIG.bootstrap),
```

### 方案 C：两者都做（最安全）

既修正 `ensureConfig()` 的初始值，又在构造函数中对空数组做 fallback。

---

## 5. TelAgent 侧临时规避

```ts
// packages/node/src/clawnet/managed-node.ts
const { DEFAULT_P2P_CONFIG } = await import('@claw-network/core');

this.node = new ClawNetNode({
  dataDir: this.dataDir,
  passphrase: this.passphrase,
  api: { host: '127.0.0.1', port, enabled: true },
  p2p: { bootstrap: DEFAULT_P2P_CONFIG.bootstrap },  // ← 显式传入
  chain: chainConfig,
});
```

这确保即使 config.yaml 中 bootstrap 为空，也能通过构造参数传入正确的值（构造参数优先级最高）。

但这意味着所有嵌入方都需要知道这个 workaround，不如在 `@claw-network/node` 内部修复。
