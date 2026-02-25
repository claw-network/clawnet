#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      continue;
    }
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const stripped = token.slice(2);
    if (!stripped) {
      throw new Error('Invalid empty argument name');
    }
    const eq = stripped.indexOf('=');
    if (eq >= 0) {
      const key = stripped.slice(0, eq);
      const value = stripped.slice(eq + 1);
      args[key] = value;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[stripped] = next;
      i += 1;
    } else {
      args[stripped] = true;
    }
  }
  return args;
}

export function printScriptHelp(scriptName, extra = '') {
  const lines = [
    `Usage: node scripts/liquidity-bot/${scriptName} --config scripts/liquidity-bot/config.local.json`,
    'Common flags:',
    '  --config <path>   Path to bot config JSON.',
    '  --help            Show this help.',
  ];
  if (extra) {
    lines.push(extra);
  }
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

export function toInt(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function requiredString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required string field: ${fieldName}`);
  }
  return value.trim();
}

function normalizeBaseUrl(urlRaw) {
  let base = requiredString(urlRaw, 'baseUrl');
  if (base.endsWith('/')) {
    base = base.slice(0, -1);
  }
  return base;
}

function isAutoDid(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'auto' || normalized === 'self' || normalized === 'auto:self';
}

async function resolveAutoAccountDids(config, accountNames) {
  const names = [...new Set((accountNames ?? []).map((name) => String(name)))];
  if (!names.length) return;

  let needsResolve = false;
  for (const name of names) {
    const account = config?.accounts?.[name];
    if (account && typeof account === 'object' && isAutoDid(account.did)) {
      needsResolve = true;
      break;
    }
  }
  if (!needsResolve) return;

  const status = await apiRequest(config, 'GET', '/api/v1/node');
  const nodeDid = typeof status?.did === 'string' ? status.did.trim() : '';
  if (!nodeDid || !nodeDid.startsWith('did:claw:')) {
    throw new Error(
      'Failed to resolve node DID from GET /api/v1/node. Fill accounts.*.did explicitly.',
    );
  }

  for (const name of names) {
    const account = config?.accounts?.[name];
    if (account && typeof account === 'object' && isAutoDid(account.did)) {
      account.did = nodeDid;
    }
  }
}

function requireAccount(config, name) {
  const account = config?.accounts?.[name];
  if (!account || typeof account !== 'object') {
    throw new Error(`Missing account config: accounts.${name}`);
  }
  requiredString(account.did, `accounts.${name}.did`);
  requiredString(account.passphrase, `accounts.${name}.passphrase`);
}

export async function loadConfig(configPathArg, options = {}) {
  const configPath = path.resolve(
    process.cwd(),
    configPathArg ?? path.join(THIS_DIR, 'config.local.json'),
  );

  let file;
  try {
    file = await fs.readFile(configPath, 'utf8');
  } catch {
    throw new Error(
      `Config not found: ${configPath}\nCopy scripts/liquidity-bot/templates/config.example.json to this path and fill secrets.`,
    );
  }

  let config;
  try {
    config = JSON.parse(file);
  } catch (error) {
    throw new Error(`Invalid JSON in ${configPath}: ${error.message}`);
  }

  config.baseUrl = normalizeBaseUrl(config.baseUrl);
  config.apiKey = requiredString(config.apiKey, 'apiKey');
  config.stateFile = path.resolve(
    process.cwd(),
    config.stateFile ?? path.join(THIS_DIR, 'state.local.json'),
  );

  const requiredAccounts = Array.isArray(options.requiredAccounts)
    ? options.requiredAccounts
    : ['liquidityVault', 'maker', 'taker'];
  for (const name of requiredAccounts) {
    requireAccount(config, String(name));
  }

  const configuredAccounts = Object.keys(config.accounts ?? {});
  await resolveAutoAccountDids(config, [...requiredAccounts, ...configuredAccounts]);

  config.funding = {
    targetMakerBalance: toInt(config.funding?.targetMakerBalance, 300),
    targetTakerBalance: toInt(config.funding?.targetTakerBalance, 300),
    maxTransferPerRun: toInt(config.funding?.maxTransferPerRun, 1_500),
    reconcileMinKeep: toInt(config.funding?.reconcileMinKeep, 50),
  };

  config.market = {
    listingCount: toInt(config.market?.listingCount, 2),
    basePrice: toInt(config.market?.basePrice, 10),
    priceStep: toInt(config.market?.priceStep, 2),
    category: config.market?.category ?? 'liquidity-bootstrap',
    infoType: config.market?.infoType ?? 'dataset',
  };

  config.trade = {
    cycles: toInt(config.trade?.cycles, 3),
    quantity: toInt(config.trade?.quantity, 1),
    waitMs: toInt(config.trade?.waitMs, 0),
  };

  return config;
}

export async function loadState(stateFile) {
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      nonces: parsed.nonces && typeof parsed.nonces === 'object' ? parsed.nonces : {},
      listings: Array.isArray(parsed.listings) ? parsed.listings : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      lastHealth: parsed.lastHealth ?? null,
    };
  } catch {
    return {
      version: 1,
      nonces: {},
      listings: [],
      orders: [],
      runs: [],
      lastHealth: null,
    };
  }
}

export async function saveState(stateFile, state) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function nextNonce(state, did) {
  if (!state.nonces || typeof state.nonces !== 'object') {
    state.nonces = {};
  }
  const nowSeed = Math.floor(Date.now() / 1000);
  const current = toInt(state.nonces[did], nowSeed);
  const next = Math.max(current + 1, nowSeed);
  state.nonces[did] = next;
  return next;
}

function unwrapResponse(payload) {
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data;
  }
  return payload;
}

function extractErrorDetail(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback;
  if (typeof payload.detail === 'string' && payload.detail) return payload.detail;
  if (payload.error && typeof payload.error === 'object' && typeof payload.error.message === 'string') {
    return payload.error.message;
  }
  return fallback;
}

export async function apiRequest(config, method, routePath, body) {
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const url = `${config.baseUrl}${normalizedPath}`;
  const headers = {
    Accept: 'application/json',
    'X-API-Key': config.apiKey,
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const fallback = text || response.statusText || 'Request failed';
    const detail = extractErrorDetail(payload, fallback);
    throw new Error(`${method} ${normalizedPath} failed [${response.status}]: ${detail}`);
  }

  return unwrapResponse(payload);
}

export function balanceOf(walletData) {
  if (!walletData || typeof walletData !== 'object') return 0;
  const value = walletData.balance;
  return toInt(value, 0);
}

export function logStep(title) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`);
}

export function nowIso() {
  return new Date().toISOString();
}

export async function sleep(ms) {
  if (!ms || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createRuntime(args, options = {}) {
  const config = await loadConfig(args.config, options);
  const state = await loadState(config.stateFile);
  return {
    config,
    state,
    api: (method, routePath, body) => apiRequest(config, method, routePath, body),
    nextNonceFor: (did) => nextNonce(state, did),
    save: () => saveState(config.stateFile, state),
  };
}
