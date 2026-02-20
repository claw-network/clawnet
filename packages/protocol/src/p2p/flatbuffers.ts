import { Builder } from 'flatbuffers';
import { concatBytes, utf8ToBytes } from '@clawnet/core/utils';
import {
  CONTENT_TYPE,
  PeerRotate,
  PowTicket,
  RangeRequest,
  RangeResponse,
  RequestMessage,
  RequestType,
  ResponseMessage,
  ResponseType,
  SnapshotRequest,
  SnapshotResponse,
  StakeProof,
} from './types.js';

const textDecoder = new TextDecoder();

export interface FlatBufferReaderOptions {
  byteOffset?: number;
}

export class FlatBufferReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array, options: FlatBufferReaderOptions = {}) {
    const offset = options.byteOffset ?? 0;
    this.bytes = bytes.subarray(offset);
    this.view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset,
      this.bytes.byteLength,
    );
  }

  rootTable(): number {
    return this.readUint32(0);
  }

  readUint8(offset: number): number {
    return this.view.getUint8(offset);
  }

  readUint16(offset: number): number {
    return this.view.getUint16(offset, true);
  }

  readUint32(offset: number): number {
    return this.view.getUint32(offset, true);
  }

  readInt32(offset: number): number {
    return this.view.getInt32(offset, true);
  }

  readUint64(offset: number): bigint {
    const low = this.readUint32(offset);
    const high = this.readUint32(offset + 4);
    return (BigInt(high) << 32n) | BigInt(low);
  }

  fieldOffset(table: number, fieldIndex: number): number | null {
    const vtable = this.vtable(table);
    const vtableLength = this.readUint16(vtable);
    const entry = vtable + 4 + fieldIndex * 2;
    if (entry >= vtable + vtableLength) {
      return null;
    }
    const offset = this.readUint16(entry);
    if (offset === 0) {
      return null;
    }
    return table + offset;
  }

  readUint8Field(table: number, fieldIndex: number, fallback = 0): number {
    const field = this.fieldOffset(table, fieldIndex);
    if (field === null) return fallback;
    return this.readUint8(field);
  }

  readUint32Field(table: number, fieldIndex: number, fallback = 0): number {
    const field = this.fieldOffset(table, fieldIndex);
    if (field === null) return fallback;
    return this.readUint32(field);
  }

  readUint16Field(table: number, fieldIndex: number, fallback = 0): number {
    const field = this.fieldOffset(table, fieldIndex);
    if (field === null) return fallback;
    return this.readUint16(field);
  }

  readUint64Field(table: number, fieldIndex: number, fallback = 0n): bigint {
    const field = this.fieldOffset(table, fieldIndex);
    if (field === null) return fallback;
    return this.readUint64(field);
  }

  readStringField(table: number, fieldIndex: number): string | null {
    const field = this.fieldOffset(table, fieldIndex);
    if (field === null) {
      return null;
    }
    const strStart = this.indirect(field);
    const length = this.readUint32(strStart);
    const bytes = this.bytes.subarray(strStart + 4, strStart + 4 + length);
    return textDecoder.decode(bytes);
  }

  readByteVectorField(table: number, fieldIndex: number): Uint8Array | null {
    const field = this.fieldOffset(table, fieldIndex);
    if (field === null) {
      return null;
    }
    const vecStart = this.indirect(field);
    const length = this.readUint32(vecStart);
    return this.bytes.subarray(vecStart + 4, vecStart + 4 + length);
  }

  readTableField(table: number, fieldIndex: number): number | null {
    const field = this.fieldOffset(table, fieldIndex);
    if (field === null) return null;
    return this.indirect(field);
  }

  readVectorTableField(table: number, fieldIndex: number): number[] | null {
    const field = this.fieldOffset(table, fieldIndex);
    if (field === null) return null;
    const vecStart = this.indirect(field);
    const length = this.readUint32(vecStart);
    const offsets: number[] = [];
    for (let i = 0; i < length; i++) {
      const element = vecStart + 4 + i * 4;
      offsets.push(this.indirect(element));
    }
    return offsets;
  }

  private vtable(table: number): number {
    return table - this.readInt32(table);
  }

  private indirect(offset: number): number {
    return offset + this.readUint32(offset);
  }
}

function createVectorOfTables(builder: Builder, offsets: number[]): number {
  builder.startVector(4, offsets.length, 4);
  for (let i = offsets.length - 1; i >= 0; i--) {
    builder.addOffset(offsets[i]);
  }
  return builder.endVector();
}

