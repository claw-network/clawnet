import { accessSync, existsSync, constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { ChainConfigSchema, type ChainConfig } from './services/chain-config.js';
import {
  parseOwnerMode,
  parseOwnerScopes,
  parsePrivateConversations,
} from './services/owner-permission-service.js';
import { resolveTelagentPaths, type TelagentStoragePaths } from './storage/telagent-paths.js';

export interface MonitoringConfig {
  errorRateWarnRatio: number;
  errorRateCriticalRatio: number;
  requestP95WarnMs: number;
  requestP95CriticalMs: number;
  maintenanceStaleWarnSec: number;
  maintenanceStaleCriticalSec: number;
}

export type MailboxStoreBackend = 'sqlite' | 'postgres';

export interface MailboxStoreConfig {
  backend: MailboxStoreBackend;
  sqlitePath: string;
  postgres?: {
    connectionString: string;
    schema: string;
    ssl: boolean;
    maxConnections: number;
  };
}

export interface ClawNetConfig {
  nodeUrl?: string;
  passphrase?: string;
  apiKey?: string;
  timeoutMs: number;
  autoDiscover: boolean;
  autoStart: boolean;
  killClawnetdOnStart: boolean;
  killClawnetdOnStop: boolean;
}

export interface OwnerConfig {
  mode: 'observer' | 'intervener';
  scopes: Array<
    | 'send_message'
    | 'manage_contacts'
    | 'manage_groups'
    | 'clawnet_transfer'
    | 'clawnet_escrow'
    | 'clawnet_market'
    | 'clawnet_reputation'
  >;
  privateConversations: string[];
}

export interface TlsConfig {
  certPath: string;
  keyPath: string;
  httpsPort: number;
}

export interface ApiProxyConfig {
  enabled: boolean;
  gatewayEnabled: boolean;
  timeoutMs: number;
  rateLimitPerMinute: number;
  maxBodyBytes: number;
}

export interface AppConfig {
  host: string;
  port: number;
  publicUrl?: string;
  tls?: TlsConfig;
  paths: TelagentStoragePaths;
  mailboxCleanupIntervalSec: number;
  mailboxStore: MailboxStoreConfig;
  chain: ChainConfig;
  clawnet: ClawNetConfig;
  owner: OwnerConfig;
  monitoring: MonitoringConfig;
  apiProxy: ApiProxyConfig;
}

export function loadConfigFromEnv(): AppConfig {
  // ── 破坏性变更检测 ────────────────────────────────────
  if (process.env.TELAGENT_DATA_DIR) {
    throw new Error(
      'TELAGENT_DATA_DIR is removed. Use TELAGENT_HOME instead. ' +
      'Default: ~/.telagent. See migration guide.',
    );
  }
  if (process.env.TELAGENT_SELF_DID) {
    throw new Error(
      'TELAGENT_SELF_DID is removed. DID is now obtained from ClawNet Node automatically. ' +
      'Remove this env var and ensure ClawNet Node is running.',
    );
  }
  if (process.env.TELAGENT_IDENTITY_CONTRACT) {
    throw new Error(
      'TELAGENT_IDENTITY_CONTRACT is removed. Identity is now resolved via ClawNet SDK. ' +
      'Remove this env var.',
    );
  }
  if (process.env.TELAGENT_TOKEN_CONTRACT) {
    throw new Error(
      'TELAGENT_TOKEN_CONTRACT is removed. Token balance is now queried via ClawNet SDK. ' +
      'Remove this env var.',
    );
  }

  const paths = resolveTelagentPaths();

  const host = process.env.TELAGENT_API_HOST || '127.0.0.1';
  const port = Number(process.env.TELAGENT_API_PORT || 9529);

  // ── TLS (optional) ──────────────────────────────────────
  let tls: TlsConfig | undefined;
  const tlsCert = process.env.TELAGENT_TLS_CERT?.trim();
  const tlsKey = process.env.TELAGENT_TLS_KEY?.trim();
  if (tlsCert && tlsKey) {
    for (const p of [tlsCert, tlsKey]) {
      try {
        accessSync(p, fsConstants.R_OK);
      } catch {
        throw new Error(`TLS file not readable: ${p}`);
      }
    }
    tls = {
      certPath: tlsCert,
      keyPath: tlsKey,
      httpsPort: Number(process.env.TELAGENT_TLS_PORT || 9443),
    };
  } else if (tlsCert || tlsKey) {
    throw new Error('Both TELAGENT_TLS_CERT and TELAGENT_TLS_KEY must be set to enable TLS');
  } else {
    // Auto-detect mkcert certs at ~/.telagent/tls/
    const autoDir = join(process.env.TELAGENT_HOME || join(homedir(), '.telagent'), 'tls');
    const autoCert = join(autoDir, 'cert.pem');
    const autoKey = join(autoDir, 'key.pem');
    if (existsSync(autoCert) && existsSync(autoKey)) {
      tls = {
        certPath: autoCert,
        keyPath: autoKey,
        httpsPort: Number(process.env.TELAGENT_TLS_PORT || 9443),
      };
    }
  }

  const chain = ChainConfigSchema.parse({
    rpcUrl: process.env.TELAGENT_CHAIN_RPC_URL,
    chainId: Number(process.env.TELAGENT_CHAIN_ID || 7625),
    contracts: {
      telagentGroupRegistry: process.env.TELAGENT_GROUP_REGISTRY_CONTRACT,
    },
    signer: {
      type: process.env.TELAGENT_SIGNER_TYPE || 'env',
      envVar: process.env.TELAGENT_SIGNER_ENV || 'TELAGENT_PRIVATE_KEY',
      path: process.env.TELAGENT_SIGNER_PATH,
      index: Number(process.env.TELAGENT_SIGNER_INDEX || 0),
    },
    finalityDepth: Number(process.env.TELAGENT_FINALITY_DEPTH || 12),
  });

  const clawnet: ClawNetConfig = {
    nodeUrl: process.env.TELAGENT_CLAWNET_NODE_URL || undefined,
    apiKey: process.env.TELAGENT_CLAWNET_API_KEY || undefined,
    timeoutMs: Number(process.env.TELAGENT_CLAWNET_TIMEOUT_MS || 30_000),
    autoDiscover: parseBoolean(process.env.TELAGENT_CLAWNET_AUTO_DISCOVER, true),
    autoStart: parseBoolean(process.env.TELAGENT_CLAWNET_AUTO_START, true),
    killClawnetdOnStart: parseBoolean(process.env.TELAGENT_CLAWNET_KILL_ON_START, false),
    killClawnetdOnStop: parseBoolean(process.env.TELAGENT_CLAWNET_KILL_ON_STOP, false),
  };

  const owner: OwnerConfig = {
    mode: parseOwnerMode(process.env.TELAGENT_OWNER_MODE),
    scopes: parseOwnerScopes(process.env.TELAGENT_OWNER_SCOPES),
    privateConversations: parsePrivateConversations(process.env.TELAGENT_OWNER_PRIVATE_CONVERSATIONS),
  };

  const mailboxStoreBackend = (
    process.env.TELAGENT_MAILBOX_STORE_BACKEND?.trim().toLowerCase() || 'sqlite'
  ) as MailboxStoreBackend;
  if (mailboxStoreBackend !== 'sqlite' && mailboxStoreBackend !== 'postgres') {
    throw new Error('TELAGENT_MAILBOX_STORE_BACKEND must be sqlite or postgres');
  }

  const mailboxStore: MailboxStoreConfig = {
    backend: mailboxStoreBackend,
    sqlitePath: process.env.TELAGENT_MAILBOX_SQLITE_PATH || paths.mailboxDb,
  };

  if (mailboxStoreBackend === 'postgres') {
    const connectionString = process.env.TELAGENT_MAILBOX_PG_URL;
    if (!connectionString || !connectionString.trim()) {
      throw new Error('TELAGENT_MAILBOX_PG_URL is required when TELAGENT_MAILBOX_STORE_BACKEND=postgres');
    }

    mailboxStore.postgres = {
      connectionString: connectionString.trim(),
      schema: process.env.TELAGENT_MAILBOX_PG_SCHEMA || 'public',
      ssl: parseBoolean(process.env.TELAGENT_MAILBOX_PG_SSL, false),
      maxConnections: Number(process.env.TELAGENT_MAILBOX_PG_MAX_CONN || 10),
    };
  }

  const publicUrl = process.env.TELAGENT_PUBLIC_URL?.trim() || undefined;

  const apiProxy: ApiProxyConfig = {
    enabled: parseBoolean(process.env.TELAGENT_API_PROXY_ENABLED, true),
    gatewayEnabled: parseBoolean(process.env.TELAGENT_API_PROXY_GATEWAY_ENABLED, true),
    timeoutMs: Number(process.env.TELAGENT_API_PROXY_TIMEOUT_MS || 30_000),
    rateLimitPerMinute: Number(process.env.TELAGENT_API_PROXY_RATE_LIMIT || 60),
    maxBodyBytes: Number(process.env.TELAGENT_API_PROXY_MAX_BODY_BYTES || 1_048_576),
  };

  return {
    host,
    port,
    publicUrl,
    tls,
    paths,
    mailboxCleanupIntervalSec: Number(process.env.TELAGENT_MAILBOX_CLEANUP_INTERVAL_SEC || 60),
    mailboxStore,
    chain,
    clawnet,
    owner,
    monitoring: {
      errorRateWarnRatio: Number(process.env.TELAGENT_MONITOR_ERROR_RATE_WARN_RATIO || 0.02),
      errorRateCriticalRatio: Number(process.env.TELAGENT_MONITOR_ERROR_RATE_CRITICAL_RATIO || 0.05),
      requestP95WarnMs: Number(process.env.TELAGENT_MONITOR_REQ_P95_WARN_MS || 250),
      requestP95CriticalMs: Number(process.env.TELAGENT_MONITOR_REQ_P95_CRITICAL_MS || 500),
      maintenanceStaleWarnSec: Number(process.env.TELAGENT_MONITOR_MAINT_STALE_WARN_SEC || 180),
      maintenanceStaleCriticalSec: Number(process.env.TELAGENT_MONITOR_MAINT_STALE_CRITICAL_SEC || 300),
    },
    apiProxy,
  };
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  throw new Error(`invalid boolean value: ${raw}`);
}

function parsePositiveInteger(raw: string | undefined, fallback: number, fieldName: string): number {
  if (typeof raw === 'undefined' || !raw.trim()) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return value;
}


