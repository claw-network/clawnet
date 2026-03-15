# 双仓库架构实施指南：Private → Public 自动同步

> **来源项目**: ClawNet
> **日期**: 2026-03-15
> **目标读者**: 其他项目组的 agent，用于在新项目中实施相同的双仓库架构
> **前置条件**: GitHub 组织已创建，项目代码在一个私有仓库中

---

## 1. 方案概述

### 为什么要双仓库？

开源项目往往需要同时维护：
- **私有仓库**：包含服务器配置、部署凭据、内部文档、运维 skills 等敏感内容
- **公开仓库**：只包含代码、公开文档、示例，供社区使用

双仓库方案通过 GitHub Action 自动将私有仓库的公开内容同步到公开仓库，开发者日常只在私有仓库工作，无需手动管理两份代码。

### 核心设计

```
┌──────────────────────────┐          ┌──────────────────────────┐
│  org/project-dev         │  sync    │  org/project             │
│  (PRIVATE)               │ ──────▶  │  (PUBLIC)                │
│  日常开发仓库            │  GitHub  │  开源仓库                │
│  完整内容 + 完整历史     │  Action  │  过滤后内容 · 单 commit  │
└──────────────────────────┘          └──────────────────────────┘
```

**关键特性**：
- 公开仓库 **没有 git 历史**（每次 force push 单 commit），历史中的敏感信息不会泄露
- push 到 `main` 或打 tag 时自动触发同步
- 同步前自动运行 secret scan，检测到泄露立即中止
- copilot-instructions 自动替换为脱敏版本

---

## 2. 实施步骤

### 阶段 A：规划排除内容

**先审计，后行动。** 在仓库中逐目录检查，分类为"公开"或"私有"。

常见需要排除的内容：

| 类型 | 典型路径 | 原因 |
|------|----------|------|
| 基础设施配置 | `infra/prod/`, `infra/staging/` | 含服务器 IP、端口、内部网络拓扑 |
| 部署文档/脚本 | `skills/`, `deploy/` | 含 SSH 地址、部署流程 |
| Copilot 指令 | `.github/copilot-instructions.md` | 可能含凭据、服务器信息 |
| 内部文档 | `docs/internal/`, `docs/handover/` | 架构决策、内部讨论 |
| Issue 跟踪 | `issues/` | 内部 bug/feature 讨论 |
| 临时文件 | `temp/`, `scratch/` | 调试脚本可能含敏感数据 |
| 环境配置 | `*.env`, `secrets.*` | 凭据（应已在 .gitignore 中） |

**决策原则**：
- 代码本身（`src/`, `packages/`, `lib/`）一般都公开
- 本地开发配置（devnet、docker-compose）公开
- 生产/测试环境配置私有
- API 文档（OpenAPI spec）公开，内部实现文档私有
- 示例代码、README、LICENSE、CHANGELOG 公开

### 阶段 B：收集敏感模式

在整个仓库中搜索硬编码的敏感信息：

```bash
# 搜索可能的私钥、密码、API key
grep -rn "password\|secret\|private.key\|api.key\|0x[a-f0-9]\{40,\}" . \
  --include='*.md' --include='*.yml' --include='*.yaml' \
  --include='*.json' --include='*.ts' --include='*.js' --include='*.sh' \
  | grep -v node_modules | grep -v .git
```

提取每个敏感值的 **唯一片段**（8-16 字符），用于同步时的自动检测。例如：
- API key `401ca444cbe821f7799e...` → 提取 `401ca444cbe821f7`
- 私钥 `0xb82233d82380d02515...` → 提取 `b82233d82380d025`
- 密码 `G66tdTcmvBz...` → 提取 `G66tdTcmvBz`

> ⚠️ **重要**：如果仓库曾经是 public 或任何 commit 中包含过敏感信息，转为 private 后这些信息仍可能被缓存。实施双仓库后应 **轮换所有暴露的凭据**。

### 阶段 C：创建公开仓库

```bash
# 创建公开仓库（空，不初始化）
gh repo create org/project --public --description "项目描述"

# 添加许可证（如果还没有）
# 在私有仓库根目录创建 LICENSE 文件（Apache-2.0 / MIT 等）
```

