import { Builder } from 'flatbuffers';
import { sha256Hex } from '@clawnet/core/crypto';
import { signBase58, verifyBase58 } from '@clawnet/core/crypto';
import { concatBytes, utf8ToBytes } from '@clawnet/core/utils';
import {
  CONTENT_TYPE,
  PeerRotate,
  P2PEnvelope,
  PowTicket,
  RequestMessage,
  ResponseMessage,
  StakeProof,
} from './types.js';
import {
  decodePowTicket,
  decodeRequestMessage,
  decodeResponseMessage,
  decodeStakeProof,
  decodePeerRotate,
  encodeP2PEnvelope,
  encodePeerRotate,
  encodePowTicket,
  encodeRequestMessage,
  encodeResponseMessage,
  encodeStakeProof,
  finishBytes,
  FlatBufferReader,
  prefixDomain,
} from './flatbuffers.js';

const P2P_DOMAIN = 'clawnet:p2p:v1:';
const POW_DOMAIN = 'clawnet:pow:v1:';
const STAKE_DOMAIN = 'clawnet:stakeproof:v1:';
const PEER_ROTATE_DOMAIN = 'clawnet:peer-rotate:v1:';

export function encodeRequestMessageBytes(
  message: RequestMessage,
  options?: { preserveUnknown?: boolean },
): Uint8Array {
  if (options?.preserveUnknown && message.rawBytes) {
    return message.rawBytes;
  }
  const builder = new Builder(256);
  const root = encodeRequestMessage(builder, message);
  return finishBytes(builder, root);
}

export function decodeRequestMessageBytes(bytes: Uint8Array): RequestMessage {
  const reader = new FlatBufferReader(bytes);
  const root = reader.rootTable();
  return { ...decodeRequestMessage(reader, root), rawBytes: bytes };
}

export function encodeResponseMessageBytes(
  message: ResponseMessage,
  options?: { preserveUnknown?: boolean },
): Uint8Array {
  if (options?.preserveUnknown && message.rawBytes) {
    return message.rawBytes;
  }
  const builder = new Builder(256);
  const root = encodeResponseMessage(builder, message);
  return finishBytes(builder, root);
}

export function decodeResponseMessageBytes(bytes: Uint8Array): ResponseMessage {
  const reader = new FlatBufferReader(bytes);
  const root = reader.rootTable();
  return { ...decodeResponseMessage(reader, root), rawBytes: bytes };
}

export function encodeP2PEnvelopeBytes(
  envelope: P2PEnvelope,
  options?: { preserveUnknown?: boolean },
): Uint8Array {
  if (options?.preserveUnknown && envelope.rawBytes) {
    return envelope.rawBytes;
  }
  const builder = new Builder(512);
  const root = encodeP2PEnvelope(builder, envelope);
  return finishBytes(builder, root);
}

export function decodeP2PEnvelopeBytes(bytes: Uint8Array): P2PEnvelope {
  const reader = new FlatBufferReader(bytes);
  const root = reader.rootTable();
  return {
    v: reader.readUint16Field(root, 0, 0),
    topic: reader.readStringField(root, 1) ?? '',
    sender: reader.readStringField(root, 2) ?? '',
    ts: reader.readUint64Field(root, 3, 0n),
    contentType: reader.readStringField(root, 4) ?? '',
    payload: reader.readByteVectorField(root, 5) ?? new Uint8Array(),
    sig: reader.readStringField(root, 6) ?? '',
    rawBytes: bytes,
  };
}

export function p2pEnvelopeSigningBytes(envelope: P2PEnvelope): Uint8Array {
  const unsigned = { ...envelope, sig: '' };
  const bytes = encodeP2PEnvelopeBytes(unsigned);
  return prefixDomain(P2P_DOMAIN, bytes);
}

export async function signP2PEnvelope(
  envelope: Omit<P2PEnvelope, 'sig'>,
  privateKey: Uint8Array,
): Promise<P2PEnvelope> {
  const unsigned: P2PEnvelope = { ...envelope, sig: '' };
  const sig = await signBase58(p2pEnvelopeSigningBytes(unsigned), privateKey);
  return { ...unsigned, sig };
}

export async function verifyP2PEnvelopeSignature(
  envelope: P2PEnvelope,
  publicKey: Uint8Array,
): Promise<boolean> {
  return verifyBase58(envelope.sig, p2pEnvelopeSigningBytes(envelope), publicKey);
}

export function encodePowTicketBytes(ticket: PowTicket): Uint8Array {
  const builder = new Builder(256);
  const root = encodePowTicket(builder, ticket);
  return finishBytes(builder, root);
}

export function decodePowTicketBytes(bytes: Uint8Array): PowTicket {
  const reader = new FlatBufferReader(bytes);
  const root = reader.rootTable();
  return decodePowTicket(reader, root);
}

export function encodePeerRotateBytes(rotate: PeerRotate): Uint8Array {
  const builder = new Builder(256);
  const root = encodePeerRotate(builder, rotate);
  return finishBytes(builder, root);
}

export function decodePeerRotateBytes(bytes: Uint8Array): PeerRotate {
  const reader = new FlatBufferReader(bytes);
  const root = reader.rootTable();
  return decodePeerRotate(reader, root);
}

