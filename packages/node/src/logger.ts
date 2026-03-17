import { appendFile } from 'node:fs/promises';
import { format } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  level?: LogLevel;
  file?: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options: LoggerOptions = {}) {
  const minLevel: LogLevel = options.level ?? 'info';
  const minValue = LEVEL_ORDER[minLevel] ?? LEVEL_ORDER.info;
  const filePath = options.file;

  const log = (level: LogLevel, ...args: unknown[]): void => {
    if (LEVEL_ORDER[level] < minValue) {
      return;
    }
    const timestamp = new Date().toISOString();
    const message = format(...args);
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
    if (filePath) {
      void appendFile(filePath, `${line}\n`, 'utf8');
    }
  };

  return {
    debug: (...args: unknown[]) => log('debug', ...args),
    info: (...args: unknown[]) => log('info', ...args),
    warn: (...args: unknown[]) => log('warn', ...args),
    error: (...args: unknown[]) => log('error', ...args),
  };
}
