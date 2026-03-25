import {
  CompleteAttachmentSchema,
  ErrorCodes,
  InitAttachmentSchema,
  TelagentError,
} from '../../protocol/index.js';

import { Router } from '../router.js';
import { created, ok } from '../response.js';
import { handleError } from '../route-utils.js';
import { getGlobalLogger } from '../../logger.js';
import type { ApiServerConfig, RuntimeContext } from '../types.js';
import { validate } from '../validate.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '']);

function nodeBaseUrl(config: ApiServerConfig): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, '');
  if (LOOPBACK_HOSTS.has(config.host)) {
    getGlobalLogger().warn(
      '[attachments] Node is bound to a loopback address (%s) and TELAGENT_PUBLIC_URL is not set. ' +
      'Attachment download URLs will use this loopback address and will NOT be reachable by ' +
      'other nodes. Set TELAGENT_PUBLIC_URL to the publicly-reachable URL of this node to fix this.',
      config.host,
    );
  }
  return `http://${config.host}:${config.port}`;
}

export function attachmentRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  router.post('/init-upload', ({ res, body, url }) => {
    const parsed = validate(InitAttachmentSchema, body);
    if (!parsed.success) {
      handleError(res, new TelagentError(ErrorCodes.VALIDATION, parsed.error), url.pathname);
      return;
    }

    try {
      const result = ctx.attachmentService.initUpload(parsed.data);
      const uploadUrl = `${nodeBaseUrl(ctx.config)}/api/v1/attachments/${encodeURIComponent(result.objectKey)}`;
      created(res, { ...result, uploadUrl }, { self: `/api/v1/attachments/${encodeURIComponent(result.objectKey)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/complete-upload', async ({ res, body, url }) => {
    const parsed = validate(CompleteAttachmentSchema, body);
    if (!parsed.success) {
      handleError(res, new TelagentError(ErrorCodes.VALIDATION, parsed.error), url.pathname);
      return;
    }

    try {
      const result = ctx.attachmentService.completeUpload({
        objectKey: parsed.data.objectKey,
        manifestHash: parsed.data.manifestHash,
        checksum: parsed.data.checksum,
        fileContentType: parsed.data.fileContentType,
      });

      // Relay to target peer via ClawNet P2P so they can serve it from their local node.
      if (parsed.data.targetDid) {
        const fileBuffer = await ctx.attachmentService.readFile(result.objectKey);
        if (fileBuffer) {
          // ClawNet uses attachmentId as a plain filename component — strip any
          // characters that would be interpreted as path separators (e.g. the '/'
          // in "attachments/uuid-file.jpg") so writeFile() doesn't try to create
          // a subdirectory that doesn't exist and silently drop the transfer.
          const relayAttachmentId = result.objectKey.replace(/[^A-Za-z0-9._-]/g, '_');
          ctx.clawnetTransportService.relayAttachment(
            parsed.data.targetDid,
            fileBuffer,
            parsed.data.fileContentType ?? 'application/octet-stream',
            relayAttachmentId,
            parsed.data.objectKey.split('/').pop(),
          ).catch((err: unknown) => {
            getGlobalLogger().warn('[attachments] P2P relay failed for %s: %s', result.objectKey, (err as Error).message);
          });
        }
      }

      const downloadUrl = `${nodeBaseUrl(ctx.config)}/api/v1/attachments/${encodeURIComponent(result.objectKey)}`;
      ok(res, { ...result, downloadUrl }, { self: `/api/v1/attachments/${encodeURIComponent(result.objectKey)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // Receive uploaded file bytes
  router.put('/:objectKey', async ({ res, body, params, url }) => {
    try {
      if (!Buffer.isBuffer(body)) {
        handleError(res, new TelagentError(ErrorCodes.VALIDATION, 'Expected binary body'), url.pathname);
        return;
      }
      await ctx.attachmentService.saveFile(params.objectKey!, body);
      res.writeHead(204);
      res.end();
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // Serve stored file
  router.get('/:objectKey', async ({ res, params, url }) => {
    try {
      const data = await ctx.attachmentService.readFile(params.objectKey!);
      if (!data) {
        // Explicitly prevent caching of 404 responses so the client can retry
        // once the P2P relay delivers the file to this node.
        res.setHeader('Cache-Control', 'no-store');
        handleError(res, new TelagentError(ErrorCodes.NOT_FOUND, 'Attachment not found'), url.pathname);
        return;
      }
      const contentType = ctx.attachmentService.getContentType(params.objectKey!);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.length,
        'Cache-Control': 'private, max-age=86400',
      });
      res.end(data);
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}