function createEventBytes(builder: Builder, data: Uint8Array): number {
  const dataOffset = builder.createByteVector(data);
  builder.startObject(1);
  builder.addFieldOffset(0, dataOffset, 0);
  return builder.endObject();
}

export function encodeRangeRequest(builder: Builder, request: RangeRequest): number {
  const fromOffset = builder.createString(request.from);
  builder.startObject(2);
  builder.addFieldOffset(0, fromOffset, 0);
  builder.addFieldInt32(1, request.limit, 0);
  return builder.endObject();
}

export function encodeRangeResponse(builder: Builder, response: RangeResponse): number {
  const eventOffsets = response.events.map((event) => createEventBytes(builder, event));
  const eventsVector = createVectorOfTables(builder, eventOffsets);
  const cursorOffset = builder.createString(response.cursor);
  builder.startObject(2);
  builder.addFieldOffset(0, eventsVector, 0);
  builder.addFieldOffset(1, cursorOffset, 0);
  return builder.endObject();
}

export function encodeSnapshotRequest(builder: Builder, request: SnapshotRequest): number {
  const fromOffset = builder.createString(request.from);
  builder.startObject(1);
  builder.addFieldOffset(0, fromOffset, 0);
  return builder.endObject();
}

export function encodeSnapshotResponse(builder: Builder, response: SnapshotResponse): number {
  const hashOffset = builder.createString(response.hash);
  const snapshotOffset = builder.createByteVector(response.snapshot);
  builder.startObject(5);
  builder.addFieldOffset(0, hashOffset, 0);
  builder.addFieldOffset(1, snapshotOffset, 0);
  builder.addFieldInt32(2, response.totalBytes ?? 0, 0);
  builder.addFieldInt32(3, response.chunkIndex ?? 0, 0);
  builder.addFieldInt32(4, response.chunkCount ?? 0, 0);
  return builder.endObject();
}

export function encodePeerRotate(builder: Builder, rotate: PeerRotate): number {
  const oldOffset = builder.createString(rotate.old);
  const newOffset = builder.createString(rotate['new']);
  const sigOffset = builder.createString(rotate.sig);
  const sigNewOffset = builder.createString(rotate.sigNew);
  builder.startObject(5);
  builder.addFieldOffset(0, oldOffset, 0);
  builder.addFieldOffset(1, newOffset, 0);
  builder.addFieldInt64(2, rotate.ts, 0n);
  builder.addFieldOffset(3, sigOffset, 0);
  builder.addFieldOffset(4, sigNewOffset, 0);
  return builder.endObject();
}

export function encodePowTicket(builder: Builder, ticket: PowTicket): number {
  const peerOffset = builder.createString(ticket.peer);
  const nonceOffset = builder.createString(ticket.nonce);
  const hashOffset = builder.createString(ticket.hash);
  const sigOffset = builder.createString(ticket.sig);
  builder.startObject(6);
  builder.addFieldOffset(0, peerOffset, 0);
  builder.addFieldInt64(1, ticket.ts, 0n);
  builder.addFieldOffset(2, nonceOffset, 0);
  builder.addFieldInt32(3, ticket.difficulty, 0);
  builder.addFieldOffset(4, hashOffset, 0);
  builder.addFieldOffset(5, sigOffset, 0);
  return builder.endObject();
}

export function encodeStakeProof(builder: Builder, proof: StakeProof): number {
  const peerOffset = builder.createString(proof.peer);
  const controllerOffset = builder.createString(proof.controller);
  const stakeEventOffset = builder.createString(proof.stakeEvent);
  const minStakeOffset = builder.createString(proof.minStake);
  const sigOffset = builder.createString(proof.sig);
  const sigControllerOffset = builder.createString(proof.sigController);
  builder.startObject(6);
  builder.addFieldOffset(0, peerOffset, 0);
  builder.addFieldOffset(1, controllerOffset, 0);
  builder.addFieldOffset(2, stakeEventOffset, 0);
  builder.addFieldOffset(3, minStakeOffset, 0);
  builder.addFieldOffset(4, sigOffset, 0);
  builder.addFieldOffset(5, sigControllerOffset, 0);
  return builder.endObject();
}

