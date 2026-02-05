import { didFromPublicKey, publicKeyFromDid } from '@clawtoken/core/identity';
import { multibaseDecode, multibaseEncode } from '@clawtoken/core/encoding';

export interface VerificationMethod {
  id: string;
  type: 'Ed25519VerificationKey2020';
  controller: string;
  publicKeyMultibase: string;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

export interface ClawDIDDocument {
  id: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  keyAgreement: string[];
  service: ServiceEndpoint[];
  alsoKnownAs: string[];
}

export interface CreateDIDDocumentOptions {
  id?: string;
  publicKey: Uint8Array;
  alsoKnownAs?: string[];
  service?: ServiceEndpoint[];
}

export function createDIDDocument(options: CreateDIDDocumentOptions): ClawDIDDocument {
  const did = options.id ?? didFromPublicKey(options.publicKey);
  const keyId = `${did}#key-1`;
  const verificationMethod: VerificationMethod = {
    id: keyId,
    type: 'Ed25519VerificationKey2020',
    controller: did,
    publicKeyMultibase: multibaseEncode(options.publicKey),
  };

  return {
    id: did,
    verificationMethod: [verificationMethod],
    authentication: [keyId],
    assertionMethod: [keyId],
    keyAgreement: [],
    service: options.service ?? [],
    alsoKnownAs: options.alsoKnownAs ?? [],
  };
}

export function getPrimaryPublicKey(document: ClawDIDDocument): Uint8Array | null {
  const methodId = document.authentication[0] ?? document.verificationMethod[0]?.id;
  if (!methodId) {
    return null;
  }
  const method = document.verificationMethod.find((entry) => entry.id === methodId);
  if (!method) {
    return null;
  }
  try {
    return multibaseDecode(method.publicKeyMultibase);
  } catch {
    return null;
  }
}

export function validateDIDDocument(document: ClawDIDDocument): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!document.id || !document.id.startsWith('did:claw:')) {
    errors.push('invalid did');
  }
  if (!document.verificationMethod?.length) {
    errors.push('missing verificationMethod');
  }
  for (const method of document.verificationMethod ?? []) {
    if (!method.id || !method.id.startsWith(`${document.id}#`)) {
      errors.push('invalid verificationMethod id');
    }
    if (method.type !== 'Ed25519VerificationKey2020') {
      errors.push('unsupported verificationMethod type');
    }
    if (method.controller !== document.id) {
      errors.push('invalid verificationMethod controller');
    }
    try {
      multibaseDecode(method.publicKeyMultibase);
    } catch {
      errors.push('invalid verificationMethod publicKeyMultibase');
    }
  }
  for (const ref of document.authentication ?? []) {
    if (!document.verificationMethod.some((entry) => entry.id === ref)) {
      errors.push('authentication reference not found');
    }
  }
  for (const ref of document.assertionMethod ?? []) {
    if (!document.verificationMethod.some((entry) => entry.id === ref)) {
      errors.push('assertionMethod reference not found');
    }
  }
  return { valid: errors.length === 0, errors };
}

export function didFromDocument(document: ClawDIDDocument): string {
  return document.id;
}

export function publicKeyFromDocument(document: ClawDIDDocument): Uint8Array {
  if (!document.id) {
    throw new Error('missing did');
  }
  return publicKeyFromDid(document.id);
}
