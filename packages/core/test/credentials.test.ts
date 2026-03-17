import { describe, expect, it } from 'vitest';
import { generateKeypair } from '../src/crypto/ed25519.js';
import { didFromPublicKey } from '../src/identity/did.js';
import {
  CapabilityCredential,
  signCredentialProof,
  verifyCapabilityCredential,
  verifyCredentialProof,
} from '../src/protocol/credentials.js';

describe('credential proofs', () => {
  it('verifies a signed capability credential', async () => {
    const issuerKeys = await generateKeypair();
    const subjectKeys = await generateKeypair();
    const issuerDid = didFromPublicKey(issuerKeys.publicKey);
    const subjectDid = didFromPublicKey(subjectKeys.publicKey);
    const credential: CapabilityCredential = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'CapabilityCredential'],
      issuer: issuerDid,
      issuanceDate: '2026-02-01T00:00:00.000Z',
      credentialSubject: {
        id: subjectDid,
        name: 'image-caption',
        pricing: { type: 'fixed', amount: '12' },
        description: 'vision capability',
      },
      proof: {
        type: 'Ed25519Signature2020',
        created: '2026-02-01T00:00:00.000Z',
        verificationMethod: `${issuerDid}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: '',
      },
    };
    credential.proof.proofValue = await signCredentialProof(credential, issuerKeys.privateKey);

    expect(await verifyCredentialProof(credential)).toBe(true);
    expect(await verifyCapabilityCredential(credential)).toBe(true);
  });

  it('rejects invalid credential proofs', async () => {
    const issuerKeys = await generateKeypair();
    const subjectKeys = await generateKeypair();
    const issuerDid = didFromPublicKey(issuerKeys.publicKey);
    const subjectDid = didFromPublicKey(subjectKeys.publicKey);
    const credential: CapabilityCredential = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'CapabilityCredential'],
      issuer: issuerDid,
      issuanceDate: '2026-02-01T00:00:00.000Z',
      credentialSubject: {
        id: subjectDid,
        name: 'speech-to-text',
        pricing: { type: 'fixed', amount: '9' },
      },
      proof: {
        type: 'Ed25519Signature2020',
        created: '2026-02-01T00:00:00.000Z',
        verificationMethod: `${issuerDid}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: 'bad-signature',
      },
    };

    expect(await verifyCredentialProof(credential)).toBe(false);
  });
});
