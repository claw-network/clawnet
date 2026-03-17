/**
 * Identity routes — /api/v1/identities
 */

import { Router } from '../router.js';
import { ok, created, noContent, notFound, badRequest, internalError } from '../response.js';
import { validate } from '../schemas/common.js';
import {
  IdentityRegisterSchema,
  IdentityRotateKeySchema,
  IdentityRevokeSchema,
  CapabilityRegisterSchema,
} from '../schemas/identity.js';
import type { RuntimeContext } from '../types.js';
import {
  isValidDid,
  publicKeyFromDid,
  keyIdFromPublicKey,
  resolveStoragePaths,
  loadKeyRecord,
  decryptKeyRecord,
  verifyCapabilityCredential,
} from '../types.js';
import { resolveLocalIdentity, buildIdentityView, buildIdentityCapabilities } from '../legacy.js';
import {
  createIdentityCapabilityRegisterEnvelope,
  type CapabilityCredential,
} from '@claw-network/protocol';

export function identityRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── GET / — own identity (self) ───────────────────────────────
  r.get('/self', async (_req, res) => {
    const identity = await resolveLocalIdentity(ctx.config.dataDir);
    if (!identity) {
      notFound(res, 'Local identity not initialized');
      return;
    }

    if (ctx.identityService) {
      try {
        const doc = await ctx.identityService.resolve(identity.did);
        if (doc) {
          const capabilities = ctx.eventStore
            ? await buildIdentityCapabilities(ctx.eventStore, identity.did)
            : [];
          ok(
            res,
            {
              did: identity.did,
              publicKey: doc.publicKey,
              controller: doc.controller,
              keyPurpose: doc.keyPurpose,
              isActive: doc.isActive,
              created: doc.createdAt,
              updated: doc.updatedAt,
              displayName: identity.displayName,
              avatar: identity.avatar,
              bio: identity.bio,
              platformLinks: doc.platformLinks,
              capabilities,
            },
            { self: '/api/v1/identities/self' },
          );
          return;
        }
      } catch {
        /* fall through */
      }
    }

    // Legacy fallback
    if (ctx.eventStore) {
      const fromEvents = await buildIdentityView(ctx.eventStore, identity.did);
      if (fromEvents) {
        ok(
          res,
          { ...identity, ...fromEvents, did: identity.did, publicKey: identity.publicKey },
          { self: '/api/v1/identities/self' },
        );
        return;
      }
      const caps = await buildIdentityCapabilities(ctx.eventStore, identity.did);
      ok(res, { ...identity, capabilities: caps }, { self: '/api/v1/identities/self' });
      return;
    }
    ok(res, identity, { self: '/api/v1/identities/self' });
  });

  // ── GET /:did — resolve DID ───────────────────────────────────
  r.get('/:did', async (_req, res, route) => {
    const { did } = route.params;
    if (!isValidDid(did)) {
      badRequest(res, 'Invalid DID format', route.url.pathname);
      return;
    }

    if (ctx.identityService) {
      try {
        const doc = await ctx.identityService.resolve(did);
        if (doc) {
          const capabilities = ctx.eventStore
            ? await buildIdentityCapabilities(ctx.eventStore, did)
            : [];
          ok(
            res,
            {
              did,
              publicKey: doc.publicKey,
              controller: doc.controller,
              keyPurpose: doc.keyPurpose,
              isActive: doc.isActive,
              created: doc.createdAt,
              updated: doc.updatedAt,
              platformLinks: doc.platformLinks,
              capabilities,
            },
            { self: `/api/v1/identities/${encodeURIComponent(did)}` },
          );
          return;
        }
      } catch {
        /* fall through */
      }
    }

    // Legacy
    const local = await resolveLocalIdentity(ctx.config.dataDir);
    if (local && local.did === did) {
      ok(res, local, { self: `/api/v1/identities/${encodeURIComponent(did)}` });
      return;
    }
    if (ctx.eventStore) {
      const resolved = await buildIdentityView(ctx.eventStore, did);
      if (resolved) {
        ok(res, resolved, { self: `/api/v1/identities/${encodeURIComponent(did)}` });
        return;
      }
    }
    notFound(res, 'DID not found', route.url.pathname);
  });

  // ── POST / — register DID ────────────────────────────────────
  r.post('/', async (_req, res, route) => {
    if (!ctx.identityService) {
      internalError(res, 'Chain identity service unavailable');
      return;
    }
    const v = validate(IdentityRegisterSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    try {
      const result = await ctx.identityService.registerDID(
        body.did,
        body.publicKey,
        body.purpose ?? 'authentication',
        body.evmAddress,
      );
      created(res, result, { self: `/api/v1/identities/${encodeURIComponent(body.did)}` });
    } catch (err) {
      internalError(res, err instanceof Error ? err.message : 'Register failed');
    }
  });

  // ── DELETE /:did — revoke DID ─────────────────────────────────
  r.delete('/:did', async (_req, res, route) => {
    if (!ctx.identityService) {
      internalError(res, 'Chain identity service unavailable');
      return;
    }
    const v = validate(IdentityRevokeSchema, { ...(route.body as object), did: route.params.did });
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }

    try {
      await ctx.identityService.revokeDID(route.params.did);
      noContent(res);
    } catch (err) {
      internalError(res, err instanceof Error ? err.message : 'Revoke failed');
    }
  });

  // ── POST /:did/keys — rotate key ─────────────────────────────
  r.post('/:did/keys', async (_req, res, route) => {
    if (!ctx.identityService) {
      internalError(res, 'Chain identity service unavailable');
      return;
    }
    const v = validate(IdentityRotateKeySchema, {
      ...(route.body as object),
      did: route.params.did,
    });
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    try {
      const result = await ctx.identityService.rotateKey(
        body.did,
        body.newPublicKey,
        body.rotationProof ?? '0x',
      );
      created(res, result, { self: `/api/v1/identities/${encodeURIComponent(body.did)}` });
    } catch (err) {
      internalError(res, err instanceof Error ? err.message : 'Key rotation failed');
    }
  });

  // ── GET /:did/capabilities — list capabilities ────────────────
  r.get('/:did/capabilities', async (_req, res, route) => {
    const { did } = route.params;
    const caps = ctx.eventStore ? await buildIdentityCapabilities(ctx.eventStore, did) : [];
    ok(res, caps, { self: `/api/v1/identities/${encodeURIComponent(did)}/capabilities` });
  });

  // ── POST /:did/capabilities — register capability ─────────────
  r.post('/:did/capabilities', async (_req, res, route) => {
    const v = validate(CapabilityRegisterSchema, {
      ...(route.body as object),
      did: route.params.did,
    });
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    const credential = body.credential as CapabilityCredential | undefined;
    if (!credential) {
      badRequest(res, 'Missing credential', route.url.pathname);
      return;
    }
    if (!(await verifyCapabilityCredential(credential))) {
      badRequest(res, 'Invalid capability credential', route.url.pathname);
      return;
    }

    const subject = credential.credentialSubject;
    if (!subject?.name || !subject?.pricing) {
      badRequest(res, 'Credential subject incomplete', route.url.pathname);
      return;
    }

    let privateKey: Uint8Array;
    try {
      const pk = publicKeyFromDid(body.did);
      const keyId = keyIdFromPublicKey(pk);
      const paths = resolveStoragePaths(ctx.config.dataDir);
      const record = await loadKeyRecord(paths, keyId);
      privateKey = await decryptKeyRecord(record, body.passphrase);
    } catch {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }

    try {
      const envelope = await createIdentityCapabilityRegisterEnvelope({
        did: body.did,
        privateKey,
        name: subject.name,
        pricing: subject.pricing,
        description: subject.description,
        credential,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      const data: Record<string, unknown> = {
        id: hash,
        name: subject.name,
        pricing: subject.pricing,
        verified: false,
        registeredAt: body.ts ?? Date.now(),
      };
      if (subject.description) data.description = subject.description;
      created(res, data, {
        self: `/api/v1/identities/${encodeURIComponent(body.did)}/capabilities/${hash}`,
      });
    } catch {
      internalError(res, 'Publish failed');
    }
  });

  return r;
}