export function encodeRequestMessage(builder: Builder, message: RequestMessage): number {
  let rangeRequestOffset = 0;
  let peerRotateOffset = 0;
  let powTicketOffset = 0;
  let stakeProofOffset = 0;
  let snapshotRequestOffset = 0;

  switch (message.type) {
    case RequestType.RangeRequest:
      if (!message.rangeRequest) throw new Error('rangeRequest body required');
      rangeRequestOffset = encodeRangeRequest(builder, message.rangeRequest);
      break;
    case RequestType.PeerRotate:
      if (!message.peerRotate) throw new Error('peerRotate body required');
      peerRotateOffset = encodePeerRotate(builder, message.peerRotate);
      break;
    case RequestType.PowTicket:
      if (!message.powTicket) throw new Error('powTicket body required');
      powTicketOffset = encodePowTicket(builder, message.powTicket);
      break;
    case RequestType.StakeProof:
      if (!message.stakeProof) throw new Error('stakeProof body required');
      stakeProofOffset = encodeStakeProof(builder, message.stakeProof);
      break;
    case RequestType.SnapshotRequest:
      if (!message.snapshotRequest) throw new Error('snapshotRequest body required');
      snapshotRequestOffset = encodeSnapshotRequest(builder, message.snapshotRequest);
      break;
    default:
      throw new Error(`Unsupported request type ${message.type}`);
  }

  builder.startObject(6);
  builder.addFieldInt8(0, message.type, 0);
  if (rangeRequestOffset) builder.addFieldOffset(1, rangeRequestOffset, 0);
  if (peerRotateOffset) builder.addFieldOffset(2, peerRotateOffset, 0);
  if (powTicketOffset) builder.addFieldOffset(3, powTicketOffset, 0);
  if (stakeProofOffset) builder.addFieldOffset(4, stakeProofOffset, 0);
  if (snapshotRequestOffset) builder.addFieldOffset(5, snapshotRequestOffset, 0);
  return builder.endObject();
}

export function encodeResponseMessage(builder: Builder, message: ResponseMessage): number {
  let rangeResponseOffset = 0;
  let snapshotResponseOffset = 0;
  switch (message.type) {
    case ResponseType.RangeResponse:
      if (!message.rangeResponse) throw new Error('rangeResponse body required');
      rangeResponseOffset = encodeRangeResponse(builder, message.rangeResponse);
      break;
    case ResponseType.SnapshotResponse:
      if (!message.snapshotResponse) throw new Error('snapshotResponse body required');
      snapshotResponseOffset = encodeSnapshotResponse(builder, message.snapshotResponse);
      break;
    default:
      throw new Error(`Unsupported response type ${message.type}`);
  }

  builder.startObject(3);
  builder.addFieldInt8(0, message.type, 0);
  if (rangeResponseOffset) builder.addFieldOffset(1, rangeResponseOffset, 0);
  if (snapshotResponseOffset) builder.addFieldOffset(2, snapshotResponseOffset, 0);
  return builder.endObject();
}

export function encodeP2PEnvelope(builder: Builder, envelope: {
  v: number;
  topic: string;
  sender: string;
  ts: bigint;
  contentType?: string;
  payload: Uint8Array;
  sig: string;
}): number {
  const topicOffset = builder.createString(envelope.topic);
  const senderOffset = builder.createString(envelope.sender);
  const contentType = envelope.contentType ?? CONTENT_TYPE;
  const contentTypeOffset = builder.createString(contentType);
  const payloadOffset = builder.createByteVector(envelope.payload);
  const sigOffset = builder.createString(envelope.sig);

  builder.startObject(7);
  builder.addFieldInt16(0, envelope.v, 0);
  builder.addFieldOffset(1, topicOffset, 0);
  builder.addFieldOffset(2, senderOffset, 0);
  builder.addFieldInt64(3, envelope.ts, 0n);
  builder.addFieldOffset(4, contentTypeOffset, 0);
  builder.addFieldOffset(5, payloadOffset, 0);
  builder.addFieldOffset(6, sigOffset, 0);
  return builder.endObject();
}

export function decodeRangeRequest(reader: FlatBufferReader, table: number): RangeRequest {
  return {
    from: reader.readStringField(table, 0) ?? '',
    limit: reader.readUint32Field(table, 1, 0),
  };
}

export function decodeRangeResponse(reader: FlatBufferReader, table: number): RangeResponse {
  const eventTables = reader.readVectorTableField(table, 0) ?? [];
  const events = eventTables.map((eventTable) => reader.readByteVectorField(eventTable, 0) ?? new Uint8Array());
  return {
    events,
    cursor: reader.readStringField(table, 1) ?? '',
  };
}

