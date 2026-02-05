import { canonicalizeBytes } from '../crypto/jcs.js';
import { signBase58, verifyBase58 } from '../crypto/ed25519.js';
import { publicKeyFromDid } from '../identity/did.js';
import { concatBytes, utf8ToBytes } from '../utils/bytes.js';

export const VC_DOMAIN_PREFIX = 'clawtoken:vc:v1:';

export interface VerifiableCredentialProof {
  type: 'Ed25519Signature2020';
  created: string;
  verificationMethod: string;
  proofPurpose: 'assertionMethod';
  proofValue: string;
}

export interface VerifiableCredential<TSubject = Record<string, unknown>> {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: TSubject;
  proof: VerifiableCredentialProof;
}

export interface CapabilityCredentialSubject {
  id: string;
  name: string;
  pricing: Record<string, unknown>;
  description?: string;
}

export type CapabilityCredential = VerifiableCredential<CapabilityCredentialSubject>;

export function stripCredentialProof<TSubject>(
  credential: VerifiableCredential<TSubject>,
): Omit<VerifiableCredential<TSubject>, 'proof'> {
  const { proof: _proof, ...rest } = credential;
  return rest;
}

export function canonicalCredentialBytes<TSubject>(
  credential: VerifiableCredential<TSubject>,
): Uint8Array {
  return canonicalizeBytes(stripCredentialProof(credential));
}

export function credentialSigningBytes<TSubject>(
  credential: VerifiableCredential<TSubject>,
): Uint8Array {
  const canonical = canonicalCredentialBytes(credential);
  return concatBytes(utf8ToBytes(VC_DOMAIN_PREFIX), canonical);
}

export async function signCredentialProof<TSubject>(
  credential: VerifiableCredential<TSubject>,
  privateKey: Uint8Array,
): Promise<string> {
  return signBase58(credentialSigningBytes(credential), privateKey);
}

export async function verifyCredentialProof<TSubject>(
  credential: VerifiableCredential<TSubject>,
): Promise<boolean> {
  if (!credential?.issuer || !credential?.proof?.proofValue) {
    return false;
  }
  if (credential.proof.type !== 'Ed25519Signature2020') {
    return false;
  }
  if (credential.proof.proofPurpose !== 'assertionMethod') {
    return false;
  }
  if (
    credential.proof.verificationMethod &&
    !credential.proof.verificationMethod.startsWith(`${credential.issuer}#`)
  ) {
    return false;
  }
  let publicKey: Uint8Array;
  try {
    publicKey = publicKeyFromDid(credential.issuer);
  } catch {
    return false;
  }
  try {
    return await verifyBase58(
      credential.proof.proofValue,
      credentialSigningBytes(credential),
      publicKey,
    );
  } catch {
    return false;
  }
}

export async function verifyCapabilityCredential(
  credential: CapabilityCredential,
): Promise<boolean> {
  if (!credential?.type?.includes('CapabilityCredential')) {
    return false;
  }
  if (!credential.credentialSubject?.id || !credential.credentialSubject?.name) {
    return false;
  }
  if (!credential.credentialSubject?.pricing) {
    return false;
  }
  return verifyCredentialProof(credential);
}
