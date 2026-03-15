export const CONTENT_TYPE = 'application/clawnet-stream';

export enum RequestType {
  RangeRequest = 1,
  PeerRotate = 2,
  PowTicket = 3,
  StakeProof = 4,
  SnapshotRequest = 5,
}

export enum ResponseType {
  RangeResponse = 1,
  SnapshotResponse = 2,
}

export interface P2PEnvelope {
  v: number;
  topic: string;
  sender: string;
  ts: bigint;
  contentType: string;
  payload: Uint8Array;
  sig: string;
  rawBytes?: Uint8Array;
}

export interface RangeRequest {
  from: string;
  limit: number;
}

export interface RangeResponse {
  events: Uint8Array[];
  cursor: string;
}

export interface SnapshotRequest {
  from: string;
}

export interface SnapshotResponse {
  hash: string;
  snapshot: Uint8Array;
  totalBytes?: number;
  chunkIndex?: number;
  chunkCount?: number;
}

export interface PeerRotate {
  old: string;
  "new": string;
  ts: bigint;
  sig: string;
  sigNew: string;
}

export interface PowTicket {
  peer: string;
  ts: bigint;
  nonce: string;
  difficulty: number;
  hash: string;
  sig: string;
}

export interface StakeProof {
  peer: string;
  controller: string;
  stakeEvent: string;
  minStake: string;
  sig: string;
  sigController: string;
}

export interface RequestMessage {
  type: RequestType;
  rangeRequest?: RangeRequest;
  peerRotate?: PeerRotate;
  powTicket?: PowTicket;
  stakeProof?: StakeProof;
  snapshotRequest?: SnapshotRequest;
  rawBytes?: Uint8Array;
}

export interface ResponseMessage {
  type: ResponseType;
  rangeResponse?: RangeResponse;
  snapshotResponse?: SnapshotResponse;
  rawBytes?: Uint8Array;
}
