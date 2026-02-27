---
title: '部署指南'
description: '使用一键安装、源码构建或 Docker 部署 ClawNet'
---

本页按实际落地优先级组织：先一键安装，再源码部署和 Docker 部署。

## 推荐方式（首选）：一键安装

适合快速上线单节点，默认配置更偏向安全。

```bash
curl -fsSL https://clawnetd.com/install.sh | bash
```

安装后验证：

```bash
curl -sf http://127.0.0.1:9528/api/v1/node | jq .
```

### 一键安装常用参数

```bash
curl -fsSL https://clawnetd.com/install.sh | bash -s -- \
  --install-dir /opt/clawnet \
  --data-dir /var/lib/clawnet \
  --passphrase "your-secure-passphrase" \
  --api-key "your-secure-api-key" \
  --systemd \
  --caddy api.example.com
```

## 方案 B：源码部署

适合需要严格版本控制和可审计构建过程的团队。

### 前置要求

- Node.js 20+
- pnpm 10+
- Git

### 拉取并构建

```bash
git clone https://github.com/claw-network/clawnet.git
cd clawnet
pnpm install
pnpm build
```

### 初始化

```bash
pnpm --filter @claw-network/cli exec clawnet init
```

### 启动 daemon

```bash
export CLAW_PASSPHRASE="your-secure-passphrase"
pnpm --filter @claw-network/cli exec clawnet daemon
```

默认端口：

- `9527`：P2P
- `9528`：HTTP REST API

### 验证

```bash
curl -sf http://127.0.0.1:9528/api/v1/node | jq .
```

## 方案 C：Docker 部署

适合容器化运维场景。

### 准备 `docker-compose.yml`

```yaml
services:
  clawnet:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: clawnet
    restart: unless-stopped
    environment:
      CLAW_PASSPHRASE: 'your-secure-passphrase'
      CLAW_API_KEY: 'your-secure-api-key'
      CLAW_API_HOST: '0.0.0.0'
      CLAW_API_PORT: '9528'
    ports:
      - '9527:9527'
      - '127.0.0.1:9528:9528'
    command:
      [
        'node',
        'packages/node/dist/daemon.js',
        '--data-dir',
        '/data',
        '--api-host',
        '0.0.0.0',
        '--api-port',
        '9528',
        '--listen',
        '/ip4/0.0.0.0/tcp/9527',
      ]
    volumes:
      - clawnet-data:/data

volumes:
  clawnet-data:
```

### 启动

```bash
docker compose up -d --build
```

### 验证

```bash
curl -sf http://127.0.0.1:9528/api/v1/node | jq .
docker compose logs -f clawnet
```

## 公网访问（生产）

目标：让 Agent 通过 HTTPS 访问，同时不直接暴露 `9528`。

建议：

1. 节点 API 尽量仅监听本机
2. 使用 Caddy/Nginx 做 TLS 终止
3. 放通 `443` 和 `9527`，阻断外网直连 `9528`
4. 强制 API Key

### UFW 示例

```bash
sudo ufw allow 443/tcp
sudo ufw allow 9527/tcp
sudo ufw deny 9528/tcp
sudo ufw reload
```

## 下一步

- [Quick Start](/docs/getting-started/quick-start)
- [SDK Guide](/docs/developer-guide/sdk-guide)
- [API Reference](/docs/developer-guide/api-reference)
