# CalVer 版本管理方案

> 一套适用于 monorepo 和多包项目的日历版本号（Calendar Versioning）方案，
> 用于替代 SemVer，提供更直观的时间线认知和更简单的版本决策。

---

## 为什么不用 SemVer？

| 痛点 | 说明 |
|------|------|
| **"大版本恐惧"** | 团队对 major bump 过度谨慎，导致 v0.x 停留数年 |
| **语义模糊** | "breaking change" 的定义因人而异，争论不断 |
| **版本号没有时间信息** | `3.14.2` 无法判断是上周还是两年前的版本 |
| **多包联动复杂** | monorepo 中多个包保持 SemVer 同步时心智负担重 |

CalVer 用**年份 + 序列号**编码版本，一眼可知发布时间线，版本决策降为两种——"发新版"或"打补丁"。

---

## 版本格式

```
YEAR.SEQ          — 正式发布（release）
YEAR.SEQ.PATCH    — 补丁版本（patch）
```

### 字段说明

| 字段 | 含义 | 规则 |
|------|------|------|
| `YEAR` | 4 位年份 | 取自当前日历年（e.g. 2026） |
| `SEQ` | 年内发布序号 | 从 1 开始，跨年自动重置为 1 |
| `PATCH` | 补丁号 | 从 **1** 开始（非 0），仅在需要时追加 |

### 版本演进示例

```
2026.1           ← 首个正式版本
2026.1.1         ← 第一个补丁
2026.1.2         ← 第二个补丁
2026.2           ← 第二次正式发布（PATCH 字段消失）
2026.3           ← 第三次正式发布
2027.1           ← 跨年后 SEQ 重置为 1
2027.1.1         ← 跨年后的第一个补丁
```

### 关键设计决策

1. **PATCH 从 1 开始**，不从 0 开始——`.0` 保留给 npm 三段式存储（见下文）。
2. **无 `v` 前缀**——Git tag 直接使用 `2026.1`，不带 `v`。
3. **补丁不重置 SEQ**——`2026.1.3` 后做 release 得到 `2026.2`，而非 `2026.1`。
4. **跨年重置 SEQ**——`2026.12` 后新年首次 release 得到 `2027.1`。

### npm 双表示法

npm 内部会将 `2026.1` 标准化为 `2026.1.0`。为保证 `npm install` / `npm publish` 行为完全正常，采用**双表示法**：

| 场景 | 格式 | 示例 |
|------|------|------|
| `package.json` | 始终三段式 | `2026.1.0`、`2026.1.1` |
| Git tag | 最简 CalVer | `2026.1`、`2026.1.1` |
| `pyproject.toml` | 最简 CalVer | `2026.1`、`2026.1.1` |
| CHANGELOG / 人类交流 | 最简 CalVer | `2026.1`、`2026.1.1` |

转换规则很简单：

```javascript
// package.json → 补 .0
function toNpmVersion(ver) {
  return ver.split('.').length === 2 ? `${ver}.0` : ver;
}

// 显示 → 去掉尾部 .0
function toDisplayVersion(ver) {
  return ver.replace(/\.0$/, '');
}
```

这样 PATCH `.0` 永远不会出现在人类可见的版本号中，实际补丁从 `.1` 开始，语义清晰无歧义。

---

## 版本操作

日常只需两个命令：

| 操作 | 命令 | 效果 |
|------|------|------|
| **发布** | `bump release` | `YEAR.SEQ` → `YEAR.(SEQ+1)` 或跨年 `NEWYEAR.1` |
| **补丁** | `bump patch` | `YEAR.SEQ` → `YEAR.SEQ.1`；`YEAR.SEQ.N` → `YEAR.SEQ.(N+1)` |
| **指定版本** | `bump 2026.5` | 直接设置为目标版本 |
| **预览** | `bump release --dry` | 仅打印，不修改文件 |

### 何时用 release vs patch？

```
release — 新功能、API 变更、大批改动、计划内发版
patch   — Bug 修复、安全补丁、文档修正、紧急热修复
```

不需要判断 "major 还是 minor"，认知成本最低。

---

## Monorepo 多包同步策略

适用于 monorepo 中**一组紧密耦合的包**共享同一版本号：

### 分类原则

| 类型 | 特征 | 版本管理 |
|------|------|----------|
| **同步包** | 核心库、SDK、CLI 等一起发布的包 | 统一 CalVer，脚本一键 bump |
| **独立包** | Web 前端、合约、文档站等独立生命周期 | 各自维护版本，不参与统一 bump |

### Bump 脚本核心逻辑