export function peerRotateSigningBytes(rotate: PeerRotate): Uint8Array {
  const unsigned = { ...rotate, sig: '', sigNew: '' };
  const bytes = encodePeerRotateBytes(unsigned);
  return prefixDomain(PEER_ROTATE_DOMAIN, bytes);
}

export async function signPeerRotateOld(
  rotate: PeerRotate,
  oldPrivateKey: Uint8Array,
): Promise<PeerRotate> {
  const unsigned = { ...rotate, sig: '' };
  const sig = await signBase58(peerRotateSigningBytes(unsigned), oldPrivateKey);
  return { ...unsigned, sig };
}

export async function signPeerRotateNew(
  rotate: PeerRotate,
  newPrivateKey: Uint8Array,
): Promise<PeerRotate> {
  const unsigned = { ...rotate, sigNew: '' };
  const sigNew = await signBase58(peerRotateSigningBytes(unsigned), newPrivateKey);
  return { ...unsigned, sigNew };
}

export async function verifyPeerRotateOldSignature(
  rotate: PeerRotate,
  oldPublicKey: Uint8Array,
): Promise<boolean> {
  return verifyBase58(rotate.sig, peerRotateSigningBytes(rotate), oldPublicKey);
}

export async function verifyPeerRotateNewSignature(
  rotate: PeerRotate,
  newPublicKey: Uint8Array,
): Promise<boolean> {
  return verifyBase58(rotate.sigNew, peerRotateSigningBytes(rotate), newPublicKey);
}
export function powTicketSigningBytes(ticket: PowTicket): Uint8Array {
  const unsigned = { ...ticket, sig: '' };
  const bytes = encodePowTicketBytes(unsigned);
  return prefixDomain(POW_DOMAIN, bytes);
}

export function powTicketHashBytes(ticket: PowTicket): Uint8Array {
  const unsigned = { ...ticket, sig: '', hash: '' };
  const bytes = encodePowTicketBytes(unsigned);
  return prefixDomain(POW_DOMAIN, bytes);
}

export function powTicketHashHex(ticket: PowTicket): string {
  return sha256Hex(powTicketHashBytes(ticket));
}

export async function signPowTicket(ticket: PowTicket, privateKey: Uint8Array): Promise<PowTicket> {
  const unsigned = { ...ticket, sig: '' };
  const sig = await signBase58(powTicketSigningBytes(unsigned), privateKey);
  return { ...unsigned, sig };
}

export async function verifyPowTicketSignature(
  ticket: PowTicket,
  publicKey: Uint8Array,
): Promise<boolean> {
  return verifyBase58(ticket.sig, powTicketSigningBytes(ticket), publicKey);
}

export function encodeStakeProofBytes(proof: StakeProof): Uint8Array {
  const builder = new Builder(256);
  const root = encodeStakeProof(builder, proof);
  return finishBytes(builder, root);
}

export function decodeStakeProofBytes(bytes: Uint8Array): StakeProof {
  const reader = new FlatBufferReader(bytes);
  const root = reader.rootTable();
  return decodeStakeProof(reader, root);
}

export function stakeProofSigningBytes(proof: StakeProof): Uint8Array {
  const unsigned = { ...proof, sig: '', sigController: '' };
  const bytes = encodeStakeProofBytes(unsigned);
  return prefixDomain(STAKE_DOMAIN, bytes);
}

export async function signStakeProofPeer(
  proof: StakeProof,
  peerPrivateKey: Uint8Array,
): Promise<StakeProof> {
  const unsigned = { ...proof, sig: '' };
  const sig = await signBase58(stakeProofSigningBytes(unsigned), peerPrivateKey);
  return { ...unsigned, sig };
}

export async function signStakeProofController(
  proof: StakeProof,
  controllerPrivateKey: Uint8Array,
): Promise<StakeProof> {
  const unsigned = { ...proof, sigController: '' };
  const sigController = await signBase58(
    stakeProofSigningBytes(unsigned),
    controllerPrivateKey,
  );
  return { ...unsigned, sigController };
}

export async function verifyStakeProofPeerSignature(
  proof: StakeProof,
  peerPublicKey: Uint8Array,
): Promise<boolean> {
  return verifyBase58(proof.sig, stakeProofSigningBytes(proof), peerPublicKey);
}

export async function verifyStakeProofControllerSignature(
  proof: StakeProof,
  controllerPublicKey: Uint8Array,
): Promise<boolean> {
  return verifyBase58(proof.sigController, stakeProofSigningBytes(proof), controllerPublicKey);
}

export function ensureContentType(envelope: P2PEnvelope): P2PEnvelope {
  return { ...envelope, contentType: envelope.contentType || CONTENT_TYPE };
}

export function wrapRequestEnvelope(
  payload: Uint8Array,
  envelope: Omit<P2PEnvelope, 'payload' | 'sig' | 'contentType'>,
): P2PEnvelope {
  return {
    ...envelope,
    contentType: CONTENT_TYPE,
    payload,
    sig: '',
  };
}

export function wrapResponseEnvelope(
  payload: Uint8Array,
  envelope: Omit<P2PEnvelope, 'payload' | 'sig' | 'contentType'>,
): P2PEnvelope {
  return {
    ...envelope,
    contentType: CONTENT_TYPE,
    payload,
    sig: '',
  };
}

export function concatDomain(prefix: string, payload: Uint8Array): Uint8Array {
  return concatBytes(utf8ToBytes(prefix), payload);
}
