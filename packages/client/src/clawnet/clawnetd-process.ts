import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const logger = console;

async function getListeningPids(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-n',
      '-P',
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
      '-t',
    ]);
    return stdout
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value));
  } catch {
    return [];
  }
}

async function getCommandLine(pid: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']);
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Kill a process listening on `port` whose command line contains `needle`.
 * Skips the current process. Returns true if at least one process was killed.
 */
export async function killProcessOnPort(
  port: number,
  needle: string,
): Promise<boolean> {
  const pids = await getListeningPids(port);
  if (!pids.length) {
    return false;
  }

  let killed = false;
  for (const pid of pids) {
    if (pid === process.pid) {
      continue;
    }
    const command = (await getCommandLine(pid)).toLowerCase();
    if (!command.includes(needle.toLowerCase())) {
      continue;
    }
    try {
      process.kill(pid, 'SIGTERM');
      killed = true;
      logger.warn('[telagent] Stopped %s (pid=%d) on port %d', needle, pid, port);
    } catch (error) {
      logger.warn('[telagent] Failed to stop %s (pid=%d): %s', needle, pid, (error as Error).message);
    }
  }

  return killed;
}

export async function killClawnetdOnPort(port: number): Promise<boolean> {
  return killProcessOnPort(port, 'clawnetd');
}

/**
 * Kill any stale telagent/node process listening on the given port.
 * Useful to reclaim the API port after a crash or unclean shutdown.
 */
export async function killStaleTelagentOnPort(port: number): Promise<boolean> {
  const pids = await getListeningPids(port);
  if (!pids.length) {
    return false;
  }

  let killed = false;
  for (const pid of pids) {
    if (pid === process.pid) {
      continue;
    }
    try {
      process.kill(pid, 'SIGTERM');
      killed = true;
      logger.warn('[telagent] Killed stale process (pid=%d) on port %d', pid, port);
    } catch (error) {
      logger.warn('[telagent] Failed to kill stale process (pid=%d): %s', pid, (error as Error).message);
    }
  }

  if (killed) {
    // Give the old process a moment to release the port
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return killed;
}
