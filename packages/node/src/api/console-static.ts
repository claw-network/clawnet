/**
 * Static file middleware for the embedded Console SPA.
 *
 * Serves files from `packages/console/dist/` at `/console/*`.
 * Falls back to `index.html` for SPA client-side routing.
 * Sets appropriate Cache-Control headers.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// Hashed asset filename pattern (Vite output: name-XXXXXXXX.ext)
const HASHED_ASSET_RE = /\.[a-f0-9]{8}\.\w+$/;

/**
 * Resolve the console dist directory. Tries:
 * 1. CONSOLE_DIST_PATH env var
 * 2. Relative from node package: ../../console/dist
 * 3. Relative from cwd: packages/console/dist
 */
function resolveDistDir(): string | null {
  const candidates = [
    process.env.CONSOLE_DIST_PATH,
    resolve(__dirname, '..', '..', '..', 'console', 'dist'),
    resolve(process.cwd(), 'packages', 'console', 'dist'),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) {
      return dir;
    }
  }
  return null;
}

export function createConsoleStatic(): {
  middleware: (req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => Promise<void>;
  available: boolean;
} {
  const distDir = resolveDistDir();

  if (!distDir) {
    return {
      available: false,
      middleware: async (_req, _res, next) => { await next(); },
    };
  }

  const indexPath = join(distDir, 'index.html');

  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => Promise<void>): Promise<void> => {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      await next();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    // Only handle /console and /console/*
    if (pathname !== '/console' && !pathname.startsWith('/console/')) {
      await next();
      return;
    }

    // Redirect /console to /console/ for consistent base path
    if (pathname === '/console') {
      res.writeHead(302, { Location: '/console/' });
      res.end();
      return;
    }

    // Strip the /console/ prefix to get the relative file path
    const relativePath = pathname.slice('/console/'.length);

    // Security: prevent path traversal
    const safePath = relativePath.replace(/\.\./g, '').replace(/\/\//g, '/');
    const filePath = join(distDir, safePath);

    // Ensure the resolved path is within distDir
    const resolved = resolve(filePath);
    if (!resolved.startsWith(resolve(distDir))) {
      await next();
      return;
    }

    // Try to serve the file
    if (safePath && existsSync(resolved) && statSync(resolved).isFile()) {
      serveFile(res, resolved);
      return;
    }

    // SPA fallback: serve index.html for unmatched paths
    serveFile(res, indexPath, true);
  };

  return { middleware, available: true };
}

function serveFile(res: ServerResponse, filePath: string, isIndex = false): void {
  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

  // Hashed assets (immutable), index.html (no-cache)
  const cacheControl = isIndex || ext === '.html'
    ? 'no-cache, no-store, must-revalidate'
    : HASHED_ASSET_RE.test(filePath)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600';

  const stat = statSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
  });
  createReadStream(filePath).pipe(res);
}