### 阶段 D：创建排除清单文件

在私有仓库根目录创建 `.public-sync-ignore`：

```
# Paths excluded from public repository sync.
# Used by .github/workflows/sync-public.yml to filter private content.
# This file is informational — the workflow uses explicit rm commands.

# Internal documentation (except public API spec)
docs/*

# Production infrastructure
infra/prod/
infra/staging/

# Deployment skills
skills/

# Internal issues and temp files
issues/
temp/

# This file itself
.public-sync-ignore

# Private copilot instructions (replaced with public version)
.github/copilot-instructions.md
```

> 注意：这个文件是**信息性**的（给人类和 agent 看），实际过滤由 workflow 中的 `rm` 命令执行。这样做比用 `.gitignore` 语法更可靠，避免 glob 解析差异。

### 阶段 E：创建公开版 Copilot 指令

创建 `.github/copilot-instructions.public.md`，内容与私有版相同但 **移除**：
- 服务器 IP、SSH 地址
- API key、私钥、密码
- 部署流程和命令
- 内部 URL（管理后台等）

同步时会自动将此文件重命名为 `.github/copilot-instructions.md`。

### 阶段 F：创建同步 Workflow

创建 `.github/workflows/sync-public.yml`：

```yaml
name: Sync to Public Repo

on:
  push:
    branches: [main]
    tags:
      - 'v*'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Prepare public content
        run: |
          set -euo pipefail

          # ── 1. 保留需要公开的子目录 ──
          # 如果某个被排除的父目录下有需要保留的子目录，先复制出来
          mkdir -p /tmp/preserve
          # 例：排除 docs/* 但保留 docs/api/
          cp -r docs/api /tmp/preserve/docs_api

          # ── 2. 删除私有目录和文件 ──
          # ⚠️ 每个路径显式列出，不用 glob，确保可审计
          rm -rf docs skills issues temp
          rm -rf infra/prod infra/staging
          rm -f .public-sync-ignore
          rm -f .github/copilot-instructions.md

          # ── 3. 还原保留的公开子目录 ──
          mkdir -p docs
          cp -r /tmp/preserve/docs_api docs/api
          rm -rf /tmp/preserve

          # ── 4. 替换 copilot 指令为公开版 ──
          mv .github/copilot-instructions.public.md .github/copilot-instructions.md

          # ── 5. 删除同步 workflow 本身（公开仓库不需要） ──
          rm -f .github/workflows/sync-public.yml

          echo "=== Public content prepared ==="
          ls -d */ .github/ 2>/dev/null || true

      - name: Verify no secrets leaked
        run: |
          set -euo pipefail
          LEAKED=0

          # 检查已知敏感模式（每个值的唯一片段）
          for pattern in \
            "YOUR_SECRET_FRAGMENT_1" \
            "YOUR_SECRET_FRAGMENT_2" \
            "YOUR_SECRET_FRAGMENT_3"; do
            if grep -rq "$pattern" . \
              --include='*.md' --include='*.yml' --include='*.yaml' \
              --include='*.json' --include='*.ts' --include='*.js' \
              --include='*.sh' --include='*.env' 2>/dev/null; then
              echo "LEAK DETECTED: pattern '$pattern' found!"
              grep -rl "$pattern" . \
                --include='*.md' --include='*.yml' --include='*.yaml' \
                --include='*.json' --include='*.ts' --include='*.js' \
                --include='*.sh' --include='*.env' 2>/dev/null
              LEAKED=1
            fi
          done

          if [[ $LEAKED -eq 1 ]]; then
            echo "::error::Secret leak detected! Aborting sync."
            exit 1
          fi
          echo "✅ No secrets detected in public content."

      - name: Configure Git
        run: |
          git config --global user.name "Sync Bot"
          git config --global user.email "bot@example.com"

      - name: Push to public repo
        env:
          PUBLIC_REPO_PAT: ${{ secrets.PUBLIC_REPO_PAT }}
        run: |
          set -euo pipefail

          PUBLIC_REPO="https://x-access-token:${PUBLIC_REPO_PAT}@github.com/org/project.git"

          # 保存原始 commit 信息
          ORIG_MSG="$(git log -1 --format='%s' 2>/dev/null || echo 'initial sync')"
          ORIG_SHA="$(git log -1 --format='%h' 2>/dev/null || echo 'unknown')"

          # 创建全新 commit（清除所有历史）
          rm -rf .git
          git init -b main
          git add -A
          git commit -m "sync: ${ORIG_SHA} ${ORIG_MSG}"

          # Force push 到公开仓库
          git remote add public "$PUBLIC_REPO"
          git push public main --force

          # 如果是 tag push，同步 tag
          if [[ "$GITHUB_REF" == refs/tags/* ]]; then
            TAG="${GITHUB_REF#refs/tags/}"
            git tag "$TAG"
            git push public "$TAG" --force
          fi

          echo "✅ Synced to public repo"
```