```javascript
// 解析 CalVer 版本（兼容 npm 三段式）
function parseCalVer(version) {
  const parts = version.split('.').map(Number);
  if (parts.length === 2) return { year: parts[0], seq: parts[1], patch: null };
  if (parts.length === 3) return { year: parts[0], seq: parts[1], patch: parts[2] };
  return null;
}

// 计算下一个版本（返回最简 CalVer 形式）
function bumpVersion(current, type) {
  const currentYear = new Date().getFullYear();
  const parsed = parseCalVer(current);

  if (type === 'release') {
    if (!parsed) return `${currentYear}.1`;          // 首次迁移
    if (currentYear > parsed.year) return `${currentYear}.1`;  // 跨年重置
    return `${parsed.year}.${parsed.seq + 1}`;       // 正常递增
  }

  if (type === 'patch') {
    // patch=null (两段) 或 patch=0 (npm 三段式) 均视为无补丁
    const nextPatch = (parsed.patch == null || parsed.patch === 0) ? 1 : parsed.patch + 1;
    return `${parsed.year}.${parsed.seq}.${nextPatch}`;
  }

  // 显式版本，校验格式
  if (/^\d{4}\.\d+(\.\d+)?$/.test(type)) return type;
  throw new Error(`Invalid: "${type}"`);
}

// 写入 package.json 时补 .0；显示/tag/pyproject 用最简形式
function toNpmVersion(ver) {
  return ver.split('.').length === 2 ? `${ver}.0` : ver;
}
function toDisplayVersion(ver) {
  return ver.replace(/\.0$/, '');
}
```

脚本遍历所有同步包的 `package.json`（写入三段式）和 Python 的 `pyproject.toml`（写入最简形式），一次性统一版本。

---

## CI/CD 集成

### Git Tag 触发

```yaml
# .github/workflows/publish.yml
on:
  push:
    tags:
      - '20*'       # 匹配 2020-2099 所有 CalVer tag
```

不再匹配 `v*`，因为不使用 `v` 前缀。

### Release 工作流中提取版本

```yaml
# 无需去掉 v 前缀
- name: Get version
  run: echo "VERSION=${GITHUB_REF#refs/tags/}" >> $GITHUB_ENV
```

### 完整发布流程

```bash
# 1. Bump
bump release                  # 或 bump patch

# 2. 构建 & 测试
build && test

# 3. 提交 & 打 Tag
git add -A
git commit -m "chore: bump to 2026.2"
git tag 2026.2
git push && git push origin 2026.2

# 4. CI 自动触发发布
#    → npm publish / PyPI upload / GitHub Packages
```

---

## 从 SemVer 迁移

### 步骤

1. **确定首个 CalVer 版本**：直接使用 `YEAR.1`（e.g. `2026.1`），无需延续旧版本号。
2. **修改 bump 脚本**：替换 semver 逻辑为上述 CalVer 逻辑。
3. **更新 CI tag 匹配**：`'v*'` → `'20*'`。
4. **更新 tag 提取逻辑**：移除 `${GITHUB_REF#refs/tags/v}` 中的 `v` 剥离。
5. **更新 package.json scripts**：`bump:minor` / `bump:major` → `bump:release`。
6. **写入版本并提交**：`bump 2026.1` → commit → tag → push。

### 迁移检查清单

- [ ] bump 脚本支持 `release` / `patch` / 显式版本
- [ ] bump 脚本写入 package.json 时使用三段式（`.0` 补齐）
- [ ] bump 脚本 Git tag / pyproject.toml 使用最简 CalVer 形式
- [ ] bump 脚本包含 `--dry` 预览模式
- [ ] CI tag pattern 改为 `'20*'`
- [ ] Release workflow 版本提取去掉 `v` 前缀处理
- [ ] package.json scripts 只保留 `bump:release` 和 `bump:patch`
- [ ] README / CHANGELOG 说明版本格式变更
- [ ] 首个 CalVer 版本成功发布并验证

---

## FAQ

### Q: 补丁号为什么从 1 开始而不是 0？

`.0` 被保留用于 npm 三段式存储——`package.json` 中 release 版本存为 `2026.1.0`，但人类可见的版本号始终是 `2026.1`。补丁从 `.1` 开始，避免 `2026.1.0` 和 `2026.1` 的歧义。

### Q: 年中加入的项目，SEQ 从多少开始？

从 1 开始。SEQ 不反映日历月份，纯粹是发布次数计数器。

### Q: 一年内可以发多少个版本？

无上限。`2026.1` 到 `2026.99` 甚至 `2026.200` 都是合法的。

### Q: 如何表达 breaking change？

在 CHANGELOG 和 commit message 中说明即可。CalVer 不在版本号中编码兼容性语义——这些信息属于文档而非编号。

### Q: 和 Ubuntu / pip 等项目的 CalVer 有何区别？

Ubuntu 用 `YY.MM`（如 `24.04`），pip 用 `YY.N`。本方案使用 4 位年 + 序列号 + 可选补丁，更灵活且不与月份绑定。

### Q: Python 项目兼容吗？

兼容。PEP 440 允许 `2026.1` 和 `2026.1.1` 这样的版本号。`pyproject.toml` 中直接写入即可。

### Q: 与 npm registry 兼容吗？

完全兼容。bump 脚本写入 `package.json` 时始终使用三段式（如 `2026.1.0`），npm 原生支持。Git tag 和人类交流中使用两段式（`2026.1`）保持 CalVer 简洁。补丁版本如 `2026.1.1` 在两个场景中格式一致，无需转换。

---

## 参考

- [CalVer 官网](https://calver.org/)
- [pip 的 CalVer 实践](https://pip.pypa.io/en/stable/news/)
- [Ubuntu 版本命名](https://wiki.ubuntu.com/Releases)
- [PEP 440 — Version Identification](https://peps.python.org/pep-0440/)
