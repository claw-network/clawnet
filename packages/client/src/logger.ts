import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { format } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  level?: LogLevel;
  logDir?: string;
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  close: () => void;
}

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let _globalLogger: Logger | undefined;

/**
 * Returns a stable proxy object that always delegates to the current
 * global logger.  This means callers who capture the return value at
 * module-load time will automatically pick up a later setGlobalLogger()
 * call — solving the "import ordering" problem.
 */
const _loggerProxy: Logger = {
  debug: (...args: unknown[]) => _resolvedLogger().debug(...args),
  info:  (...args: unknown[]) => _resolvedLogger().info(...args),
  warn:  (...args: unknown[]) => _resolvedLogger().warn(...args),
  error: (...args: unknown[]) => _resolvedLogger().error(...args),
  close: () => _resolvedLogger().close(),
};

function _resolvedLogger(): Logger {
  if (!_globalLogger) {
    _globalLogger = createLogger('info');
  }
  return _globalLogger;
}

export function getGlobalLogger(): Logger {
  return _loggerProxy;
}

export function setGlobalLogger(logger: Logger): void {
  _globalLogger = logger;
}

export function createLogger(levelOrOptions: LogLevel | LoggerOptions = 'info'): Logger {
  const opts = typeof levelOrOptions === 'string' ? { level: levelOrOptions } : levelOrOptions;
  const level = opts.level ?? 'info';
  const current = priorities[level];
  const shouldLog = (target: LogLevel): boolean => priorities[target] >= current;

  let fileStream: WriteStream | undefined;
  if (opts.logDir) {
    mkdirSync(opts.logDir, { recursive: true });
    const logFile = resolve(opts.logDir, 'telagent.log');
    fileStream = createWriteStream(logFile, { flags: 'a' });
  }

  function writeToFile(logLevel: string, args: unknown[]): void {
    if (!fileStream) return;
    const ts = new Date().toISOString();
    const msg = format(...args);
    fileStream.write(`${ts} [${logLevel}] ${msg}\n`);
  }

  const logger: Logger = {
    debug: (...args: unknown[]) => {
      if (shouldLog('debug')) {
        const msg = format(...args);
        console.debug('[debug]', msg);
        writeToFile('debug', args);
      }
    },
    info: (...args: unknown[]) => {
      if (shouldLog('info')) {
        const msg = format(...args);
        console.info('[info]', msg);
        writeToFile('info', args);
      }
    },
    warn: (...args: unknown[]) => {
      if (shouldLog('warn')) {
        const msg = format(...args);
        console.warn('[warn]', msg);
        writeToFile('warn', args);
      }
    },
    error: (...args: unknown[]) => {
      if (shouldLog('error')) {
        const msg = format(...args);
        console.error('[error]', msg);
        writeToFile('error', args);
      }
    },
    close: () => {
      fileStream?.end();
      fileStream = undefined;
    },
  };

  return logger;
}