### 阶段 G：配置 PAT

1. 前往 https://github.com/settings/personal-access-tokens/new
2. 选择 **Fine-grained personal access token**
3. Repository access → 选择**公开仓库**（`org/project`）
4. Permissions:
   - **Contents**: Read and Write
   - **Workflows**: Read and Write（如果公开仓库也有 GitHub Actions workflow 文件需要更新）
5. 生成后设置为私有仓库的 secret：

```bash
echo "github_pat_xxxx..." | gh secret set PUBLIC_REPO_PAT --repo org/project-dev
```

> ⚠️ 注意 `echo "TOKEN" | gh secret set NAME` 的语法——不要把 token 当成 secret name。

### 阶段 H：首次同步与验证

```bash
# 提交所有新增文件
git add .public-sync-ignore .github/copilot-instructions.public.md .github/workflows/sync-public.yml LICENSE
git commit -m "feat: add dual-repo sync infrastructure"
git push origin main

# 等待 workflow 运行
gh run watch --repo org/project-dev

# 验证公开仓库内容
gh repo view org/project --web
```

检查项：
- [ ] 私有目录（docs/、skills/、infra/prod/ 等）不在公开仓库中
- [ ] 公开目录（packages/、examples/ 等）正常存在
- [ ] `.github/copilot-instructions.md` 是脱敏版本
- [ ] 没有 `.github/workflows/sync-public.yml`
- [ ] 没有 `.public-sync-ignore`
- [ ] LICENSE 文件存在

---

## 3. CI 适配（重要！）

拆分后公开仓库会独立运行 CI（test、build、lint）。以下是常见需要修复的问题：

### 3.1 测试引用了被排除的文件

**症状**：测试引用了 `docs/`、`infra/` 等被排除目录中的文件（测试向量、fixture 数据等）。

**解决方案**：将测试依赖的数据文件复制到对应 package 的 `test/` 目录下，更新引用路径。

```typescript
// ❌ 引用被排除的 docs/ 目录
const vectorsDir = join(repoRoot, 'docs', 'implementation', 'test-vectors');

// ✅ 移到 package 本地目录
const vectorsDir = join(__dirname, 'vectors');
```

### 3.2 Docker 发布 403

**症状**：`docker/build-push-action` 推送到 GHCR 时返回 403 Forbidden。

**原因**：默认启用的 provenance attestation 需要 `id-token: write` 权限，某些组织策略禁止此权限。

**解决方案**：

```yaml
- uses: docker/build-push-action@v5
  with:
    push: true
    provenance: false   # ← 添加这行
```

### 3.3 Workflow 文件推送失败

**症状**：同步 push 返回 403，错误信息涉及 `refusing to allow a Personal Access Token to create or update workflow`。

**原因**：PAT 缺少 `workflow` scope。当公开仓库 `.github/workflows/` 中的文件发生变更时，push 需要此权限。

**解决方案**：更新 PAT，添加 Workflows: Read and Write 权限。

### 3.4 Caddy/Nginx 路径白名单

**问题**：如果项目有反向代理（Caddy/Nginx）配置 API key 鉴权，某些公开端点（如 faucet）可能被误拦截。

**解决方案**：公开端点需要在鉴权规则前添加路径例外。这虽然不直接是双仓库问题，但通常在开源准备阶段一起暴露出来。

---

## 4. 日常操作

### 新增排除路径

