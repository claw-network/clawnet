import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function resolveClawnetHome(): string {
  return process.env.CLAWNET_HOME ?? resolve(homedir(), '.clawnet');
}

export function resolveClawnetEnvFile(clawnetHome: string = resolveClawnetHome()): string {
  return resolve(clawnetHome, '.env');
}

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return value;
}

function parseEnvContent(content: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = normalized.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }

    const rawValue = normalized.slice(eqIndex + 1);
    entries.set(key, parseEnvValue(rawValue));
  }

  return entries;
}

function envFileMissingMessage(envFile: string): string {
  return [
    `Required ClawNet env file not found: ${envFile}`,
    'Project-local .env files are no longer supported.',
    `Move your configuration to ${envFile}.`,
  ].join('\n');
}

export async function loadRequiredClawnetEnv(): Promise<{ clawnetHome: string; envFile: string }> {
  const clawnetHome = resolveClawnetHome();
  const envFile = resolveClawnetEnvFile(clawnetHome);

  let raw: string;
  try {
    raw = await readFile(envFile, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      throw new Error(envFileMissingMessage(envFile));
    }
    throw error;
  }

  process.env.CLAWNET_HOME ??= clawnetHome;
  process.env.CLAWNET_ENV_FILE ??= envFile;

  for (const [key, value] of parseEnvContent(raw)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return { clawnetHome, envFile };
}
