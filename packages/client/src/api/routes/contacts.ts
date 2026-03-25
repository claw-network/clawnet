import { ErrorCodes, TelagentError } from '../../protocol/index.js';

import { Router } from '../router.js';
import { handleError } from '../route-utils.js';
import { ok, created, noContent } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { localPeerAvatarUrl } from '../../utils/avatar-url.js';
import { pushOwnProfileCard } from '../../utils/push-profile-card.js';

export function contactRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  router.get('/', async ({ res, url }) => {
    try {
      const contacts = ctx.contactService.listContacts().map((contact) => {
        const peer = ctx.peerProfileRepository.get(contact.did);
        const rawAvatarUrl = peer?.avatarUrl ?? contact.avatarUrl;
        return {
          ...contact,
          avatarUrl: localPeerAvatarUrl(contact.did, rawAvatarUrl),
        };
      });
      ok(res, contacts, { self: '/api/v1/contacts' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/:did', async ({ res, params, url }) => {
    try {
      const contact = ctx.contactService.getContact(params.did);
      if (!contact) {
        throw new TelagentError(ErrorCodes.NOT_FOUND, `Contact not found: ${params.did}`);
      }
      const peer = ctx.peerProfileRepository.get(params.did);
      const rawAvatarUrl = peer?.avatarUrl ?? contact.avatarUrl;
      ok(
        res,
        {
          ...contact,
          avatarUrl: localPeerAvatarUrl(params.did, rawAvatarUrl),
        },
        { self: `/api/v1/contacts/${encodeURIComponent(params.did)}` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/', async ({ res, body, url }) => {
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'body must be an object');
      }
      const payload = body as Record<string, unknown>;
      const did = typeof payload.did === 'string' ? payload.did.trim() : '';
      const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
      if (!did) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'did is required');
      }
      if (!displayName) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'displayName is required');
      }

      const contact = ctx.contactService.addContact({
        did,
        displayName,
        avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : undefined,
        notes: typeof payload.notes === 'string' ? payload.notes : undefined,
      });

      // Fire-and-forget: push our profile card to the new contact so they know us,
      // and trigger a reciprocal profile-card reply so we learn their nickname/avatar.
      void pushOwnProfileCard(ctx, did).catch((err: Error) =>
        console.warn('[profile-card] Failed to push profile card to %s: %s', did, err.message),
      );

      created(res, contact, { self: `/api/v1/contacts/${encodeURIComponent(did)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.put('/:did', async ({ res, params, body, url }) => {
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'body must be an object');
      }
      const payload = body as Record<string, unknown>;
      const contact = ctx.contactService.updateContact(params.did, {
        displayName: typeof payload.displayName === 'string' ? payload.displayName : undefined,
        avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : undefined,
        notes: typeof payload.notes === 'string' ? payload.notes : undefined,
      });
      ok(res, contact, { self: `/api/v1/contacts/${encodeURIComponent(params.did)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.delete('/:did', async ({ res, params, url }) => {
    try {
      ctx.contactService.removeContact(params.did);
      noContent(res);
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}