1. 在 `.public-sync-ignore` 中添加记录（信息性）
2. 在 `sync-public.yml` 的 "Prepare public content" step 中添加 `rm` 命令
3. 如果该路径可能包含敏感信息，在 "Verify no secrets leaked" step 添加检测模式
4. commit + push，自动触发同步

### 手动触发同步

```bash
gh workflow run sync-public.yml --repo org/project-dev
```

### 查看同步状态

```bash
gh run list --workflow=sync-public.yml --repo org/project-dev --limit 5
```

### 更换 PAT

PAT 过期时：
1. 生成新 PAT（同 阶段 G 的步骤）
2. 更新 secret：`echo "NEW_PAT" | gh secret set PUBLIC_REPO_PAT --repo org/project-dev`
3. 手动触发一次同步验证

---

## 5. 踩坑记录

以下是 ClawNet 实施过程中遇到的实际问题：

### 坑 1：`.public-sync-ignore` 不是真正的 ignore 文件

最初考虑过让 workflow 解析 `.public-sync-ignore`（类似 `.gitignore`），但 glob 解析在不同 shell 和工具中行为不一致（特别是 `!` 否定语法）。最终选择在 workflow 中用显式 `rm` 命令——虽然冗余，但 100% 可靠可审计。

### 坑 2：PAT 命令格式

```bash
# ❌ 错误：把 token 当成了 secret name
gh secret set github_pat_xxx --repo org/project-dev

# ✅ 正确：token 通过 stdin 传入
echo "github_pat_xxx" | gh secret set PUBLIC_REPO_PAT --repo org/project-dev
```

### 坑 3：先排除再考虑测试依赖

排除 `docs/` 后才发现单元测试的 test vectors JSON 文件在 `docs/implementation/test-vectors/` 里。公开仓库 CI 全部失败。教训：**排除任何目录前，先 `grep -r` 搜索是否有其他地方引用了该目录下的文件**。

```bash
# 排除前先检查
grep -rn "docs/implementation" packages/ scripts/ --include='*.ts' --include='*.js'
```

### 坑 4：Copilot 指令中的凭据

`.github/copilot-instructions.md` 通常包含数据库密码、API key、SSH 地址等（方便 agent 操作）。如果直接同步到公开仓库会泄露所有凭据。必须维护单独的 `.public.md` 版本。

### 坑 5：公开仓库的 CI workflow 也需要同步

公开仓库中的 `ci.yml`、`release.yml` 等来自私有仓库的同步。如果在 workflow 文件中有变更（比如添加 `provenance: false`），PAT 需要 `workflow` 权限才能 push 成功。

### 坑 6：不要忘记 tag 同步

用户 `npm install project@0.6.12` 需要公开仓库有对应的 `v0.6.12` tag。workflow 中需要处理 tag push 事件并同步 tag 到公开仓库。

---

## 6. 文件清单

实施完成后，私有仓库应包含以下新增/修改文件：

| 文件 | 作用 |
|------|------|
| `LICENSE` | 开源许可证（Apache-2.0 / MIT） |
| `.public-sync-ignore` | 排除路径清单（信息性） |
| `.github/copilot-instructions.public.md` | 脱敏版 copilot 指令 |
| `.github/workflows/sync-public.yml` | 同步 workflow |

私有仓库 Settings → Secrets 中应有：

| Secret | 作用 |
|--------|------|
| `PUBLIC_REPO_PAT` | Fine-grained PAT，对公开仓库有 Contents + Workflows 写权限 |

---

## 7. 安全检查清单

- [ ] 公开仓库无 git 历史（单 commit）
- [ ] 所有生产凭据已从代码中移除或已在排除列表中
- [ ] secret scan 中包含所有已知敏感值的唯一片段
- [ ] `.github/copilot-instructions.md` 公开版不含任何凭据/服务器信息
- [ ] `infra/devnet/` 中的私钥均为标准开发账号（公开安全）
- [ ] 如果仓库曾经是 public，所有暴露过的凭据已轮换
- [ ] PAT 权限最小化（仅 Contents + Workflows，仅限公开仓库）
- [ ] 同步 workflow 在 push to main 时自动触发
- [ ] tag 同步正常工作（`v*` 触发器）
