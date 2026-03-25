import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { getGlobalLogger } from '../logger.js';

export interface ClawNetDiscoveryResult {
  found: boolean;
  nodeUrl?: string;
  source:
    | 'explicit-config'
    | 'clawnet-config-yaml'
    | 'default-probe'
    | 'auto-started'
    | 'auto-initialized';
  clawnetHome?: string;
  managedNode?: any;  // ClawNetNode instance or null
  /** API key auto-provisioned for the managed node (v0.6.13+). */
  apiKey?: string;
}

const logger = getGlobalLogger();

/**
 * ClawNet Node 发现 + 自动启动
 *
 * 优先级（RFC §5.1）：
 * 1. 显式 URL（TELAGENT_CLAWNET_NODE_URL）
 * 2. 读取 $CLAWNET_HOME/config.yaml
 * 3. 默认探测 http://127.0.0.1:9528
 * 4. 自动启动嵌入式 ClawNet Node
 * 5. 全新初始化 + 启动
 */
export async function discoverOrStartClawNet(
  explicitUrl?: string,
  passphrase?: string,
  options?: { autoStart?: boolean; autoDiscover?: boolean; killClawnetdOnStart?: boolean },
): Promise<ClawNetDiscoveryResult> {
  const clawnetHome = process.env.CLAWNET_HOME ?? resolve(homedir(), '.clawnet');
  const autoStart = options?.autoStart ?? true;

  // ── 1. 显式配置 ─────────────────────────────────────
  if (explicitUrl) {
    logger.info('[telagent] ClawNet discovery: using explicit URL %s', explicitUrl);
    return { found: true, nodeUrl: explicitUrl, source: 'explicit-config' };
  }

  // ── 2. 读取本地 ClawNet config.yaml ─────────────────
  const configPath = resolve(clawnetHome, 'config.yaml');
  try {
    const raw = readFileSync(configPath, 'utf8');
    // 简易 YAML 解析（提取 api.host 和 api.port）
    // 生产环境应使用 yaml 库
    const hostMatch = raw.match(/host:\s*['"]?([^'"\n]+)/);
    const portMatch = raw.match(/port:\s*(\d+)/);
    const host = hostMatch?.[1]?.trim() ?? '127.0.0.1';
    const port = portMatch?.[1] ?? '9528';
    const url = `http://${host}:${port}`;

    if (await probeNodeHealth(url)) {
      logger.info('[telagent] ClawNet discovery: found via %s', configPath);
      return { found: true, nodeUrl: url, source: 'clawnet-config-yaml', clawnetHome };
    }
  } catch {
    // config.yaml 不存在或不完整，继续
  }

  // ── 3. 默认地址探测 ─────────────────────────────────
  const defaultUrl = 'http://127.0.0.1:9528';
  if (await probeNodeHealth(defaultUrl)) {
    logger.info('[telagent] ClawNet discovery: found via default probe %s', defaultUrl);
    return { found: true, nodeUrl: defaultUrl, source: 'default-probe' };
  }

  // ── 4 & 5. 自动启动 ────────────────────────────────
  if (!autoStart) {
    throw new Error(
      '[telagent] FATAL: ClawNet Node not found and TELAGENT_CLAWNET_AUTO_START=false. ' +
      'Start a ClawNet Node manually or set TELAGENT_CLAWNET_NODE_URL.',
    );
  }

  if (!passphrase) {
    throw new Error(
      '[telagent] FATAL: ClawNet Node not found and no passphrase configured. ' +
      'Set TELAGENT_CLAWNET_PASSPHRASE or start a ClawNet Node manually.',
    );
  }

  const keysDir = resolve(clawnetHome, 'keys');
  const alreadyInitialized = existsSync(keysDir);

  if (!alreadyInitialized) {
    // ── 5. 全新初始化 ─────────────────────────────────
    logger.info('[telagent] No ClawNet installation found — initializing at %s', clawnetHome);
    // 调用 ManagedClawNetNode.initAndStart()
  }

  // 启动嵌入式 ClawNet Node
  const { ManagedClawNetNode } = await import('./managed-node.js');
  const managedNode = new ManagedClawNetNode(clawnetHome, passphrase, undefined, {
    killClawnetdOnStart: options?.killClawnetdOnStart,
  });

  if (alreadyInitialized) {
    await managedNode.start();
  } else {
    await managedNode.initAndStart();
  }

  const did = managedNode.getDid();
  logger.info('[telagent] Embedded ClawNet Node started — DID: %s', did);

  // v0.6.14+: zero-key nodes reject all requests. Create an API key
  // via the public ClawNetNode.createApiKey() method.
  const apiPort = managedNode.getApiPort();
  const nodeUrl = `http://127.0.0.1:${apiPort}`;
  const apiKey = managedNode.createApiKey('telagent-auto');
  if (apiKey) {
    logger.info('[telagent] Auto-provisioned ClawNet API key for embedded node');
  } else {
    logger.warn('[telagent] Could not provision ClawNet API key — SDK calls may fail with 401');
  }

  return {
    found: true,
    nodeUrl,
    source: alreadyInitialized ? 'auto-started' : 'auto-initialized',
    clawnetHome,
    managedNode,
    apiKey,
  };
}

/**
 * 检测 ClawNet Node 健康状态
 * 超时 3 秒
 *
 * @claw-network/node >= 0.6.13: zero-key nodes return 401 on all networks,
 * so a 401 response still indicates the node is alive and reachable.
 */
export async function probeNodeHealth(url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${url}/api/v1/node`, {
      signal: AbortSignal.timeout(3000),
    });
    // 401 means the node is running but requires auth (v0.6.13+)
    if (resp.status === 401) return true;
    if (!resp.ok) return false;
    const body = await resp.json() as { data?: { did?: string } };
    return typeof body?.data?.did === 'string';
  } catch {
    return false;
  }
}