export function decodeSnapshotRequest(reader: FlatBufferReader, table: number): SnapshotRequest {
  return {
    from: reader.readStringField(table, 0) ?? '',
  };
}

export function decodeSnapshotResponse(reader: FlatBufferReader, table: number): SnapshotResponse {
  return {
    hash: reader.readStringField(table, 0) ?? '',
    snapshot: reader.readByteVectorField(table, 1) ?? new Uint8Array(),
    totalBytes: reader.readUint32Field(table, 2, 0),
    chunkIndex: reader.readUint32Field(table, 3, 0),
    chunkCount: reader.readUint32Field(table, 4, 0),
  };
}

export function decodePeerRotate(reader: FlatBufferReader, table: number): PeerRotate {
  return {
    old: reader.readStringField(table, 0) ?? '',
    new: reader.readStringField(table, 1) ?? '',
    ts: reader.readUint64Field(table, 2, 0n),
    sig: reader.readStringField(table, 3) ?? '',
    sigNew: reader.readStringField(table, 4) ?? '',
  };
}

export function decodePowTicket(reader: FlatBufferReader, table: number): PowTicket {
  return {
    peer: reader.readStringField(table, 0) ?? '',
    ts: reader.readUint64Field(table, 1, 0n),
    nonce: reader.readStringField(table, 2) ?? '',
    difficulty: reader.readUint32Field(table, 3, 0),
    hash: reader.readStringField(table, 4) ?? '',
    sig: reader.readStringField(table, 5) ?? '',
  };
}

export function decodeStakeProof(reader: FlatBufferReader, table: number): StakeProof {
  return {
    peer: reader.readStringField(table, 0) ?? '',
    controller: reader.readStringField(table, 1) ?? '',
    stakeEvent: reader.readStringField(table, 2) ?? '',
    minStake: reader.readStringField(table, 3) ?? '',
    sig: reader.readStringField(table, 4) ?? '',
    sigController: reader.readStringField(table, 5) ?? '',
  };
}

export function decodeRequestMessage(reader: FlatBufferReader, table: number): RequestMessage {
  const type = reader.readUint8Field(table, 0, 0) as RequestType;
  const message: RequestMessage = { type };
  switch (type) {
    case RequestType.RangeRequest: {
      const rangeTable = reader.readTableField(table, 1);
      if (rangeTable !== null) message.rangeRequest = decodeRangeRequest(reader, rangeTable);
      break;
    }
    case RequestType.PeerRotate: {
      const rotateTable = reader.readTableField(table, 2);
      if (rotateTable !== null) message.peerRotate = decodePeerRotate(reader, rotateTable);
      break;
    }
    case RequestType.PowTicket: {
      const powTable = reader.readTableField(table, 3);
      if (powTable !== null) message.powTicket = decodePowTicket(reader, powTable);
      break;
    }
    case RequestType.StakeProof: {
      const stakeTable = reader.readTableField(table, 4);
      if (stakeTable !== null) message.stakeProof = decodeStakeProof(reader, stakeTable);
      break;
    }
    case RequestType.SnapshotRequest: {
      const snapshotTable = reader.readTableField(table, 5);
      if (snapshotTable !== null) message.snapshotRequest = decodeSnapshotRequest(reader, snapshotTable);
      break;
    }
    default:
      break;
  }
  return message;
}

export function decodeResponseMessage(reader: FlatBufferReader, table: number): ResponseMessage {
  const type = reader.readUint8Field(table, 0, 0) as ResponseType;
  const message: ResponseMessage = { type };
  switch (type) {
    case ResponseType.RangeResponse: {
      const respTable = reader.readTableField(table, 1);
      if (respTable !== null) message.rangeResponse = decodeRangeResponse(reader, respTable);
      break;
    }
    case ResponseType.SnapshotResponse: {
      const snapshotTable = reader.readTableField(table, 2);
      if (snapshotTable !== null) message.snapshotResponse = decodeSnapshotResponse(reader, snapshotTable);
      break;
    }
    default:
      break;
  }
  return message;
}

export function finishBytes(builder: Builder, rootOffset: number): Uint8Array {
  builder.finish(rootOffset);
  return builder.asUint8Array();
}

export function prefixDomain(prefix: string, payload: Uint8Array): Uint8Array {
  return concatBytes(utf8ToBytes(prefix), payload);
}
