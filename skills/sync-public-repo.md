# Skill: Sync Private → Public Repository

## Overview

ClawNet 采用双仓库架构：`clawnet-dev`（私有，日常开发）自动同步到 `clawnet`（公开，开源发布）。同步通过 GitHub Action 自动完成，开发流程无需任何改变。

---

## Architecture

```
┌──────────────────────────┐          ┌──────────────────────────┐
│  claw-network/clawnet-dev│  sync    │  claw-network/clawnet    │
│  (PRIVATE)               │ ──────▶  │  (PUBLIC)                │
│  日常开发仓库            │  GitHub  │  开源仓库                │
│  完整内容 + 历史         │  Action  │  过滤后内容 · 单 commit  │
└──────────────────────────┘          └──────────────────────────┘
```

### Key Facts

| Item | Value |
|------|-------|
| **Private repo** | `claw-network/clawnet-dev` |
| **Public repo** | `claw-network/clawnet` |
| **License** | Apache-2.0 |
| **Sync workflow** | `.github/workflows/sync-public.yml` |
| **Exclusion list** | `.public-sync-ignore`（信息性，工作流使用显式 rm 命令） |
| **Public copilot instructions** | `.github/copilot-instructions.public.md` |
| **Auth** | `PUBLIC_REPO_PAT` secret on clawnet-dev |
| **Trigger** | push to `main`、tag push (`v*`)、手动 `workflow_dispatch` |
| **Public history** | 单 commit（每次 force push 覆盖） |

---

## Excluded from Public Repo

| Path | Reason |
|------|--------|
| `docs/*`（保留 `docs/api/`） | 内部文档，仅公开 API spec |
| `infra/testnet/` | 生产基础设施配置 |
| `infra/mainnet/` | 主网配置 |
| `infra/shared/` | 共享基础设施 |
| `infra/besu/` | 链配置 |
| `infra/README.md` | 含服务器 IP |
| `infra/TOKEN_DISTRIBUTION.md` | Token 分配方案 |
| `infra/ARCHITECTURE_OVERVIEW.md` | 内部架构文档 |
| `skills/` | 部署技能（含服务器信息） |
| `issues/` | 内部 issue 跟踪 |
| `temp/` | 临时文件 |
| `.public-sync-ignore` | 排除列表本身 |
| `.github/copilot-instructions.md` | 含凭据，替换为 `.public.md` 版本 |
| `.github/workflows/sync-public.yml` | 同步工作流本身 |

### Public Repo 保留的内容

- 所有 `packages/` 代码
- `docs/api/`（OpenAPI spec）
- `infra/devnet/`（本地开发链）
- `examples/`、`scripts/`
- `LICENSE`、`README.md`、`CONVENTIONS.md`、`TESTING.md`、`CHANGELOG.md`
- `docker-compose*.yml`、`Dockerfile`
- `pnpm-workspace.yaml`、`tsconfig*.json`、`eslint.config.cjs`

---

## Sync Workflow Steps

1. **Checkout** 代码（depth 1）
2. **Preserve** `docs/api/` 到临时目录
3. **Remove** 所有私有目录和文件（显式 `rm -rf` 命令）
4. **Restore** `docs/api/`
5. **Swap** copilot-instructions：删除私有版，重命名 `.public.md` 为 `.md`
6. **Remove** sync workflow 本身
7. **Secret scan**：检查 10 个已知敏感模式（密码、私钥前缀、API key 等）
8. **Fresh commit**：`rm -rf .git && git init`，创建单 commit
9. **Force push** 到公开仓库（`x-access-token:${PAT}@github.com/...`）
10. **Tag sync**：如果触发事件是 tag push，同步 tag

---

## Common Operations

### 手动触发同步

```bash
gh workflow run sync-public.yml --repo claw-network/clawnet-dev
```

### 查看同步状态

```bash
gh run list --workflow=sync-public.yml --repo claw-network/clawnet-dev --limit 5
```

### 更新 PAT

PAT 过期或需要更换时：

1. 前往 https://github.com/settings/personal-access-tokens/new
2. Fine-grained PAT，仓库选 `claw-network/clawnet`
3. 权限：Contents → Read and Write
4. 生成后设置 secret：

```bash
echo "<NEW_PAT>" | gh secret set PUBLIC_REPO_PAT --repo claw-network/clawnet-dev
```

### 新增排除路径

1. 编辑 `.public-sync-ignore`（信息性记录）
2. 编辑 `.github/workflows/sync-public.yml` 的 "Prepare public content" step，添加对应 `rm` 命令
3. 如路径可能含敏感信息，在 "Verify no secrets leaked" step 添加检测模式
4. commit + push 到 main，自动触发同步

### 新增敏感模式检测

在 `sync-public.yml` 的 secret scan step 中的 `for pattern in` 循环添加新模式（使用唯一前缀片段，避免误报）。

---

## Troubleshooting

### Sync workflow 失败

```bash
# 查看最近失败的 run
gh run list --workflow=sync-public.yml --repo claw-network/clawnet-dev --status failure --limit 3

# 查看具体日志
gh run view <RUN_ID> --repo claw-network/clawnet-dev --log-failed
```

### Secret leak detected

工作流检测到敏感模式时会中止。排查步骤：

1. 查看日志确认哪个 pattern 在哪个文件匹配
2. 在源文件中移除或替换敏感内容
3. 或将该文件加入排除列表
4. 重新 push 触发同步

### PAT 权限不足

错误表现为 `push` 步骤 403/404。确认：
- PAT 仍有效（未过期）
- PAT 的 Repository access 包含 `claw-network/clawnet`
- PAT 有 Contents: Read and Write 权限

---

## Security Notes

- 公开仓库 **无** git 历史（每次 force push 单 commit），即使私有仓库历史中有敏感信息也不会泄露
- `.github/copilot-instructions.md` 自动替换为不含服务器 IP、凭据、部署流程的版本
- 每次同步运行 secret scan，检测已知敏感模式
- `infra/testnet/prod/secrets.env` 已从 git 跟踪中移除（`git rm --cached`）
- 所有 `infra/devnet/` 中的私钥为 Hardhat 标准开发账号，公开安全
