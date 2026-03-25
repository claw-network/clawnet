import type { AgentDID, ContentType, GroupID } from './types.js';

export interface AdapterEnvelopePayload {
  sealedHeader: string;
  ciphertext: string;
  attachmentManifestHash?: string;
  epoch?: number;
}

export interface AdapterPlaintextPayload {
  contentType: ContentType;
  plaintext: string;
  attachmentManifestHash?: string;
}

export interface SignalSealRequest extends AdapterPlaintextPayload {
  senderDid: AgentDID;
  recipientDid: AgentDID;
  conversationId: string;
  messageId: string;
  aad?: string;
}

export interface SignalOpenRequest {
  senderDid: AgentDID;
  recipientDid: AgentDID;
  conversationId: string;
  envelope: AdapterEnvelopePayload;
  aad?: string;
}

export interface MlsSealRequest extends AdapterPlaintextPayload {
  senderDid: AgentDID;
  groupId: GroupID;
  conversationId: string;
  epoch: number;
  messageId: string;
  aad?: string;
}

export interface MlsOpenRequest {
  senderDid: AgentDID;
  groupId: GroupID;
  conversationId: string;
  epoch: number;
  envelope: AdapterEnvelopePayload;
  aad?: string;
}

export interface SignalAdapter {
  readonly suite: 'signal';
  readonly version: string;
  seal(request: SignalSealRequest): Promise<AdapterEnvelopePayload>;
  open(request: SignalOpenRequest): Promise<AdapterPlaintextPayload>;
}

export interface MlsAdapter {
  readonly suite: 'mls';
  readonly version: string;
  seal(request: MlsSealRequest): Promise<AdapterEnvelopePayload>;
  open(request: MlsOpenRequest): Promise<AdapterPlaintextPayload>;
}
