import { z } from 'zod';

const HexString = z.string().regex(/^0x[0-9a-fA-F]+$/);
const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const AgentDidSchema = z.string().regex(/^did:claw:[A-Za-z0-9]+$/);

export const EnvelopeSchema = z.object({
  envelopeId: z.string().min(1),
  conversationId: z.string().min(1),
  conversationType: z.enum(['direct', 'group']),
  routeHint: z.object({
    targetDomain: z.string().min(1).optional(),
    targetDid: z.string().min(1),
    mailboxKeyId: z.string().min(1),
  }),
  sealedHeader: HexString,
  seq: z.bigint().nonnegative(),
  epoch: z.number().int().nonnegative().optional(),
  ciphertext: HexString,
  contentType: z.enum(['text', 'image', 'file', 'control']),
  attachmentManifestHash: Bytes32.optional(),
  sentAtMs: z.number().int().nonnegative(),
  ttlSec: z.number().int().positive(),
  provisional: z.boolean().optional(),
  read: z.boolean().optional(),
});

export const CreateGroupSchema = z.object({
  creatorDid: AgentDidSchema,
  groupId: Bytes32,
  groupDomain: z.string().min(1),
  domainProofHash: Bytes32,
  initialMlsStateHash: Bytes32,
});

export const InviteMemberSchema = z.object({
  inviterDid: AgentDidSchema,
  inviteeDid: AgentDidSchema,
  inviteId: Bytes32,
  mlsCommitHash: Bytes32,
});

export const AcceptInviteSchema = z.object({
  inviteeDid: AgentDidSchema,
  mlsWelcomeHash: Bytes32,
});

export const RemoveMemberSchema = z.object({
  operatorDid: AgentDidSchema,
  memberDid: AgentDidSchema,
  mlsCommitHash: Bytes32,
});

export const SendMessageSchema = z.object({
  envelopeId: z.string().min(1).max(128).optional(),
  senderDid: AgentDidSchema,
  conversationId: z.string().min(1),
  conversationType: z.enum(['direct', 'group']),
  targetDomain: z.string().min(1).optional(),
  targetDid: z.string().min(1),
  mailboxKeyId: z.string().min(1),
  sealedHeader: HexString,
  ciphertext: HexString,
  contentType: z.enum(['text', 'image', 'file', 'control']),
  attachmentManifestHash: Bytes32.optional(),
  epoch: z.number().int().nonnegative().optional(),
  ttlSec: z.number().int().positive().default(2_592_000),
});

export const InitAttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
  manifestHash: Bytes32,
});

export const CompleteAttachmentSchema = z.object({
  objectKey: z.string().min(1),
  manifestHash: Bytes32,
  checksum: Bytes32,
  fileContentType: z.string().optional(),
  // When set, the server will relay the file to this DID via ClawNet P2P.
  targetDid: z.string().optional(),
});
