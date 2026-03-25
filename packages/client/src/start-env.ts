import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

export interface PathApi {
  join(...paths: string[]): string;
}

type ExistsFn = (filePath: string) => boolean;
type LoadEnvFileFn = (filePath: string) => void;
type RunCommandFn = (
  file: string,
  args: string[],
  options: {
    encoding: BufferEncoding;
    stdio: ['ignore', 'pipe', 'ignore'];
  },
) => string;

const DEFAULT_STDIO: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore'];

export function resolveStartupTelagentHome(
  homeDir = homedir(),
  shellTelagentHome = process.env.TELAGENT_HOME,
  pathApi: PathApi = path,
): string {
  return shellTelagentHome?.trim() || pathApi.join(homeDir, '.telagent');
}

export function resolveTelagentEnvFile(
  homeDir = homedir(),
  shellTelagentHome = process.env.TELAGENT_HOME,
  pathApi: PathApi = path,
): string {
  return pathApi.join(resolveStartupTelagentHome(homeDir, shellTelagentHome, pathApi), '.env');
}

function normalizeForCompare(candidate: string, pathApi: Pick<PathApi, 'join'> & { normalize(path: string): string }): string {
  return pathApi.normalize(candidate);
}

export function validateLoadedTelagentHome(
  startupHome = resolveStartupTelagentHome(),
  envFile = resolveTelagentEnvFile(),
  effectiveTelagentHome = process.env.TELAGENT_HOME,
  pathApi: Pick<PathApi, 'join'> & { normalize(path: string): string } = path,
): void {
  if (!effectiveTelagentHome?.trim()) {
    return;
  }

  if (normalizeForCompare(effectiveTelagentHome, pathApi) !== normalizeForCompare(startupHome, pathApi)) {
    throw new Error(
      `[telagent] Env file location must follow TELAGENT_HOME. ` +
      `Loaded ${envFile}, but effective TELAGENT_HOME is ${effectiveTelagentHome}. ` +
      `Move the env file to ${pathApi.join(effectiveTelagentHome, '.env')} and ` +
      'set TELAGENT_HOME in the shell or service environment before starting.',
    );
  }
}

export function requireTelagentEnvFile(
  envFile = resolveTelagentEnvFile(),
  exists: ExistsFn = existsSync,
): string {
  if (!exists(envFile)) {
    throw new Error(
      `[telagent] Missing required env file at ${envFile}. ` +
      'Create $TELAGENT_HOME/.env before starting the node.',
    );
  }

  return envFile;
}

export function loadRequiredTelagentEnvFile(
  envFile = resolveTelagentEnvFile(),
  exists: ExistsFn = existsSync,
  loadEnvFile: LoadEnvFileFn = (filePath: string) => {
    process.loadEnvFile(filePath);
  },
  startupHome = resolveStartupTelagentHome(),
): string {
  const requiredEnvFile = requireTelagentEnvFile(envFile, exists);
  loadEnvFile(requiredEnvFile);
  validateLoadedTelagentHome(startupHome, requiredEnvFile);
  return requiredEnvFile;
}

export function resolveBundledMkcertPath(
  telagentHome = resolveStartupTelagentHome(),
  platform = process.platform,
  pathApi: PathApi = path,
): string {
  return pathApi.join(telagentHome, 'bin', platform === 'win32' ? 'mkcert.exe' : 'mkcert');
}

export function resolveDefaultNodeExtraCaCerts(
  telagentHome = resolveStartupTelagentHome(),
  platform = process.platform,
  exists: ExistsFn = existsSync,
  runCommand: RunCommandFn = execFileSync,
  pathApi: PathApi = path,
): string | undefined {
  const bundledMkcert = resolveBundledMkcertPath(telagentHome, platform, pathApi);
  const mkcertBinary = exists(bundledMkcert) ? bundledMkcert : 'mkcert';

  try {
    const caRoot = runCommand(mkcertBinary, ['-CAROOT'], {
      encoding: 'utf8',
      stdio: DEFAULT_STDIO,
    }).trim();
    if (!caRoot) {
      return undefined;
    }

    const caFile = pathApi.join(caRoot, 'rootCA.pem');
    return exists(caFile) ? caFile : undefined;
  } catch {
    return undefined;
  }
}
