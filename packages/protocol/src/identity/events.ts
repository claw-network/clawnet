import { canonicalizeBytes } from '@claw-network/core/crypto';
import { sha256Hex } from '@claw-network/core/crypto';
import { multibaseEncode } from '@claw-network/core/encoding';
import { didFromPublicKey, publicKeyFromDid } from '@claw-network/core/identity';
import {
  EventEnvelope,
  eventHashHex,
  signEvent,
} from '@claw-network/core/protocol';
import { ClawDIDDocument, createDIDDocument } from './document.js';

export interface IdentityCreatePayload {
  did: string;
  publicKey: string;
  document: ClawDIDDocument;
}

export interface IdentityUpdatePayload {
  did: string;
  document: ClawDIDDocument;
  prevDocHash: string;
}

export interface VerifiableCredentialProof {
  type: 'Ed25519Signature2020';
  created: string;
  verificationMethod: string;
  proofPurpose: 'assertionMethod';
  proofValue: string;
}

export interface VerifiableCredential<TSubject> {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: TSubject;
  proof: VerifiableCredentialProof;
}

export interface PlatformLinkCredentialSubject {
  id: string;
  platformId: string;
  platformUsername: string;
  linkedAt: string;
}

export type PlatformLinkCredential = VerifiableCredential<PlatformLinkCredentialSubject>;

export interface IdentityPlatformLinkPayload {
  did: string;
  platformId: string;
  platformUsername: string;
  credential: PlatformLinkCredential;
}

export interface CapabilityCredentialSubject {
  id: string;
  name: string;
  pricing: Record<string, unknown>;
  description?: string;
}

export type CapabilityCredential = VerifiableCredential<CapabilityCredentialSubject>;

export interface IdentityCapabilityRegisterPayload {
  did: string;
  name: string;
  pricing: Record<string, unknown>;
  description?: string;
  credential: CapabilityCredential;
}

export interface IdentityCreateEventParams {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  document?: ClawDIDDocument;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface IdentityUpdateEventParams {
  did: string;
  privateKey: Uint8Array;
  document: ClawDIDDocument;
  prevDocHash: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface IdentityPlatformLinkEventParams {
  did: string;
  privateKey: Uint8Array;
  credential: PlatformLinkCredential;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface IdentityCapabilityRegisterEventParams {
  did: string;
  privateKey: Uint8Array;
  name: string;
  pricing: Record<string, unknown>;
  description?: string;
  credential: CapabilityCredential;
  ts: number;
  nonce: number;
  prev?: string;
}

function canonicalEquals(left: unknown, right: unknown): boolean {
  try {
    const leftBytes = canonicalizeBytes(left);
    const rightBytes = canonicalizeBytes(right);
    if (leftBytes.length !== rightBytes.length) {
      return false;
    }
    for (let i = 0; i < leftBytes.length; i += 1) {
      if (leftBytes[i] !== rightBytes[i]) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function identityDocumentHash(document: ClawDIDDocument): string {
  return sha256Hex(canonicalizeBytes(document));
}

export async function createIdentityCreateEnvelope(
  params: IdentityCreateEventParams,
): Promise<EventEnvelope> {
  const did = params.document?.id ?? didFromPublicKey(params.publicKey);
  const document = params.document ?? createDIDDocument({ id: did, publicKey: params.publicKey });
  if (document.id !== did) {
    throw new Error('document did does not match public key');
  }

  const payload: IdentityCreatePayload = {
    did,
    publicKey: multibaseEncode(params.publicKey),
    document,
  };

  const baseEnvelope: EventEnvelope = {
    v: 1,
    type: 'identity.create',
    issuer: did,
    ts: params.ts,
    nonce: params.nonce,
    payload,
    prev: params.prev,
    sig: '',
    pub: multibaseEncode(params.publicKey),
    hash: '',
  };

  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createIdentityUpdateEnvelope(
  params: IdentityUpdateEventParams,
): Promise<EventEnvelope> {
  if (params.document.id !== params.did) {
    throw new Error('document did does not match payload did');
  }
  const publicKey = publicKeyFromDid(params.did);
  const payload: IdentityUpdatePayload = {
    did: params.did,
    document: params.document,
    prevDocHash: params.prevDocHash,
  };

  const baseEnvelope: EventEnvelope = {
    v: 1,
    type: 'identity.update',
    issuer: params.did,
    ts: params.ts,
    nonce: params.nonce,
    payload,
    prev: params.prev,
    sig: '',
    pub: multibaseEncode(publicKey),
    hash: '',
  };

  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createIdentityPlatformLinkEnvelope(
  params: IdentityPlatformLinkEventParams,
): Promise<EventEnvelope> {
  const subject = params.credential?.credentialSubject;
  if (!subject?.id) {
    throw new Error('credential subject missing id');
  }
  if (subject.id !== params.did) {
    throw new Error('credential subject did does not match payload did');
  }
  if (!subject.platformId || !subject.platformUsername) {
    throw new Error('credential subject missing platform fields');
  }

  const publicKey = publicKeyFromDid(params.did);
  const payload: IdentityPlatformLinkPayload = {
    did: params.did,
    platformId: subject.platformId,
    platformUsername: subject.platformUsername,
    credential: params.credential,
  };

  const baseEnvelope: EventEnvelope = {
    v: 1,
    type: 'identity.platform.link',
    issuer: params.did,
    ts: params.ts,
    nonce: params.nonce,
    payload,
    prev: params.prev,
    sig: '',
    pub: multibaseEncode(publicKey),
    hash: '',
  };

  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createIdentityCapabilityRegisterEnvelope(
  params: IdentityCapabilityRegisterEventParams,
): Promise<EventEnvelope> {
  if (!params.name) {
    throw new Error('capability name is required');
  }
  if (!params.pricing) {
    throw new Error('capability pricing is required');
  }
  const subject = params.credential?.credentialSubject;
  if (!subject?.id) {
    throw new Error('credential subject missing id');
  }
  if (subject.id !== params.did) {
    throw new Error('credential subject did does not match payload did');
  }
  if (!subject.name) {
    throw new Error('credential subject missing capability name');
  }
  if (!canonicalEquals(subject.pricing, params.pricing)) {
    throw new Error('credential pricing does not match payload');
  }
  if (subject.name !== params.name) {
    throw new Error('credential name does not match payload');
  }
  if (params.description && subject.description && subject.description !== params.description) {
    throw new Error('credential description does not match payload');
  }

  const publicKey = publicKeyFromDid(params.did);
  const payload: IdentityCapabilityRegisterPayload = {
    did: params.did,
    name: params.name,
    pricing: params.pricing,
    description: params.description,
    credential: params.credential,
  };

  const baseEnvelope: EventEnvelope = {
    v: 1,
    type: 'identity.capability.register',
    issuer: params.did,
    ts: params.ts,
    nonce: params.nonce,
    payload,
    prev: params.prev,
    sig: '',
    pub: multibaseEncode(publicKey),
    hash: '',
  };

  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}
