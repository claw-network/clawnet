import { describe, expect, it } from 'vitest';
import { generateKeypair } from '@clawnet/core/crypto';
import { didFromPublicKey } from '@clawnet/core/identity';
import { verifyEventSignature } from '@clawnet/core/protocol';
import { createDIDDocument } from '../src/identity/document.js';
import {
  CapabilityCredential,
  createIdentityCreateEnvelope,
  createIdentityCapabilityRegisterEnvelope,
  createIdentityPlatformLinkEnvelope,
  createIdentityUpdateEnvelope,
  identityDocumentHash,
  PlatformLinkCredential,
} from '../src/identity/events.js';

describe('identity events', () => {
  it('creates and signs identity.create envelopes', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const document = createDIDDocument({ publicKey });
    const envelope = await createIdentityCreateEnvelope({
      publicKey,
      privateKey,
      document,
      ts: Date.now(),
      nonce: 1,
    });
    expect(envelope.type).toBe('identity.create');
    expect(envelope.issuer).toBe(document.id);
    expect(await verifyEventSignature(envelope, envelope.sig as string, publicKey)).toBe(true);
  });

  it('creates identity.update envelopes with prevDocHash', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const document = createDIDDocument({ publicKey });
    const prevDocHash = identityDocumentHash(document);
    const envelope = await createIdentityUpdateEnvelope({
      did: document.id,
      privateKey,
      document,
      prevDocHash,
      ts: Date.now(),
      nonce: 2,
    });
    const payload = envelope.payload as { prevDocHash: string };
    expect(envelope.type).toBe('identity.update');
    expect(payload.prevDocHash).toBe(prevDocHash);
  });

  it('creates identity.platform.link envelopes', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const did = didFromPublicKey(publicKey);
    const { publicKey: platformKey } = await generateKeypair();
    const platformDid = didFromPublicKey(platformKey);
    const credential: PlatformLinkCredential = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'PlatformLinkCredential'],
      issuer: platformDid,
      issuanceDate: '2026-02-01T00:00:00.000Z',
      credentialSubject: {
        id: did,
        platformId: 'moltbook',
        platformUsername: 'agent123',
        linkedAt: '2026-02-01T00:00:00.000Z',
      },
      proof: {
        type: 'Ed25519Signature2020',
        created: '2026-02-01T00:00:00.000Z',
        verificationMethod: `${platformDid}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: 'signature-placeholder',
      },
    };

    const envelope = await createIdentityPlatformLinkEnvelope({
      did,
      privateKey,
      credential,
      ts: Date.now(),
      nonce: 3,
    });
    const payload = envelope.payload as { platformId: string; platformUsername: string };
    expect(envelope.type).toBe('identity.platform.link');
    expect(payload.platformId).toBe('moltbook');
    expect(payload.platformUsername).toBe('agent123');
    expect(await verifyEventSignature(envelope, envelope.sig as string, publicKey)).toBe(true);
  });

  it('creates identity.capability.register envelopes with credential', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const did = didFromPublicKey(publicKey);
    const { publicKey: issuerKey } = await generateKeypair();
    const issuerDid = didFromPublicKey(issuerKey);
    const pricing = { type: 'fixed', amount: '10' };
    const credential: CapabilityCredential = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'CapabilityCredential'],
      issuer: issuerDid,
      issuanceDate: '2026-02-01T00:00:00.000Z',
      credentialSubject: {
        id: did,
        name: 'speech-to-text',
        pricing,
        description: 'ASR capability',
      },
      proof: {
        type: 'Ed25519Signature2020',
        created: '2026-02-01T00:00:00.000Z',
        verificationMethod: `${issuerDid}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: 'signature-placeholder',
      },
    };

    const envelope = await createIdentityCapabilityRegisterEnvelope({
      did,
      privateKey,
      name: 'speech-to-text',
      pricing,
      description: 'ASR capability',
      credential,
      ts: Date.now(),
      nonce: 4,
    });
    const payload = envelope.payload as { name: string };
    expect(envelope.type).toBe('identity.capability.register');
    expect(payload.name).toBe('speech-to-text');
    expect(await verifyEventSignature(envelope, envelope.sig as string, publicKey)).toBe(true);
  });
});
