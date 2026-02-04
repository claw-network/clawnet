export const CONTENT_TYPE = 'application/clawtoken-stream';

export enum RequestType {
  RangeRequest = 1,
  PeerRotate = 2,
  PowTicket = 3,
  StakeProof = 4,
}

export enum ResponseType {
  RangeResponse = 1,
}

export interface P2PEnvelope {
  v: number;
  topic: string;
  sender: string;
  ts: bigint;
  contentType: string;
  payload: Uint8Array;
  sig: string;
}

export interface RangeRequest {
  from: string;
  limit: number;
}

export interface RangeResponse {
  events: Uint8Array[];
  cursor: string;
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
}

export interface ResponseMessage {
  type: ResponseType;
  rangeResponse?: RangeResponse;
}
